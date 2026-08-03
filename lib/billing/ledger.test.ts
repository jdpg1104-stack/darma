// ============================================================================
// Ledger — idempotencia, cursor opaco y lo que NO sale por la API
//
// La demostración de que un webhook reintentado no acredita dos veces está
// hecha CONTRA POSTGRES (ver `HANDOFF/ESTADO.md`): la garantía la da el índice
// único parcial `uq_crystal_ledger_external`, y probarla con un mock probaría
// el mock. Lo que se prueba aquí es la mitad que vive en TypeScript:
//
//  · Que la cantidad se resuelve contra el catálogo y NUNCA llega del cliente.
//  · Que `acreditado: false` se propaga tal cual (un reintento no es un error).
//  · Que el movimiento público no lleva `raw_receipt` ni `external_id`.
//  · Que un cursor corrupto devuelve la primera página en vez de un 500.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { esErrorApi } from '../auth/errores.ts'
import {
  acreditarCompra,
  codificarCursor,
  decodificarCursor,
  externalId,
  historialCristales,
  origenDePlataforma,
} from './ledger.ts'

function clienteFalso(respuesta: { data?: unknown; error?: unknown }) {
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = []
  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args })
      return Promise.resolve(respuesta)
    },
  } as unknown as SupabaseClient
  return { cliente, llamadas }
}

test('la cantidad acreditada sale del CATÁLOGO, a partir del sku', async () => {
  const { cliente, llamadas } = clienteFalso({ data: [{ acreditado: true, saldo: 550 }] })

  const resultado = await acreditarCompra(cliente, {
    userId: 'u-1',
    externalId: 'apple:2000000123456789',
    sku: 'crystals_550',
    source: 'iap_apple',
  })

  assert.deepEqual(resultado, { acreditado: true, saldo: 550 })
  assert.equal(llamadas[0]!.args.p_delta, 550)
  assert.equal(llamadas[0]!.args.p_source, 'iap_apple')
  assert.equal(llamadas[0]!.args.p_external_id, 'apple:2000000123456789')
})

test('un REINTENTO devuelve acreditado:false y NO es un error', async () => {
  // Caso nº 5 de la ficha. La respuesta correcta a un webhook repetido es 200
  // con `acreditado: false`: si fuera un error, la tienda seguiría reintentando.
  const { cliente } = clienteFalso({ data: [{ acreditado: false, saldo: 550 }] })

  const resultado = await acreditarCompra(cliente, {
    userId: 'u-1',
    externalId: 'apple:2000000123456789',
    sku: 'crystals_550',
    source: 'iap_apple',
  })

  assert.equal(resultado.acreditado, false)
  assert.equal(resultado.saldo, 550, 'el saldo tiene que ser IDÉNTICO al de la primera vez')
})

test('FALLO · un sku fuera de catálogo no acredita nada (fail-closed)', async () => {
  const { cliente, llamadas } = clienteFalso({ data: [{ acreditado: true, saldo: 999999 }] })

  await assert.rejects(
    () =>
      acreditarCompra(cliente, {
        userId: 'u-1',
        externalId: 'apple:1',
        // Forzado a propósito: es lo que llegaría si alguien esquivara el tipo.
        sku: 'crystals_999999' as never,
        source: 'iap_apple',
      }),
    (error: unknown) => esErrorApi(error) && error.code === 'entrada_invalida',
  )

  assert.equal(llamadas.length, 0, 'no puede llegar a llamar a la base de datos')
})

test('FALLO · sin external_id no se acredita: sin idempotencia, un reintento duplicaría', async () => {
  const { cliente, llamadas } = clienteFalso({ data: [{ acreditado: true, saldo: 100 }] })

  await assert.rejects(
    () => acreditarCompra(cliente, { userId: 'u-1', externalId: '', sku: 'crystals_100', source: 'iap_apple' }),
    (error: unknown) => esErrorApi(error) && error.code === 'entrada_invalida',
  )
  assert.equal(llamadas.length, 0)
})

test('FALLO · un error de Postgres se convierte en 500 sin filtrar el mensaje', async () => {
  const { cliente } = clienteFalso({
    error: { code: '23514', message: 'new row violates check constraint "crystal_ledger_source_check"' },
  })

  await assert.rejects(
    () => acreditarCompra(cliente, { userId: 'u-1', externalId: 'apple:1', sku: 'crystals_100', source: 'iap_apple' }),
    (error: unknown) =>
      esErrorApi(error) &&
      error.code === 'error_interno' &&
      !error.message.includes('crystal_ledger_source_check'),
  )
})

test('el external_id lleva prefijo de plataforma para que Apple y Google no colisionen', () => {
  assert.equal(externalId('apple', '2000000123456789'), 'apple:2000000123456789')
  assert.equal(externalId('google', 'GPA.1234-5678'), 'google:GPA.1234-5678')
  assert.notEqual(externalId('apple', 'X'), externalId('google', 'X'))
})

test('origenDePlataforma usa los valores EXACTOS del CHECK de la tabla', () => {
  // Trampa nº 2: `'apple'` o `'purchase'` revientan con violación de CHECK.
  assert.equal(origenDePlataforma('apple'), 'iap_apple')
  assert.equal(origenDePlataforma('google'), 'iap_google')
})

test('el movimiento público NO lleva raw_receipt, external_id ni el id interno', async () => {
  const { cliente } = clienteFalso({
    data: [
      {
        id: 42,
        delta: 550,
        reason: 'crystals_550',
        source: 'iap_apple',
        created_at: '2026-08-03T10:00:00Z',
        // Aunque la RPC devolviera de más, el mapeo no los deja pasar.
        raw_receipt: { appAccountToken: 'secreto' },
        external_id: 'apple:2000000123456789',
      },
    ],
  })

  const pagina = await historialCristales(cliente, { cursor: null, limite: 20 })
  const movimiento = pagina.items[0]!

  assert.deepEqual(Object.keys(movimiento).sort(), ['delta', 'fecha', 'motivo', 'origen'])
  assert.ok(!JSON.stringify(pagina.items).includes('appAccountToken'))
  assert.ok(!JSON.stringify(pagina.items).includes('2000000123456789'))
})

test('el cursor es opaco y viaja el bigint dentro, no como campo', async () => {
  const { cliente } = clienteFalso({
    data: [{ id: 42, delta: -50, reason: 'boost', source: 'spend', created_at: '2026-08-03T10:00:00Z' }],
  })

  const pagina = await historialCristales(cliente, { cursor: null, limite: 20 })

  assert.ok(pagina.siguienteCursor)
  assert.ok(!pagina.siguienteCursor.includes('42'), 'el cursor no puede llevar el id en claro')
  assert.equal(decodificarCursor(pagina.siguienteCursor), 42)
})

test('una página vacía cierra la paginación con null', async () => {
  const { cliente } = clienteFalso({ data: [] })
  const pagina = await historialCristales(cliente, { cursor: null, limite: 20 })

  assert.deepEqual(pagina.items, [])
  assert.equal(pagina.siguienteCursor, null)
})

test('FALLO · un cursor corrupto devuelve null (primera página), no una excepción', () => {
  for (const malo of [
    '',
    null,
    undefined,
    'no-es-base64!!',
    codificarCursor(0),
    Buffer.from('otro:42').toString('base64url'),
    Buffer.from('cl:no-un-numero').toString('base64url'),
    Buffer.from('cl:-5').toString('base64url'),
    Buffer.from('cl:1e400').toString('base64url'),
  ]) {
    assert.equal(decodificarCursor(malo), null, `«${String(malo)}» debería descartarse`)
  }
})

test('codificar y decodificar es una ida y vuelta exacta', () => {
  for (const id of [1, 42, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(decodificarCursor(codificarCursor(id)), id)
  }
})
