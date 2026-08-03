// ============================================================================
// Validación de entrada — el body hostil
//
// El caso nº 8 de la ficha en su forma más directa: qué pasa cuando el cliente
// mete `crystals: 999999` en el cuerpo. Respuesta: 422, porque todos los
// esquemas son `.strict()`. Ignorarlo también sería seguro, pero rechazarlo
// convierte el intento en una línea de log en vez de en un no-evento.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esErrorApi } from '../auth/errores.ts'
import { LIMITE_PAGINA_MAX, LIMITE_PAGINA_POR_DEFECTO, MENSAJE_REGALO_MAX } from './limites.ts'
import {
  esquemaBoost,
  esquemaRegalo,
  esquemaRestaurar,
  esquemaVerificar,
  parsear,
  parsearPagina,
} from './validacion.ts'

const UUID = '11111111-2222-4333-8444-555555555555'
const OTRO_UUID = '99999999-2222-4333-8444-555555555555'

function rechaza(esquema: Parameters<typeof parsear>[0], valor: unknown, descripcion: string) {
  assert.throws(
    () => parsear(esquema, valor),
    (error: unknown) => esErrorApi(error) && error.code === 'entrada_invalida',
    descripcion,
  )
}

test('verify acepta plataforma y token, y NADA más', () => {
  assert.deepEqual(parsear(esquemaVerificar, { plataforma: 'apple', token: 'abc' }), {
    plataforma: 'apple',
    token: 'abc',
  })

  rechaza(esquemaVerificar, { plataforma: 'stripe', token: 'abc' }, 'solo Apple y Google')
  rechaza(esquemaVerificar, { plataforma: 'apple' }, 'sin token')
  rechaza(esquemaVerificar, { token: 'abc' }, 'sin plataforma')
})

test('🔴 FALLO · un body con crystals/amount/price se RECHAZA, no se ignora', () => {
  rechaza(esquemaVerificar, { plataforma: 'apple', token: 'abc', crystals: 999999 }, 'crystals')
  rechaza(esquemaVerificar, { plataforma: 'apple', token: 'abc', amount: 999999 }, 'amount')
  rechaza(esquemaVerificar, { plataforma: 'apple', token: 'abc', price: 0 }, 'price')
  rechaza(esquemaBoost, { postId: UUID, amount: 0 }, 'amount en boost')
  rechaza(esquemaBoost, { postId: UUID, medioPreferido: 'gratis', coste: 0 }, 'coste en boost')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', cost_crystals: 1 }, 'coste en regalo')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', fee_crystals: 0 }, 'comisión en regalo')
})

test('🔴 FALLO · el body no puede traer un userId: viene siempre de la sesión', () => {
  rechaza(esquemaBoost, { postId: UUID, userId: OTRO_UUID }, 'userId en boost')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', senderId: OTRO_UUID }, 'senderId en regalo')
  rechaza(esquemaVerificar, { plataforma: 'apple', token: 'x', userId: OTRO_UUID }, 'userId en verify')
})

test('boost acepta postId y, opcionalmente, medio e idempotencia', () => {
  assert.deepEqual(parsear(esquemaBoost, { postId: UUID }), { postId: UUID })
  assert.equal(parsear(esquemaBoost, { postId: UUID, medioPreferido: 'karma' }).medioPreferido, 'karma')

  rechaza(esquemaBoost, { postId: 'no-es-uuid' }, 'postId con forma inválida')
  rechaza(esquemaBoost, { postId: UUID, medioPreferido: 'dinero' }, 'medio inventado')
  rechaza(esquemaBoost, { postId: UUID, idempotencia: 'x'.repeat(500) }, 'clave desmesurada')
})

test('regalo: refType y refId van juntos o no van', () => {
  assert.ok(parsear(esquemaRegalo, { recipientId: UUID, giftKind: 'vela' }))
  assert.ok(parsear(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', refType: 'post', refId: OTRO_UUID }))

  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', refId: OTRO_UUID }, 'refId sin refType')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', refType: 'post' }, 'refType sin refId')
})

test('FALLO · un tipo de regalo inventado no pasa', () => {
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'diamante' }, 'tipo fuera del catálogo')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'constructor' }, 'propiedad heredada')
})

test('el mensaje del regalo respeta el CHECK de 140 caracteres', () => {
  const justo = 'a'.repeat(MENSAJE_REGALO_MAX)
  assert.equal(parsear(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', mensaje: justo }).mensaje, justo)

  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', mensaje: 'a'.repeat(141) }, 'un carácter de más')
  rechaza(esquemaRegalo, { recipientId: UUID, giftKind: 'vela', mensaje: '   ' }, 'mensaje en blanco')
})

test('restore exige plataforma y referencia', () => {
  assert.ok(parsear(esquemaRestaurar, { plataforma: 'google', referencia: 'sku|token' }))
  rechaza(esquemaRestaurar, { plataforma: 'google' }, 'sin referencia')
  rechaza(esquemaRestaurar, { plataforma: 'google', referencia: '' }, 'referencia vacía')
})

test('la paginación aplica el límite duro de CONTRATOS §5', () => {
  const url = (busqueda: string) => new URL(`https://darma.app/api/billing/ledger${busqueda}`)

  assert.deepEqual(parsearPagina(url('')), { cursor: null, limite: LIMITE_PAGINA_POR_DEFECTO })
  assert.equal(parsearPagina(url('?limite=50')).limite, LIMITE_PAGINA_MAX)

  assert.throws(() => parsearPagina(url('?limite=51')), (e: unknown) => esErrorApi(e))
  assert.throws(() => parsearPagina(url('?limite=0')), (e: unknown) => esErrorApi(e))
  // `z.coerce.number()` convertiría '' en 0 y '1.5' en 1.5 sin quejarse; por eso
  // se exige la forma ANTES de convertir.
  assert.throws(() => parsearPagina(url('?limite=')), (e: unknown) => esErrorApi(e))
  assert.throws(() => parsearPagina(url('?limite=1.5')), (e: unknown) => esErrorApi(e))
  assert.throws(() => parsearPagina(url('?limite=-1')), (e: unknown) => esErrorApi(e))
})

test('FALLO · el detalle de zod NO sale al cliente', () => {
  try {
    parsear(esquemaVerificar, { plataforma: 'stripe', token: 'x' })
    assert.fail('debería haber lanzado')
  } catch (error) {
    assert.ok(esErrorApi(error))
    // El mensaje público es el genérico del código; la forma exacta de la
    // validación se queda en `causa`, que solo va al log.
    assert.ok(!error.message.includes('plataforma'))
    assert.ok(!error.message.includes('enum'))
    assert.ok(error.causa)
  }
})
