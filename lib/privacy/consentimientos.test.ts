import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CONSENTIMIENTOS_OBLIGATORIOS,
  anotarConsentimiento,
  consentimientosPendientes,
  cubreVersionActual,
  huellaVigente,
  leerConsentimientos,
  versionVigente,
  type Consentimiento,
} from './consentimientos.ts'
import { DOCUMENTOS_LEGALES } from './textos.ts'

// ── Doble de prueba ─────────────────────────────────────────────────────────
// Un cliente falso y no un mock de librería: lo único que hace falta es
// registrar con qué se llamó y devolver filas. Una dependencia de mocking para
// esto sería más código que el que prueba.
function clienteFalso(filas: unknown[] = []): {
  cliente: SupabaseClient
  rpcs: Array<{ nombre: string; args: Record<string, unknown> }>
  selects: string[]
} {
  const rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = []
  const selects: string[] = []

  const consulta = {
    select(columnas: string) {
      selects.push(columnas)
      return consulta
    },
    eq: () => consulta,
    is: () => consulta,
    order: () => consulta,
    limit: () => Promise.resolve({ data: filas, error: null }),
  }

  const cliente = {
    from: () => consulta,
    rpc: (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args })
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient

  return { cliente, rpcs, selects }
}

test('cubreVersionActual acepta la versión vigente y rechaza cualquier otra', () => {
  const vigente = DOCUMENTOS_LEGALES.privacidad.version
  assert.equal(cubreVersionActual('privacidad', vigente), true)
  assert.equal(cubreVersionActual('privacidad', 'v0-2025-01'), false)
  // Una versión POSTERIOR también es false: si no es la que servimos, no la
  // aceptó aquí. La comparación es exacta a propósito.
  assert.equal(cubreVersionActual('privacidad', 'v9-2099-12'), false)
})

test('cubreVersionActual con null (nunca aceptó) es false', () => {
  assert.equal(cubreVersionActual('terminos', null), false)
  assert.equal(cubreVersionActual('edad_minima', null), false)
})

test('edad_minima y datos_agregados se apoyan en un documento real', () => {
  assert.equal(versionVigente('edad_minima'), DOCUMENTOS_LEGALES.menores.version)
  assert.equal(huellaVigente('edad_minima'), DOCUMENTOS_LEGALES.menores.sha256)
  assert.equal(versionVigente('datos_agregados'), DOCUMENTOS_LEGALES.privacidad.version)
})

test('consentimientosPendientes devuelve vacío cuando está todo al día', () => {
  const vigentes: Consentimiento[] = CONSENTIMIENTOS_OBLIGATORIOS.map((tipo) => ({
    tipo,
    version: versionVigente(tipo),
    aceptadoEn: '2026-08-03T00:00:00.000Z',
    revocadoEn: null,
  }))
  assert.deepEqual(consentimientosPendientes(vigentes), [])
})

test('consentimientosPendientes detecta una versión antigua', () => {
  const vigentes: Consentimiento[] = CONSENTIMIENTOS_OBLIGATORIOS.map((tipo) => ({
    tipo,
    version: tipo === 'privacidad' ? 'v0-2025-01' : versionVigente(tipo),
    aceptadoEn: '2025-01-01T00:00:00.000Z',
    revocadoEn: null,
  }))
  assert.deepEqual(consentimientosPendientes(vigentes), ['privacidad'])
})

test('registrar NO acepta versión ni huella de quien llama: las pone textos.ts', async () => {
  const { cliente, rpcs } = clienteFalso()
  await anotarConsentimiento(cliente, 'u-1', 'terminos')

  assert.equal(rpcs.length, 1)
  assert.equal(rpcs[0].nombre, 'registrar_consentimiento')
  assert.deepEqual(rpcs[0].args, {
    p_user: 'u-1',
    p_kind: 'terminos',
    p_version: DOCUMENTOS_LEGALES.terminos.version,
    p_sha256: DOCUMENTOS_LEGALES.terminos.sha256,
  })
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · una fila con un `kind` desconocido se descarta, no revienta', async () => {
  const { cliente } = clienteFalso([
    { kind: 'terminos', version: 'v1-2026-08', accepted_at: 'x', revoked_at: null },
    { kind: 'inventado', version: 'v1', accepted_at: 'x', revoked_at: null },
  ])

  const vigentes = await leerConsentimientos(cliente, 'u-1')
  assert.equal(vigentes.length, 1)
  assert.equal(vigentes[0].tipo, 'terminos')
})

test('FALLO · la consulta de consentimientos nunca pide columnas de más', async () => {
  const { cliente, selects } = clienteFalso()
  await leerConsentimientos(cliente, 'u-1')

  assert.equal(selects.length, 1)
  // `user_id` no se pide: quien consulta ya sabe de quién es. Y nada que no
  // esté en el `grant select (…)` de la migración 0201.
  const permitidas = ['kind', 'version', 'accepted_at', 'revoked_at']
  for (const columna of selects[0].split(',').map((c) => c.trim())) {
    assert.ok(permitidas.includes(columna), `columna inesperada: ${columna}`)
  }
})
