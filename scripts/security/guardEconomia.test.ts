// ============================================================================
// Tests del guard de economía.
//
// Un guard que nunca ha fallado no está probado: no sabes si detecta algo o si
// simplemente devuelve `[]` siempre. Por eso hay dos mitades:
//   · camino feliz — contra las migraciones REALES: debe devolver [].
//   · camino de fallo — contra un SQL MANIPULADO en memoria: debe señalar el
//     valor, el archivo y la línea.
//
// El fixture manipulado se deriva del archivo real con un `replace`: así no se
// toca la migración (que ya está aplicada) y el fixture no puede quedarse
// obsoleto respecto al original.
//
// Ejecutar:
//   node --test --experimental-strip-types "scripts/security/*.test.ts"
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compararEconomia,
  comprobarRepositorio,
  formatearInforme,
  parsearPesosSql,
  parsearHotSql,
  evaluarHotSql,
  ARCHIVO_0001,
} from './guardEconomia.ts'
import { computeHotScore, EPOCH_ANCHOR_SECONDS } from '../../lib/feedRanking.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

const SQL_0001 = readFileSync(join(RAIZ, 'supabase', 'migrations', '0001_core.sql'), 'utf8')
const SQL_0002 = readFileSync(join(RAIZ, 'supabase', 'migrations', '0002_comunidad.sql'), 'utf8')

// ── Camino feliz (punto 1 de la ficha) ──────────────────────────────────────

test('1 · compararEconomia sobre las migraciones reales no encuentra nada', () => {
  const hallazgos = compararEconomia(SQL_0001, SQL_0002)
  assert.deepEqual(
    hallazgos,
    [],
    `La economía de TypeScript y la de SQL han divergido:\n${formatearInforme(hallazgos)}`,
  )
})

test('1 bis · comprobarRepositorio lee las migraciones del repo y sale limpio', () => {
  assert.deepEqual(comprobarRepositorio(RAIZ), [])
})

test('el parser encuentra las siete clases de karma, incluida karma_spend', () => {
  const filas = parsearPesosSql(SQL_0001)
  const kinds = filas.map((f) => f.kind).sort()
  assert.deepEqual(kinds, [
    'circle_hosted',
    'comment_validated',
    'content_completed',
    'karma_spend',
    'marked_helpful',
    'report_upheld',
    'spam_penalty',
  ])
  // Cada fila trae su línea real: sin eso el informe no es accionable.
  assert.ok(filas.every((f) => f.linea > 0))
})

// ── Camino de fallo (punto 5 de la ficha) ───────────────────────────────────

test('5 · compararEconomia con un SQL manipulado (comment_validated a 11) lo señala con archivo y línea', () => {
  // Fixture en memoria: se cambia el 10 por un 11 en la fila de la migración.
  const manipulado = SQL_0001.replace(
    "('comment_validated',  10, 0.300,",
    "('comment_validated',  11, 0.300,",
  )
  assert.notEqual(manipulado, SQL_0001, 'el fixture no llegó a modificar nada; revisa el literal')

  const hallazgos = compararEconomia(manipulado, SQL_0002)
  const d = hallazgos.find((x) => x.clave === 'comment_validated.reputation')

  assert.ok(d, `se esperaba una discrepancia de comment_validated.reputation:\n${formatearInforme(hallazgos)}`)
  assert.equal(d.enTypeScript, 10)
  assert.equal(d.enSql, 11)
  assert.equal(d.archivoSql, ARCHIVO_0001)
  assert.ok(d.lineaSql > 0, 'la discrepancia debe traer el número de línea')

  // Y el informe tiene que decir dónde mirar.
  const informe = formatearInforme(hallazgos)
  assert.match(informe, /comment_validated\.reputation/)
  assert.match(informe, new RegExp(`${ARCHIVO_0001.replace(/[/.]/g, '\\$&')}:${d.lineaSql}`))
})

test('5 bis · un tope diario distinto de 120 se detecta', () => {
  const manipulado = SQL_0001.replace('120 - v_earned_today', '400 - v_earned_today')
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  const d = hallazgos.find((x) => x.clave === 'DAILY_KARMA_CAP')
  assert.ok(d)
  assert.equal(d.enTypeScript, 120)
  assert.equal(d.enSql, 400)
})

test('5 ter · un umbral de nivel movido se detecta', () => {
  const manipulado = SQL_0001.replace("karma_reputation >= 2000 then 'guia'", "karma_reputation >= 2500 then 'guia'")
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  const d = hallazgos.find((x) => x.clave === 'KARMA_LEVELS.guia')
  assert.ok(d)
  assert.equal(d.enSql, 2500)
})

test('5 quater · romper el 3:1 de la reciprocidad se detecta en los DOS literales', () => {
  // El descuento y el umbral son literales distintos en la misma sentencia:
  // cambiar uno y no el otro regala créditos o los cobra de más.
  const manipulado = SQL_0001.replace('listen_credits - 3', 'listen_credits - 1')
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  const d = hallazgos.find((x) => x.clave === 'LISTENS_PER_POST.descuento')
  assert.ok(d)
  assert.equal(d.enSql, 1)
})

test('5 quinquies · borrar la clase karma_spend del SQL se detecta (regresión R4)', () => {
  const manipulado = SQL_0001.replace(
    /\s*\('karma_spend',\s*0,\s*0\.000,[^)]*\)/,
    '',
  ).replace(/,\s*;/, ';')
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  assert.ok(
    hallazgos.some((x) => x.clave === 'karma_weights.karma_spend'),
    'sin la clase karma_spend, spend_karma() vuelve a etiquetar los gastos como comment_validated',
  )
})

// ── La fórmula del hot score ────────────────────────────────────────────────

test('la fórmula del hot score coincide en 20 pares de valores', () => {
  const c = parsearHotSql(SQL_0001)
  assert.ok(c, 'no se pudo parsear compute_hot_score()')

  for (let i = 0; i < 20; i++) {
    const up = i * 3
    const re = 20 - i
    const createdMs = (EPOCH_ANCHOR_SECONDS + (i - 10) * 3600) * 1000
    const enTs = computeHotScore({
      upvote_count: up,
      reply_count: re,
      created_at: new Date(createdMs).toISOString(),
    })
    const enSql = evaluarHotSql(c, up, re, Math.floor(createdMs / 1000))
    assert.ok(Math.abs(enTs - enSql) <= 1e-9, `hot score distinto en (${up}, ${re}): ${enTs} vs ${enSql}`)
  }
})

test('cambiar el peso de las respuestas en el SQL rompe la paridad', () => {
  const manipulado = SQL_0001.replaceAll('13.5 * p_replies', '9.0 * p_replies')
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  assert.ok(hallazgos.some((x) => x.clave === 'W_REPLY'))
  assert.ok(
    hallazgos.some((x) => x.clave.startsWith('computeHotScore(')),
    'además de la constante, la comparación numérica debe detectarlo',
  )
})

test('cambiar el ancla de época se detecta', () => {
  const manipulado = SQL_0001.replace('1767225600', '1700000000')
  const hallazgos = compararEconomia(manipulado, SQL_0002)
  assert.ok(hallazgos.some((x) => x.clave === 'EPOCH_ANCHOR_SECONDS'))
})

// ── 0002 ────────────────────────────────────────────────────────────────────

test('una clase de karma inventada en 0002 se detecta', () => {
  // replaceAll: la clase aparece también en un comentario justo encima de la
  // llamada, y un replace simple solo tocaría ese comentario.
  const manipulado = SQL_0002.replaceAll("'content_completed'", "'clase_que_no_existe'")
  const hallazgos = compararEconomia(SQL_0001, manipulado)
  assert.ok(hallazgos.some((x) => x.clave.includes('clase_que_no_existe')))
})

test('el informe de éxito es explícito (nada de salidas silenciosas)', () => {
  assert.match(formatearInforme([]), /OK/)
})
