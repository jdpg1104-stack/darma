// ============================================================================
// B07 · Caso 7 de la ficha: con tres tarjetas visibles, EXACTAMENTE UNA activa.
// Las preferencias (`prefers-reduced-motion`, `saveData`) apagan la
// REPRODUCCIÓN automática (`autoplayPermitido`), nunca la SELECCIÓN: cuando la
// apagaban, quien pedía menos movimiento se quedaba sin tarjeta activa, sin
// latidos y sin su +1 aunque viera el vídeo entero a mano (spec e2e 06/11).
//
// Es la prueba del bug clásico de los feeds verticales —dos vídeos sonando a la
// vez en una pantalla alta— y solo se puede escribir porque la decisión está
// separada del DOM.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UMBRAL_VISIBILIDAD,
  autoplayPermitido,
  elegirActivo,
  ventanaDeIframes,
  type PreferenciasReproduccion,
} from './autoplay.ts'

// ── 7 · exactamente una ─────────────────────────────────────────────────────
test('con tres tarjetas visibles solo una es la activa', () => {
  const activo = elegirActivo([
    { id: 'a', razon: 0.62 },
    { id: 'b', razon: 0.91 },
    { id: 'c', razon: 0.58 },
  ])

  assert.equal(activo, 'b')
})

test('el conjunto de activos nunca tiene dos elementos, se pruebe como se pruebe', () => {
  const razones = [0.55, 0.56, 0.7, 0.85, 1, 0.99, 0.6]
  for (let i = 0; i < razones.length; i++) {
    const visibles = razones.map((r, j) => ({ id: `t${j}`, razon: r }))
    const activo = elegirActivo(visibles)
    const activos = visibles.filter((v) => v.id === activo)
    assert.equal(activos.length, 1)
  }
})

test('nadie por debajo del umbral puede ser la activa', () => {
  const activo = elegirActivo([
    { id: 'a', razon: 0.54 },
    { id: 'b', razon: 0.3 },
  ])
  assert.equal(activo, null)
  assert.equal(UMBRAL_VISIBILIDAD, 0.55)
})

test('el desempate es estable: no depende del orden en que llegan las entradas', () => {
  const a = elegirActivo([{ id: 'zzz', razon: 0.8 }, { id: 'aaa', razon: 0.8 }])
  const b = elegirActivo([{ id: 'aaa', razon: 0.8 }, { id: 'zzz', razon: 0.8 }])

  assert.equal(a, 'aaa')
  assert.equal(a, b)
})

// ── 7 · Las preferencias apagan la REPRODUCCIÓN, nunca la selección ─────────
test('🔴 con prefers-reduced-motion la tarjeta SIGUE seleccionándose (solo se apaga el arranque)', () => {
  // Si la selección devolviera null, no habría latidos y quien pide menos
  // movimiento vería el vídeo entero a mano sin recibir jamás su +1: la
  // preferencia de accesibilidad lo expulsaría de la economía en silencio.
  const visibles = [
    { id: 'a', razon: 1 },
    { id: 'b', razon: 0.9 },
  ]
  assert.equal(elegirActivo(visibles), 'a')
  assert.equal(autoplayPermitido({ movimientoReducido: true, ahorroDatos: false }), false)
})

test('con saveData igual: selección sí, arranque automático no', () => {
  assert.equal(elegirActivo([{ id: 'a', razon: 1 }]), 'a')
  assert.equal(autoplayPermitido({ movimientoReducido: false, ahorroDatos: true }), false)
})

test('sin tarjetas visibles no hay activa', () => {
  assert.equal(elegirActivo([]), null)
})

// ── La ventana de tres iframes ──────────────────────────────────────────────
test('solo la activa y sus dos vecinas montan iframe', () => {
  const orden = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  const vivos = ventanaDeIframes(orden, 'e')

  assert.equal(vivos.size, 3)
  assert.deepEqual([...vivos].sort(), ['d', 'e', 'f'])
  assert.equal(vivos.has('a'), false)
})

test('en los extremos la ventana se recorta, no se sale de la lista', () => {
  const orden = ['a', 'b', 'c']
  assert.deepEqual([...ventanaDeIframes(orden, 'a')].sort(), ['a', 'b'])
  assert.deepEqual([...ventanaDeIframes(orden, 'c')].sort(), ['b', 'c'])
})

test('sin activa (autoplay apagado) se monta la primera, no cero', () => {
  // Si no, con prefers-reduced-motion el feed no tendría ni un reproductor y
  // tocar la tarjeta no haría nada.
  assert.deepEqual([...ventanaDeIframes(['a', 'b', 'c'], null)].sort(), ['a', 'b'])
  assert.equal(ventanaDeIframes([], null).size, 0)
})

// ── Desempate por superficie visible (portado de DataLaps, B21 §3) ──────────

test('🔴 una tarjeta corta vista entera NO le gana a una alta que ocupa más pantalla', () => {
  // El fallo que esto evita es latente hoy —todas las tarjetas son 100dvh— y
  // silencioso mañana: sin superficie, la de razon 1,0 gana aunque ocupe cinco
  // veces menos pantalla, y no hay error ni prueba roja que lo delate.
  const elegida = elegirActivo([
    { id: 'corta', razon: 1.0, superficie: 200 * 150 },
    { id: 'alta', razon: 0.8, superficie: 400 * 700 },
  ])
  assert.equal(elegida, 'alta')
})

test('sin superficie se desempata por razón, como antes', () => {
  assert.equal(elegirActivo([{ id: 'a', razon: 0.7 }, { id: 'b', razon: 0.9 }]), 'b')
})

test('mezclar tarjetas con y sin superficie no deja ganar a quien la declara', () => {
  // Comparar px² contra una fracción no tiene sentido; si solo una la trae, se
  // cae al criterio común (razón) en vez de inventar una comparación.
  assert.equal(
    elegirActivo([{ id: 'a', razon: 0.9, superficie: 10 }, { id: 'b', razon: 0.6 }]),
    'a',
  )
})

test('el umbral se sigue midiendo sobre la razón, no sobre la superficie', () => {
  // Una tarjeta enorme apenas asomando NO debe reproducir: se ve poco DE ELLA.
  assert.equal(elegirActivo([{ id: 'gigante', razon: 0.2, superficie: 999_999 }]), null)
})

test('el empate total se resuelve por id, para que no parpadee', () => {
  const args = [{ id: 'b', razon: 0.9, superficie: 100 }, { id: 'a', razon: 0.9, superficie: 100 }]
  assert.equal(elegirActivo(args), 'a')
  assert.equal(elegirActivo([...args].reverse()), 'a')
})
