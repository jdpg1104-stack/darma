// ============================================================================
// Pruebas de la cadencia. Todas del CAMINO DE FALLO salvo las dos últimas: el
// camino feliz de esta función se recorre solo, el que hay que blindar es el de
// "no, hoy no toca".
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CADA_N_TARJETAS,
  HORAS_ENTRE_ENCUESTAS,
  MAX_ENCUESTAS_DIA,
  decidirMostrar,
  diaLocal,
  senalesDesdeFila,
  type SenalesCadencia,
} from './cadencia.ts'

const AHORA = new Date('2026-08-03T12:00:00.000Z')

function senales(parcial: Partial<SenalesCadencia> = {}): SenalesCadencia {
  return {
    ultimaMostradaEn: null,
    mostradasHoy: 0,
    posicionEnFeed: CADA_N_TARJETAS + 1,
    yaVotoOMDescarto: false,
    ...parcial,
  }
}

test('con mostradasHoy = MAX_ENCUESTAS_DIA no se muestra', () => {
  const d = decidirMostrar(senales({ mostradasHoy: MAX_ENCUESTAS_DIA }), AHORA)
  assert.equal(d.mostrar, false)
  assert.equal(d.motivo, 'tope_diario')
})

test('por encima del tope diario tampoco (el contador no se "arregla" solo)', () => {
  assert.equal(decidirMostrar(senales({ mostradasHoy: MAX_ENCUESTAS_DIA + 5 }), AHORA).mostrar, false)
})

test('con la última hace 3 h y HORAS_ENTRE_ENCUESTAS = 6 no se muestra', () => {
  const haceTresHoras = new Date(AHORA.getTime() - 3 * 3_600_000).toISOString()
  const d = decidirMostrar(senales({ ultimaMostradaEn: haceTresHoras }), AHORA)
  assert.equal(d.mostrar, false)
  assert.equal(d.motivo, 'muy_pronto')
  assert.equal(HORAS_ENTRE_ENCUESTAS, 6, 'si cambia el umbral, este test debe cambiar a la vez')
})

test('justo en el límite de HORAS_ENTRE_ENCUESTAS sí se muestra', () => {
  const justo = new Date(AHORA.getTime() - HORAS_ENTRE_ENCUESTAS * 3_600_000).toISOString()
  assert.equal(decidirMostrar(senales({ ultimaMostradaEn: justo }), AHORA).mostrar, true)
})

test('una fecha en el FUTURO cuenta como muy pronto, no como muy antigua', () => {
  const futuro = new Date(AHORA.getTime() + 3_600_000).toISOString()
  const d = decidirMostrar(senales({ ultimaMostradaEn: futuro }), AHORA)
  assert.equal(d.mostrar, false)
  assert.equal(d.motivo, 'muy_pronto')
})

test('una fecha ilegible se trata como "nunca" y no bloquea para siempre', () => {
  assert.equal(decidirMostrar(senales({ ultimaMostradaEn: 'ayer por la tarde' }), AHORA).mostrar, true)
})

test('con posicionEnFeed = 3 y CADA_N_TARJETAS = 7 no se muestra', () => {
  const d = decidirMostrar(senales({ posicionEnFeed: 3 }), AHORA)
  assert.equal(d.mostrar, false)
  assert.equal(d.motivo, 'demasiado_arriba')
  assert.equal(CADA_N_TARJETAS, 7, 'si cambia el umbral, este test debe cambiar a la vez')
})

test('el slot 8 de B02 SÍ es elegible (por eso el suelo no es un módulo)', () => {
  assert.equal(decidirMostrar(senales({ posicionEnFeed: 8 }), AHORA).mostrar, true)
})

test('si ya votó o descartó, no se muestra pase lo que pase', () => {
  const d = decidirMostrar(
    senales({ yaVotoOMDescarto: true, mostradasHoy: 0, posicionEnFeed: 99 }),
    AHORA,
  )
  assert.equal(d.mostrar, false)
  assert.equal(d.motivo, 'ya_respondida')
})

test('decidirMostrar es PURA: mismas señales y mismo ahora, misma salida', () => {
  const s = senales({ mostradasHoy: 1, ultimaMostradaEn: '2026-08-03T02:00:00.000Z' })
  const a = decidirMostrar(s, AHORA)
  const b = decidirMostrar(s, AHORA)
  const c = decidirMostrar({ ...s }, new Date(AHORA))
  assert.deepEqual(a, b)
  assert.deepEqual(a, c)
})

test('decidirMostrar no toca el reloj real: el mismo caso da distinto con otro ahora', () => {
  const s = senales({ ultimaMostradaEn: '2026-08-03T09:00:00.000Z' })
  assert.equal(decidirMostrar(s, new Date('2026-08-03T12:00:00.000Z')).mostrar, false)
  assert.equal(decidirMostrar(s, new Date('2026-08-03T16:00:00.000Z')).mostrar, true)
})

test('decidirMostrar no muta las señales que recibe', () => {
  const s = senales({ mostradasHoy: 2 })
  const copia = { ...s }
  decidirMostrar(s, AHORA)
  assert.deepEqual(s, copia)
})

// ── senalesDesdeFila ────────────────────────────────────────────────────────

test('sin fila de cadencia, mostradasHoy es 0', () => {
  const s = senalesDesdeFila(null, 9, false, AHORA)
  assert.equal(s.mostradasHoy, 0)
  assert.equal(s.ultimaMostradaEn, null)
})

test('una fila de OTRO día reinicia el contador (si no, se bloquea para siempre)', () => {
  const s = senalesDesdeFila(
    { last_shown_at: '2026-07-28T10:00:00.000Z', shown_today: 2, day: '2026-07-28' },
    9,
    false,
    AHORA,
  )
  assert.equal(s.mostradasHoy, 0)
  assert.equal(decidirMostrar(s, AHORA).mostrar, true)
})

test('una fila de HOY conserva el contador', () => {
  const s = senalesDesdeFila(
    { last_shown_at: '2026-08-03T01:00:00.000Z', shown_today: 2, day: diaLocal(AHORA) },
    9,
    false,
    AHORA,
  )
  assert.equal(s.mostradasHoy, 2)
  assert.equal(decidirMostrar(s, AHORA).motivo, 'tope_diario')
})
