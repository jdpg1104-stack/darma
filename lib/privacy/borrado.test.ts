// ============================================================================
// Pruebas del borrado — la parte que se puede probar SIN base de datos.
//
// El algoritmo vive en Postgres, así que aquí se prueban tres cosas: que la
// invariante «identity_vault vacío» se comprueba de verdad, que el token nunca
// se persiste en claro, y que la traducción del jsonb no inventa valores.
//
// La verificación del algoritmo en sí se hizo CONTRA POSTGRES (`darma-dev`,
// datos sembrados y borrados después) y está documentada en HANDOFF/ESTADO.md
// con los recuentos de antes y de después: es la clase de propiedad —«los
// comentarios ajenos siguen intactos y el reply_count de un tercero no se ha
// movido»— que un doble de prueba no puede demostrar, porque lo que se está
// probando son las cascadas y los triggers reales.
// ============================================================================

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DIAS_ARREPENTIMIENTO,
  HORAS_CONFIRMACION,
  cancelarBorradoCon,
  confirmarBorrado,
  confirmarBorradoCon,
  ejecutarBorradoCon,
  fechaDeEjecucion,
  generarTokenConfirmacion,
  huellaToken,
  solicitarBorradoCon,
} from './borrado.ts'

const RESULTADO_OK = {
  identity_vault_borrado: true,
  perfil_anonimizado: true,
  posts_lapidados: 3,
  comentarios_conservados: 12,
  refugios_abandonados: 1,
  auth_user_borrado: true,
  alias_retirado: 'Faro Sereno 4821',
  ya_estaba_borrado: false,
  ejecutado_en: '2026-08-03T04:40:24Z',
}

function clienteFalso(
  respuesta: unknown,
  error: { message: string } | null = null,
): { cliente: SupabaseClient; llamadas: Array<{ nombre: string; args: Record<string, unknown> }> } {
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = []
  const cliente = {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args })
      return Promise.resolve({ data: respuesta, error })
    },
  } as unknown as SupabaseClient
  return { cliente, llamadas }
}

test('ejecutarBorrado traduce el jsonb al resultado del contrato', async () => {
  const { cliente, llamadas } = clienteFalso(RESULTADO_OK)
  const resultado = await ejecutarBorradoCon(cliente, 'u-1')

  assert.equal(llamadas[0].nombre, 'borrar_usuario')
  assert.deepEqual(llamadas[0].args, { p_user: 'u-1' })

  assert.equal(resultado.identityVaultBorrado, true)
  assert.equal(resultado.perfilAnonimizado, true)
  assert.equal(resultado.postsLapidados, 3)
  assert.equal(resultado.comentariosConservados, 12)
  assert.equal(resultado.refugiosAbandonados, 1)
  assert.equal(resultado.authUserBorrado, true)
  assert.equal(resultado.aliasRetirado, 'Faro Sereno 4821')
  assert.equal(resultado.yaEstabaBorrado, false)
})

test('el resultado DECLARA lo que depende de otro bloque en vez de darlo por hecho', async () => {
  const { cliente } = clienteFalso(RESULTADO_OK)
  const resultado = await ejecutarBorradoCon(cliente, 'u-1')

  // La lección de rgpdErase.ts: lo que ninguna fila referencia es invisible y
  // sobrevive. Si esto se queda vacío algún día, será porque B10 destruye las
  // claves y alguien lo comprobó, no porque nos lo hayamos creído.
  assert.equal(resultado.pendienteDeOtrosBloques.length, 1)
  assert.match(resultado.pendienteDeOtrosBloques[0], /claves/i)
})

test('el segundo borrado (reintento) devuelve el mismo estado, con ya_estaba_borrado', async () => {
  const { cliente } = clienteFalso({ ...RESULTADO_OK, ya_estaba_borrado: true })
  const resultado = await ejecutarBorradoCon(cliente, 'u-1')

  assert.equal(resultado.yaEstabaBorrado, true)
  assert.equal(resultado.identityVaultBorrado, true)
  assert.equal(resultado.comentariosConservados, 12)
  assert.equal(resultado.aliasRetirado, 'Faro Sereno 4821')
})

test('el token se genera con 32 bytes y solo se persiste su sha256', async () => {
  const { token, sha256 } = await generarTokenConfirmacion()

  // base64url de 32 bytes → 43 caracteres, sin relleno.
  assert.equal(token.length, 43)
  assert.match(token, /^[A-Za-z0-9_-]+$/)
  assert.equal(sha256, createHash('sha256').update(token, 'utf8').digest('hex'))
  assert.equal(sha256.length, 64)
  assert.notEqual(sha256, token)
})

test('dos tokens seguidos nunca coinciden', async () => {
  const a = await generarTokenConfirmacion()
  const b = await generarTokenConfirmacion()
  assert.notEqual(a.token, b.token)
  assert.notEqual(a.sha256, b.sha256)
})

test('solicitarBorrado guarda la HUELLA, nunca el token', async () => {
  const { cliente, llamadas } = clienteFalso('sol-1')
  const { token, solicitudId } = await solicitarBorradoCon(cliente, 'u-1')

  assert.equal(solicitudId, 'sol-1')
  const args = llamadas[0].args
  assert.equal(args.p_kind, 'erase')
  assert.equal(args.p_confirmada, false)
  assert.equal(args.p_ttl_segundos, HORAS_CONFIRMACION * 3600)
  assert.equal(args.p_token_sha256, await huellaToken(token))
  // El token en claro NO viaja a la base de datos por ninguna vía.
  assert.ok(!JSON.stringify(args).includes(token))
})

test('confirmarBorradoCon envía la huella del token recibido, no el token', async () => {
  const { cliente, llamadas } = clienteFalso(true)
  const ok = await confirmarBorradoCon(cliente, 'sol-1', 'u-1', 'un-token-cualquiera-de-prueba')

  assert.equal(ok, true)
  assert.equal(llamadas[0].nombre, 'confirmar_borrado')
  assert.equal(llamadas[0].args.p_user, 'u-1')
  assert.equal(
    llamadas[0].args.p_token_sha256,
    await huellaToken('un-token-cualquiera-de-prueba'),
  )
  assert.ok(!JSON.stringify(llamadas[0].args).includes('un-token-cualquiera-de-prueba'))
})

test('la ejecución se programa a 30 días de la confirmación', () => {
  const confirmado = new Date('2026-08-03T00:00:00.000Z')
  assert.equal(DIAS_ARREPENTIMIENTO, 30)
  assert.equal(fechaDeEjecucion(confirmado), '2026-09-02T00:00:00.000Z')
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · si identity_vault sigue con fila, esto NO es un borrado y lanza', async () => {
  const { cliente } = clienteFalso({ ...RESULTADO_OK, identity_vault_borrado: false })
  await assert.rejects(
    () => ejecutarBorradoCon(cliente, 'u-1'),
    /identity_vault sigue teniendo fila/,
  )
})

test('FALLO · una RPC sin resultado lanza en vez de devolver ceros', async () => {
  const { cliente } = clienteFalso(null)
  await assert.rejects(() => ejecutarBorradoCon(cliente, 'u-1'), /no devolvió resultado/)
})

test('FALLO · un error de Postgres se propaga y no se convierte en éxito', async () => {
  const { cliente } = clienteFalso(null, { message: 'permission denied' })
  await assert.rejects(() => ejecutarBorradoCon(cliente, 'u-1'), /permission denied/)
})

test('FALLO · token inválido, caducado o ya usado dan la MISMA respuesta', async () => {
  // Postgres devuelve false en los tres casos y aquí no se distingue: la ruta
  // los traduce todos a `entrada_invalida`. Distinguirlos le diría a quien
  // prueba tokens contra qué muro ha chocado.
  const { cliente } = clienteFalso(false)
  assert.equal(await confirmarBorradoCon(cliente, 'sol-1', 'u-1', 'malo'), false)
  assert.equal(await confirmarBorradoCon(cliente, 'sol-1', 'u-1', 'caducado'), false)
  assert.equal(await confirmarBorradoCon(cliente, 'sol-1', 'u-1', 'ya-usado'), false)
})

test('FALLO · la firma sin userId de la ficha lanza y explica por qué', async () => {
  await assert.rejects(() => confirmarBorrado('sol-1', 'token'), /userId de la sesión/)
})

test('FALLO · cancelar sin solicitud viva devuelve false, no lanza', async () => {
  const { cliente } = clienteFalso(false)
  assert.equal(await cancelarBorradoCon(cliente, 'u-1'), false)
})
