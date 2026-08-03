// ============================================================================
// B07 · Caso 7 de la ficha: con tres tarjetas visibles, EXACTAMENTE UNA activa;
// con `prefers-reduced-motion: reduce`, NINGUNA.
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

const NORMAL: PreferenciasReproduccion = { movimientoReducido: false, ahorroDatos: false }

// ── 7 · exactamente una ─────────────────────────────────────────────────────
test('con tres tarjetas visibles solo una es la activa', () => {
  const activo = elegirActivo(
    [
      { id: 'a', razon: 0.62 },
      { id: 'b', razon: 0.91 },
      { id: 'c', razon: 0.58 },
    ],
    NORMAL,
  )

  assert.equal(activo, 'b')
})

test('el conjunto de activos nunca tiene dos elementos, se pruebe como se pruebe', () => {
  const razones = [0.55, 0.56, 0.7, 0.85, 1, 0.99, 0.6]
  for (let i = 0; i < razones.length; i++) {
    const visibles = razones.map((r, j) => ({ id: `t${j}`, razon: r }))
    const activo = elegirActivo(visibles, NORMAL)
    const activos = visibles.filter((v) => v.id === activo)
    assert.equal(activos.length, 1)
  }
})

test('nadie por debajo del umbral puede ser la activa', () => {
  const activo = elegirActivo(
    [
      { id: 'a', razon: 0.54 },
      { id: 'b', razon: 0.3 },
    ],
    NORMAL,
  )
  assert.equal(activo, null)
  assert.equal(UMBRAL_VISIBILIDAD, 0.55)
})

test('el desempate es estable: no depende del orden en que llegan las entradas', () => {
  const a = elegirActivo([{ id: 'zzz', razon: 0.8 }, { id: 'aaa', razon: 0.8 }], NORMAL)
  const b = elegirActivo([{ id: 'aaa', razon: 0.8 }, { id: 'zzz', razon: 0.8 }], NORMAL)

  assert.equal(a, 'aaa')
  assert.equal(a, b)
})

// ── 7 · FALLO: preferencias que apagan el autoplay ─────────────────────────
test('con prefers-reduced-motion: reduce NINGUNA tarjeta se activa', () => {
  const visibles = [
    { id: 'a', razon: 1 },
    { id: 'b', razon: 0.9 },
    { id: 'c', razon: 0.8 },
  ]

  assert.equal(elegirActivo(visibles, { movimientoReducido: true, ahorroDatos: false }), null)
  assert.equal(autoplayPermitido({ movimientoReducido: true, ahorroDatos: false }), false)
})

test('con saveData tampoco se activa ninguna', () => {
  assert.equal(
    elegirActivo([{ id: 'a', razon: 1 }], { movimientoReducido: false, ahorroDatos: true }),
    null,
  )
})

test('sin tarjetas visibles no hay activa', () => {
  assert.equal(elegirActivo([], NORMAL), null)
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
