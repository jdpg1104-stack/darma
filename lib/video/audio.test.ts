// ============================================================================
// B07 · Caso 8 de la ficha: sin gesto previo `puedeSonar()` es false; tras
// `pointerdown`, true; tras simular una RECARGA, vuelve a false.
//
// La tercera parte es la que importa. Persistir el desbloqueo (sessionStorage,
// localStorage, una cookie) hace que tras un F5 creamos tener permiso, pidamos
// `unMute` sin activación real y el navegador PAUSE el vídeo: la persona se
// queda sin vídeo y sin sonido, y el botón 🔇 no aparece porque «según
// nosotros» ya estaba desbloqueado. Simular la recarga es construir un estado
// nuevo, igual que el navegador construye un documento nuevo.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GESTOS_INVALIDOS,
  GESTOS_VALIDOS,
  esGestoValido,
  estadoInicial,
  puedeSonar,
  registrarGesto,
} from './audio.ts'

// ── 8 ───────────────────────────────────────────────────────────────────────
test('sin gesto previo no puede sonar', () => {
  const estado = estadoInicial()
  assert.equal(puedeSonar(estado), false)
})

test('tras pointerdown sí puede sonar', () => {
  const estado = estadoInicial()
  assert.equal(registrarGesto(estado, 'pointerdown'), true)
  assert.equal(puedeSonar(estado), true)
})

test('tras simular una recarga vuelve a false', () => {
  const antes = estadoInicial()
  registrarGesto(antes, 'pointerdown')
  assert.equal(puedeSonar(antes), true)

  // Recarga: documento nuevo, estado nuevo. Nada sobrevive.
  const despues = estadoInicial()
  assert.equal(puedeSonar(despues), false)
})

// ── El scroll NO es activación ─────────────────────────────────────────────
test('el scroll no desbloquea el audio', () => {
  const estado = estadoInicial()

  for (const tipo of GESTOS_INVALIDOS) {
    assert.equal(esGestoValido(tipo), false, `${tipo} no cuenta como gesto`)
    assert.equal(registrarGesto(estado, tipo), false)
    assert.equal(puedeSonar(estado), false)
  }
})

test('los tres gestos válidos son los que el navegador reconoce', () => {
  assert.deepEqual([...GESTOS_VALIDOS], ['pointerdown', 'keydown', 'touchend'])

  for (const tipo of GESTOS_VALIDOS) {
    const estado = estadoInicial()
    assert.equal(registrarGesto(estado, tipo), true)
    assert.equal(puedeSonar(estado), true)
  }
})

test('registrarGesto solo avisa del CAMBIO, no de cada pulsación', () => {
  const estado = estadoInicial()
  assert.equal(registrarGesto(estado, 'pointerdown'), true)
  assert.equal(registrarGesto(estado, 'pointerdown'), false)
  assert.equal(registrarGesto(estado, 'keydown'), false)
})

// ── navigator.userActivation manda sobre nuestro caché ─────────────────────
test('si el navegador ya vio un gesto, no hace falta esperar a otro', () => {
  const estado = estadoInicial()
  assert.equal(puedeSonar(estado, { hasBeenActive: true }), true)
  assert.equal(puedeSonar(estado, { hasBeenActive: false }), false)
  assert.equal(puedeSonar(estado, null), false)
})

test('isActive sin hasBeenActive no basta: la condición del navegador es hasBeenActive', () => {
  const estado = estadoInicial()
  assert.equal(puedeSonar(estado, { isActive: true }), false)
})
