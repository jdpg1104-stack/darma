import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COSTE_UNIDADES,
  CORRIDAS_MAX_POR_DIA,
  CUOTA_DIARIA,
  PRESUPUESTO_POR_CORRIDA,
  RESERVA_VERIFICACION,
  TOPE_LLAMADAS_POR_CORRIDA,
  crearContadorCuota,
  esVerificacion,
  unidadesEstimadas,
} from './cuota.ts'

// ── El precio, que es el origen de todo ─────────────────────────────────────

test('search.list cuesta 100 veces lo que playlistItems.list', () => {
  // Si algún día alguien "unifica" los costes, este es el test que se pone rojo
  // antes de que la cuota se agote en producción.
  assert.equal(COSTE_UNIDADES['playlistItems.list'], 1)
  assert.equal(COSTE_UNIDADES['videos.list'], 1)
  assert.equal(COSTE_UNIDADES['search.list'], 100)
})

test('el incidente de DataLaps del 2026-07-29, en aritmética ejecutable', () => {
  // 52 canales + 12 búsquedas, TODO por search.list: 6.400 unidades en una sola
  // corrida sobre una cuota diaria de 10.000 (429 real confirmado ese día).
  const antes = unidadesEstimadas({ 'search.list': 52 + 12 })
  assert.equal(antes, 6_400)
  assert.ok(antes > CUOTA_DIARIA / 2, 'una sola corrida se comía más de media cuota diaria')

  // La corrección: canales por playlistItems.list y búsquedas topadas.
  const despues = unidadesEstimadas({ 'playlistItems.list': 52, 'search.list': 3 })
  assert.equal(despues, 352)
  assert.ok(despues * 18 < CUOTA_DIARIA, 'con la corrección caben 18 corridas al día')
})

test('unidadesEstimadas ignora valores absurdos en vez de propagarlos', () => {
  assert.equal(unidadesEstimadas({}), 0)
  assert.equal(unidadesEstimadas({ 'search.list': -3 }), 0)
  assert.equal(unidadesEstimadas({ 'videos.list': Number.NaN }), 0)
  assert.equal(unidadesEstimadas({ 'playlistItems.list': 2.9 }), 2)
})

// ── Los números por defecto tienen que cuadrar entre sí ─────────────────────

test('el presupuesto por corrida cabe en la cuota diaria aunque el cron se dispare cada hora', () => {
  // Es EL criterio con el que se eligió PRESUPUESTO_POR_CORRIDA. Subirlo "solo
  // un poco" rompe aquí y no en producción a las tres de la mañana.
  assert.ok(
    PRESUPUESTO_POR_CORRIDA * CORRIDAS_MAX_POR_DIA <= CUOTA_DIARIA,
    `${PRESUPUESTO_POR_CORRIDA} × ${CORRIDAS_MAX_POR_DIA} supera las ${CUOTA_DIARIA} unidades diarias`,
  )
})

test('agotar TODOS los topes por operación sigue cabiendo en el presupuesto', () => {
  // Si no cupiera, el corte llegaría por presupuesto y los topes por operación
  // no significarían nada: el reparto entre vías dejaría de existir.
  const maximo = unidadesEstimadas(TOPE_LLAMADAS_POR_CORRIDA)
  assert.ok(maximo <= PRESUPUESTO_POR_CORRIDA, `los topes suman ${maximo} sobre ${PRESUPUESTO_POR_CORRIDA}`)

  // Y el descubrimiento a tope tiene que respetar la reserva de verificación.
  const descubrimiento = unidadesEstimadas({
    'playlistItems.list': TOPE_LLAMADAS_POR_CORRIDA['playlistItems.list'],
    'search.list': TOPE_LLAMADAS_POR_CORRIDA['search.list'],
  })
  assert.ok(descubrimiento <= PRESUPUESTO_POR_CORRIDA - RESERVA_VERIFICACION)
})

// ── Camino de fallo: cortar ANTES, no después ───────────────────────────────

test('el corte llega ANTES de gastar: lo denegado no se cobra', () => {
  const cuota = crearContadorCuota({ presupuesto: 150, reservaVerificacion: 0 })

  assert.equal(cuota.intentarGastar('search.list'), null)
  assert.equal(cuota.gastadas(), 100)

  // La segunda búsqueda costaría 200 sobre un presupuesto de 150: se deniega, y
  // el contador NO se mueve. Si se cobrara y luego se avisara, la cuota del día
  // siguiente ya estaría comprometida.
  assert.equal(cuota.intentarGastar('search.list'), 'presupuesto_agotado')
  assert.equal(cuota.gastadas(), 100)
  assert.equal(cuota.restantes(), 50)
})

test('puedeGastar no cobra: preguntar es gratis', () => {
  const cuota = crearContadorCuota({ presupuesto: 100, reservaVerificacion: 0 })
  assert.equal(cuota.puedeGastar('search.list'), null)
  assert.equal(cuota.puedeGastar('search.list'), null)
  assert.equal(cuota.gastadas(), 0)
})

test('la reserva de verificación es intocable para el descubrimiento', () => {
  // Presupuesto 200 entero reservado: hay unidades de sobra para las dos vías de
  // descubrimiento, y aun así ninguna puede tocarlas. videos.list —que es quien
  // verifica— sigue pudiendo trabajar.
  const cuota = crearContadorCuota({ presupuesto: 200, reservaVerificacion: 200 })

  assert.equal(cuota.intentarGastar('playlistItems.list'), 'reserva_de_verificacion')
  assert.equal(cuota.intentarGastar('search.list'), 'reserva_de_verificacion')
  assert.equal(cuota.gastadas(), 0)

  assert.equal(cuota.intentarGastar('videos.list'), null)
  assert.equal(cuota.gastadas(), 1)
})

test('el presupuesto manda sobre la reserva: lo que no cabe, no cabe', () => {
  // Con 10 unidades una búsqueda (100) no entra ni aunque no hubiera reserva. El
  // motivo tiene que decir «presupuesto», no «reserva»: son diagnósticos distintos.
  const cuota = crearContadorCuota({ presupuesto: 10, reservaVerificacion: 10 })
  assert.equal(cuota.puedeGastar('search.list'), 'presupuesto_agotado')
  assert.equal(cuota.puedeGastar('playlistItems.list'), 'reserva_de_verificacion')
})

test('la reserva nunca puede ser mayor que el presupuesto', () => {
  const cuota = crearContadorCuota({ presupuesto: 5, reservaVerificacion: 999 })
  assert.equal(cuota.resumen().reservaVerificacion, 5)
  // Con la reserva recortada, videos.list puede gastar el presupuesto entero.
  for (let i = 0; i < 5; i++) assert.equal(cuota.intentarGastar('videos.list'), null)
  assert.equal(cuota.intentarGastar('videos.list'), 'presupuesto_agotado')
})

test('el tope por operación corta aunque sobre presupuesto', () => {
  // Presupuesto de sobra: lo que se acaba son las BÚSQUEDAS, y el motivo lo dice.
  const cuota = crearContadorCuota({ presupuesto: 10_000, reservaVerificacion: 0, topes: { 'search.list': 2 } })

  assert.equal(cuota.intentarGastar('search.list'), null)
  assert.equal(cuota.intentarGastar('search.list'), null)
  assert.equal(cuota.intentarGastar('search.list'), 'tope_de_operacion')

  // El tope de una vía no bloquea las demás.
  assert.equal(cuota.intentarGastar('playlistItems.list'), null)
  assert.equal(cuota.gastadas(), 201)
})

test('el motivo distingue tope de presupuesto (subir el presupuesto no arregla un tope)', () => {
  const cuota = crearContadorCuota({ presupuesto: 10_000, reservaVerificacion: 0, topes: { 'search.list': 0 } })
  assert.equal(cuota.puedeGastar('search.list'), 'tope_de_operacion')
})

test('una configuración corrupta deja la corrida sin gastar, NO sin límite', () => {
  // Fail-closed. Un Number(process.env.X) que da NaN no puede significar
  // "ilimitado": es exactamente cómo se agota una cuota sin que nadie lo note.
  for (const presupuesto of [Number.NaN, -1, Number.POSITIVE_INFINITY * -1]) {
    const cuota = crearContadorCuota({ presupuesto })
    assert.equal(cuota.intentarGastar('playlistItems.list'), 'presupuesto_agotado')
    assert.equal(cuota.intentarGastar('videos.list'), 'presupuesto_agotado')
    assert.equal(cuota.gastadas(), 0)
  }
})

test('un tope corrupto tampoco abre la puerta', () => {
  const cuota = crearContadorCuota({ presupuesto: 1_000, topes: { 'search.list': Number.NaN } })
  assert.equal(cuota.intentarGastar('search.list'), 'tope_de_operacion')
})

// ── El resumen: la señal de operación ───────────────────────────────────────

test('el resumen cuenta llamadas y cortes por motivo', () => {
  const cuota = crearContadorCuota({ presupuesto: 120, reservaVerificacion: 20, topes: { 'search.list': 1 } })

  assert.equal(cuota.intentarGastar('playlistItems.list'), null)
  // Techo de descubrimiento = 120 − 20 = 100. La búsqueda pediría 1 + 100 = 101:
  // no cabe, y el motivo señala la reserva, no el presupuesto (que sí tenía sitio).
  assert.equal(cuota.intentarGastar('search.list'), 'reserva_de_verificacion')

  const resumen = cuota.resumen()
  assert.equal(resumen.llamadas['playlistItems.list'], 1)
  assert.equal(resumen.llamadas['search.list'], 0)
  assert.equal(resumen.cortes.reserva_de_verificacion, 1)
  assert.equal(resumen.gastadas, 1)
  assert.equal(resumen.restantes, 119)
})

test('el resumen es una copia: mutarlo no toca el contador', () => {
  const cuota = crearContadorCuota({ presupuesto: 100 })
  const resumen = cuota.resumen()
  resumen.llamadas['search.list'] = 99
  resumen.cortes.presupuesto_agotado = 99
  assert.equal(cuota.resumen().llamadas['search.list'], 0)
  assert.equal(cuota.resumen().cortes.presupuesto_agotado, 0)
})

test('cada corrida tiene su propio contador: dos no comparten presupuesto', () => {
  // Dos ejecuciones solapadas del cron no pueden repartirse un contador global
  // que ninguna de las dos controla.
  const a = crearContadorCuota({ presupuesto: 100, reservaVerificacion: 0 })
  const b = crearContadorCuota({ presupuesto: 100, reservaVerificacion: 0 })
  assert.equal(a.intentarGastar('search.list'), null)
  assert.equal(a.gastadas(), 100)
  assert.equal(b.gastadas(), 0)
})

test('solo videos.list cuenta como verificación', () => {
  assert.equal(esVerificacion('videos.list'), true)
  assert.equal(esVerificacion('playlistItems.list'), false)
  assert.equal(esVerificacion('search.list'), false)
})
