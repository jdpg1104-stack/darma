// ============================================================================
// B07 · La prueba del anti-farmeo.
//
// El caso 3 de la ficha es el que decide si el bloque sirve para algo:
//   · 12 latidos separados 5 s acreditan ~60 s.
//   · 12 latidos enviados EN EL MISMO SEGUNDO acreditan como máximo 12 s.
//
// Estas funciones son el espejo en TypeScript de `latido_contenido()`. La
// autoridad sigue siendo Postgres (y contra Postgres está verificado: 12
// latidos simultáneos acreditaron 0 s y un latido declarando 300 s acreditó 7);
// esto es lo que permite cubrir el espacio de casos sin base de datos.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DURACION_POR_DEFECTO_S,
  TOPE_POR_LATIDO_S,
  acreditarLatido,
  estaListo,
  faltanSegundos,
  objetivoCompletado,
} from './acreditacion.ts'

/** Simula una tanda de latidos con un delta REAL fijo entre ellos. */
function acumular(latidos: number, deltaSegundos: number, duracion: number | null): number {
  let total = 0
  for (let i = 0; i < latidos; i++) total = acreditarLatido(total, deltaSegundos, duracion)
  return total
}

// ── 3 · CAMINO FELIZ ────────────────────────────────────────────────────────
test('12 latidos separados 5 s acreditan ~60 s', () => {
  assert.equal(acumular(12, 5, 120), 60)
})

// ── 3 · CAMINO DE FALLO: el farmeo ─────────────────────────────────────────
test('12 latidos en el mismo segundo NO acreditan 60 s', () => {
  // El delta REAL entre latidos guardados y descargados de golpe es ~0.
  assert.equal(acumular(12, 0, 120), 0)

  // Y aunque el atacante consiguiera un segundo entero de separación real, el
  // techo son 12 s, no 60.
  assert.equal(acumular(12, 1, 120), 12)
  assert.ok(acumular(12, 1, 120) <= 12)
})

test('un latido no puede declarar 300 s: el tope por llamada son 7', () => {
  assert.equal(acreditarLatido(0, 300, 600), TOPE_POR_LATIDO_S)
  assert.equal(acreditarLatido(0, 86_400, 600), TOPE_POR_LATIDO_S)
  assert.equal(acreditarLatido(0, Number.MAX_SAFE_INTEGER, 600), TOPE_POR_LATIDO_S)
})

test('un delta negativo (reloj hacia atrás) no resta ni suma', () => {
  assert.equal(acreditarLatido(30, -100, 600), 30)
})

test('el acumulado nunca supera la duración del vídeo', () => {
  // 1000 latidos al máximo permitido sobre un vídeo de 60 s.
  assert.equal(acumular(1000, TOPE_POR_LATIDO_S, 60), 60)
})

test('sin duration_seconds se usa el mínimo razonable, no "cualquier cosa vale"', () => {
  assert.equal(objetivoCompletado(null), Math.ceil(0.9 * DURACION_POR_DEFECTO_S))
  assert.equal(objetivoCompletado(null), 54)
  // Un solo latido NO completa un vídeo sin duración conocida.
  assert.equal(estaListo(acreditarLatido(0, 7, null), null), false)
})

// ── Umbral del 90 % ─────────────────────────────────────────────────────────
test('el +1 exige el 90 % de la duración, redondeado hacia arriba', () => {
  assert.equal(objetivoCompletado(60), 54)
  assert.equal(objetivoCompletado(120), 108)
  assert.equal(objetivoCompletado(101), 91)

  assert.equal(estaListo(53, 60), false)
  assert.equal(estaListo(54, 60), true)
})

test('faltan nunca es negativo: es lo que pinta la barra de progreso', () => {
  assert.equal(faltanSegundos(0, 60), 54)
  assert.equal(faltanSegundos(54, 60), 0)
  assert.equal(faltanSegundos(60, 60), 0)
})

// ── El coste real del ataque ────────────────────────────────────────────────
test('agotar el tope diario exige el tiempo real de 120 vídeos', () => {
  // 120 vídeos × 54 s exigidos = 6480 s. Con el tope de 7 s por latido, eso son
  // como mínimo 926 latidos, y el rate limit los acota a 20/min por vídeo.
  const segundosPorVideo = objetivoCompletado(60)
  const latidosMinimos = Math.ceil(segundosPorVideo / TOPE_POR_LATIDO_S)

  assert.equal(segundosPorVideo * 120, 6480)
  assert.ok(latidosMinimos >= 8)
  // Y el tiempo real es irreducible: el delta lo mide el reloj del servidor.
  assert.equal(acumular(latidosMinimos, TOPE_POR_LATIDO_S, 60), 56)
})
