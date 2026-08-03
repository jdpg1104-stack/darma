// ============================================================================
// Boosts — el orden de pago ES la línea roja, y por eso se prueba
//
// Los casos 2, 3, 10 y 11 de la ficha viven aquí en su versión sin base de
// datos. La versión CONTRA POSTGRES (que es la que de verdad demuestra que el
// cobro se revierte cuando el trigger rechaza) está ejecutada y documentada en
// `HANDOFF/ESTADO.md`: aquí no se puede montar una transacción real, y fingirla
// con un mock probaría el mock.
//
// Lo que sí se prueba aquí, y no se puede probar en SQL:
//  · Que `opcionesDePago()` devuelve gratis → karma → cristales, SIEMPRE.
//  · Que los SQLSTATE se traducen a códigos públicos sin filtrar el mensaje.
//  · Que la ruta manda el `userId` de la sesión y nunca una cantidad.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { esErrorApi } from '../auth/errores.ts'
import { KARMA_COSTS } from '../karma.ts'
import {
  BOOST_COSTE_CRISTALES,
  BOOST_MAX_DIA,
  CUPO_GRATIS_DIARIO,
  errorDeBoost,
  esMedioPagoBoost,
  estadoBoost,
  impulsarPost,
  opcionesDePago,
  segundosHastaManana,
  type EstadoBoost,
} from './boosts.ts'

/** Cliente falso: solo registra la llamada y devuelve lo que se le diga. */
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

const ESTADO_BASE: EstadoBoost = {
  cupoGratisRestante: 0,
  boostsHoy: 0,
  karmaSpendable: 0,
  crystals: 0,
  costeKarma: KARMA_COSTS.boost,
  costeCristales: BOOST_COSTE_CRISTALES,
  maxDia: BOOST_MAX_DIA,
}

test('🔴 opcionesDePago devuelve SIEMPRE gratis → karma → cristales', () => {
  // Aunque la persona tenga cristales de sobra y ni karma ni cupo, el dinero
  // sigue el último. El orden no depende del saldo: depende de la regla.
  for (const estado of [
    ESTADO_BASE,
    { ...ESTADO_BASE, cupoGratisRestante: 1, karmaSpendable: 500, crystals: 5000 },
    { ...ESTADO_BASE, crystals: 100000 },
    { ...ESTADO_BASE, karmaSpendable: 50 },
  ]) {
    assert.deepEqual(
      opcionesDePago(estado).map((o) => o.medio),
      ['gratis', 'karma', 'cristales'],
    )
  }
})

test('🔴 la opción gratuita existe con cero karma y cero cristales', () => {
  // El cupo gratuito es lo que hace que el dinero nunca sea la barrera para ser
  // escuchado. Si esta comprobación falla, la línea roja está rota.
  const opciones = opcionesDePago({ ...ESTADO_BASE, cupoGratisRestante: CUPO_GRATIS_DIARIO })
  const gratis = opciones[0]!

  assert.equal(gratis.medio, 'gratis')
  assert.equal(gratis.coste, 0)
  assert.equal(gratis.disponible, true)
})

test('el boost cuesta lo MISMO en karma que en cristales', () => {
  // Si los cristales lo compraran más barato, el dinero compraría más
  // visibilidad por unidad de esfuerzo.
  const opciones = opcionesDePago({ ...ESTADO_BASE, karmaSpendable: 500, crystals: 500 })
  assert.equal(opciones[1]!.coste, opciones[2]!.coste)
  assert.equal(opciones[1]!.coste, KARMA_COSTS.boost)
})

test('una opción sin saldo se marca no disponible en vez de desaparecer', () => {
  // Ocultarla haría creer que no existe; enseñarla apagada explica qué falta.
  const opciones = opcionesDePago({ ...ESTADO_BASE, karmaSpendable: 49, crystals: 49 })
  assert.deepEqual(opciones.map((o) => o.disponible), [false, false, false])
  assert.equal(opciones.length, 3)
})

test('impulsarPost manda el userId recibido y NINGUNA cantidad', async () => {
  const { cliente, llamadas } = clienteFalso({
    data: [{ aplicado: true, medio: 'gratis', expira_en: '2026-08-04T00:00:00Z', cupo_gratis_restante: 0 }],
  })

  const resultado = await impulsarPost(cliente, {
    userId: 'u-1',
    postId: 'p-1',
    idempotencia: 'k-1',
  })

  assert.equal(resultado.medio, 'gratis')
  assert.equal(resultado.aplicado, true)
  assert.equal(resultado.cupoGratisRestante, 0)
  assert.equal(resultado.expiraEn, new Date('2026-08-04T00:00:00Z').toISOString())

  const args = llamadas[0]!.args
  assert.equal(llamadas[0]!.nombre, 'impulsar_post')
  assert.equal(args.p_user, 'u-1')
  // Sin `p_medio` explícito, el servidor resuelve gratis → karma → cristales.
  assert.equal(args.p_medio, null)
  for (const prohibido of ['p_amount', 'p_crystals', 'p_delta', 'p_price']) {
    assert.ok(!(prohibido in args), `la RPC no puede recibir «${prohibido}»`)
  }
})

test('un medio elegido explícitamente se RESPETA (no se cobra dinero por "ayudar")', async () => {
  const { cliente, llamadas } = clienteFalso({
    data: [{ aplicado: true, medio: 'karma', expira_en: '2026-08-04T00:00:00Z', cupo_gratis_restante: 0 }],
  })

  await impulsarPost(cliente, { userId: 'u-1', postId: 'p-1', medioPreferido: 'karma' })
  assert.equal(llamadas[0]!.args.p_medio, 'karma')
})

test('FALLO · saldo insuficiente (DA001) → 409 saldo_insuficiente', async () => {
  const { cliente } = clienteFalso({ error: { code: 'DA001', message: 'saldo insuficiente' } })

  await assert.rejects(
    () => impulsarPost(cliente, { userId: 'u-1', postId: 'p-1' }),
    (error: unknown) => esErrorApi(error) && error.code === 'saldo_insuficiente' && error.status === 409,
  )
})

test('FALLO · cuarto boost del día (DA005) → 429 con Retry-After hasta mañana', () => {
  const error = errorDeBoost({ code: 'DA005', message: 'límite de 3 boosts por día alcanzado' })

  assert.equal(error.code, 'demasiadas_peticiones')
  assert.equal(error.status, 429)
  assert.ok((error.retryAfter ?? 0) > 0)
  assert.match(error.message, new RegExp(String(BOOST_MAX_DIA)))
})

test('FALLO · post moderado o en crisis (DA004) → 403 sin decir cuál de las dos cosas', () => {
  const error = errorDeBoost({ code: 'DA004', message: 'post no impulsable' })

  assert.equal(error.code, 'sin_permiso')
  // El autor de un post marcado por riesgo no debe deducir del mensaje que está
  // en una cola de revisión humana.
  assert.ok(!/riesgo|crisis|moderad|hidden|removed/i.test(error.message), error.message)
})

test('FALLO · un error desconocido de Postgres es 500 genérico y no filtra el mensaje', () => {
  const error = errorDeBoost({
    code: '23505',
    message: 'duplicate key value violates unique constraint "uq_boosts_idem"',
  })

  assert.equal(error.code, 'error_interno')
  assert.ok(!error.message.includes('uq_boosts_idem'))
  assert.ok(!error.message.includes('constraint'))
})

test('FALLO · una RPC que no devuelve filas es un 500, no un boost fantasma', async () => {
  const { cliente } = clienteFalso({ data: [] })

  await assert.rejects(
    () => impulsarPost(cliente, { userId: 'u-1', postId: 'p-1' }),
    (error: unknown) => esErrorApi(error) && error.code === 'error_interno',
  )
})

test('estadoBoost tolera una respuesta vacía sin inventar saldo', async () => {
  const { cliente } = clienteFalso({ data: [] })
  const estado = await estadoBoost(cliente)

  assert.equal(estado.cupoGratisRestante, 0)
  assert.equal(estado.karmaSpendable, 0)
  assert.equal(estado.crystals, 0)
  assert.equal(estado.costeKarma, KARMA_COSTS.boost)
})

test('segundosHastaManana siempre es positivo y menor que un día', () => {
  for (const iso of ['2026-08-03T00:00:00Z', '2026-08-03T12:34:56Z', '2026-08-03T23:59:59Z']) {
    const segundos = segundosHastaManana(new Date(iso))
    assert.ok(segundos > 0 && segundos <= 86400, `${iso} → ${segundos}`)
  }
})

test('esMedioPagoBoost rechaza cualquier cosa que no sea uno de los tres', () => {
  assert.equal(esMedioPagoBoost('gratis'), true)
  assert.equal(esMedioPagoBoost('karma'), true)
  assert.equal(esMedioPagoBoost('cristales'), true)
  assert.equal(esMedioPagoBoost('dinero'), false)
  assert.equal(esMedioPagoBoost('crystals'), false)
  assert.equal(esMedioPagoBoost(null), false)
})
