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
  CLIP_MAX_S,
  CLIP_MIN_S,
  clipValido,
  duracionUtil,
  exigeFragmento,
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

// ============================================================================
// El FRAGMENTO curado (0224_1_b07_clips)
//
// Estas son las pruebas del problema que el fragmento vino a arreglar: con la
// duración del VÍDEO, el +1 de una entrevista de 87 minutos pide 78 minutos
// seguidos y no lo cobra nadie. Con la del fragmento, 36 segundos.
// ============================================================================

test('duracionUtil prefiere el fragmento, luego el vídeo, luego el respaldo', () => {
  assert.equal(duracionUtil(5236, 3120, 3160), 40)
  assert.equal(duracionUtil(5236, null, null), 5236)
  assert.equal(duracionUtil(null, null, null), DURACION_POR_DEFECTO_S)
  // Un ítem sin duración pero CON fragmento cuenta por el fragmento: caerse al
  // respaldo de 60 s aquí pediría más de lo que el trozo dura.
  assert.equal(duracionUtil(null, 10, 50), 40)
})

test('el +1 de una charla de 87 minutos es inalcanzable; el del fragmento no', () => {
  const entera = objetivoCompletado(duracionUtil(5236, null, null))
  const trozo = objetivoCompletado(duracionUtil(5236, 3120, 3160))

  assert.equal(entera, 4713, '78 minutos seguidos: es el feed que no pagaba karma a nadie')
  assert.equal(trozo, 36)
  assert.ok(trozo < entera / 100)
})

test('el acumulado se topa con el FRAGMENTO, no con el vídeo entero', () => {
  const util = duracionUtil(5236, 3120, 3160)
  // Latidos de sobra: ni con cien puede acreditar más de lo que el trozo dura.
  assert.equal(acumular(100, 7, util), 40)
  assert.ok(estaListo(acumular(100, 7, util), util))
})

// ── clipValido · CAMINOS DE FALLO ──────────────────────────────────────────
test('clipValido acepta sin fragmento y un fragmento legítimo', () => {
  assert.equal(clipValido(null, null), true)
  assert.equal(clipValido(3120, 3160, 5236), true)
  assert.equal(clipValido(0, CLIP_MIN_S, 600), true, 'el mínimo exacto entra')
  assert.equal(clipValido(0, CLIP_MAX_S, 600), true, 'el máximo exacto entra')
})

test('clipValido rechaza lo que el CHECK del esquema también rechaza', () => {
  assert.equal(clipValido(30, null), false, 'media pareja')
  assert.equal(clipValido(null, 70), false, 'media pareja')
  assert.equal(clipValido(70, 30), false, 'fin antes que inicio')
  assert.equal(clipValido(30, 30), false, 'longitud cero')
  assert.equal(clipValido(0, CLIP_MIN_S - 1), false, 'por debajo del mínimo')
  assert.equal(clipValido(0, CLIP_MAX_S + 1), false, 'por encima del máximo')
  assert.equal(clipValido(-10, 40), false, 'inicio negativo')
  assert.equal(clipValido(12.5, 52.5), false, 'decimales: el reproductor los ignora')
  assert.equal(clipValido(560, 620, 600), false, 'el fin no cabe en el vídeo')
})

test('sin duración conocida, el fragmento no se rechaza por no caber', () => {
  // Los ítems del feed Atom llegan sin duración. Exigir que quepa sería
  // impedir curar justo lo que peor documentado llega.
  assert.equal(clipValido(3120, 3160, null), true)
})

// ── exigeFragmento ─────────────────────────────────────────────────────────
test('exigeFragmento solo cuando la duración consta y pasa del techo', () => {
  assert.equal(exigeFragmento(5236), true, 'una charla de 87 minutos')
  assert.equal(exigeFragmento(CLIP_MAX_S + 1), true)
  assert.equal(exigeFragmento(CLIP_MAX_S), false, 'ya dura lo que un fragmento')
  assert.equal(exigeFragmento(45), false, 'el clip de 45 s de la OPS va entero')
  assert.equal(exigeFragmento(null), false, 'sin duración no se puede exigir nada')
})

// ── ESPEJO con el SQL ──────────────────────────────────────────────────────
// La cabecera de este archivo promete que las constantes son el espejo de la
// migración. Sin esto, la promesa es un comentario: alguien cambia el techo
// aquí, la base sigue rechazando a los 180 y el fallo aparece como un error
// interno al guardar.
test('los topes coinciden con el CHECK de 0224_1_b07_clips.sql', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(
    new URL('../../supabase/migrations/0224_1_b07_clips.sql', import.meta.url),
    'utf8',
  )

  assert.ok(
    sql.includes(`between ${CLIP_MIN_S} and ${CLIP_MAX_S}`),
    `el CHECK content_items_clip_rango debe decir «between ${CLIP_MIN_S} and ${CLIP_MAX_S}»`,
  )
})

test('el respaldo de duración coincide con el de duracion_util() en el SQL', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(
    new URL('../../supabase/migrations/0224_1_b07_clips.sql', import.meta.url),
    'utf8',
  )

  // El cuerpo de la función, entre `as $$` y el `$$;` que lo cierra.
  const desde = sql.indexOf('create or replace function public.duracion_util')
  const cuerpo = sql.slice(sql.indexOf('as $$', desde), sql.indexOf('$$;', desde))

  // Se comparan los números SUELTOS del cuerpo, no una subcadena: `600`
  // contiene `60` y pasaría sin ser lo mismo. El único número que debe haber
  // ahí es el respaldo.
  const numeros = cuerpo.match(/\b\d+\b/g) ?? []
  assert.deepEqual(
    numeros,
    [String(DURACION_POR_DEFECTO_S)],
    'duracion_util() debería llevar un solo número —el respaldo— y ser el mismo que aquí',
  )
})
