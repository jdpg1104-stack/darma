import test from 'node:test'
import assert from 'node:assert/strict'

import {
  KARMA_WEIGHTS,
  KARMA_LEVELS,
  KARMA_COSTS,
  DAILY_KARMA_CAP,
  SPENDABLE_PCT,
  levelForKarma,
  levelLabel,
  spendableFrom,
  applyDailyCap,
  progressToNextLevel,
  canAfford,
} from './karma.ts'

test('pesos: los valores del one-pager, literales', () => {
  assert.equal(KARMA_WEIGHTS.comment_validated.reputation, 10)
  assert.equal(KARMA_WEIGHTS.marked_helpful.reputation, 15)
  assert.equal(KARMA_WEIGHTS.circle_hosted.reputation, 30)
  assert.equal(KARMA_WEIGHTS.content_completed.reputation, 1)
  assert.equal(KARMA_WEIGHTS.spam_penalty.reputation, -40)
  assert.equal(KARMA_WEIGHTS.report_upheld.reputation, -30)
  assert.equal(DAILY_KARMA_CAP, 120)
  assert.equal(SPENDABLE_PCT, 0.3)
})

test('pesos: las penalizaciones no generan gastable ni cuentan para el tope', () => {
  for (const kind of ['spam_penalty', 'report_upheld'] as const) {
    assert.equal(KARMA_WEIGHTS[kind].spendablePct, 0)
    assert.equal(KARMA_WEIGHTS[kind].countsToCap, false)
  }
})

test('costes: boost 50, regalar boost 50, fruto 500', () => {
  assert.equal(KARMA_COSTS.boost, 50)
  assert.equal(KARMA_COSTS.gift_boost, 50)
  assert.equal(KARMA_COSTS.wellness_fruit, 500)
})

test('costes: regalar un boost nunca es más barato que impulsarse a uno mismo', () => {
  assert.ok(KARMA_COSTS.gift_boost >= KARMA_COSTS.boost)
})

// ── levelForKarma ───────────────────────────────────────────────────────────

test('levelForKarma: los umbrales son inclusivos, igual que el CASE del SQL', () => {
  assert.equal(levelForKarma(0), 'semilla')
  assert.equal(levelForKarma(499), 'semilla')
  assert.equal(levelForKarma(500), 'brote')
  assert.equal(levelForKarma(1999), 'brote')
  assert.equal(levelForKarma(2000), 'guia')
  assert.equal(levelForKarma(4999), 'guia')
  assert.equal(levelForKarma(5000), 'mentor')
  assert.equal(levelForKarma(1_000_000), 'mentor')
})

test('levelForKarma: un valor negativo (previsualizar penalización) es semilla', () => {
  assert.equal(levelForKarma(-40), 'semilla')
})

test('levelLabel: la UI muestra el nivel con tilde, la API sin ella', () => {
  assert.equal(levelLabel('guia'), 'Guía')
  assert.equal(KARMA_LEVELS.some((l) => l.level === 'guia'), true)
})

// ── spendableFrom ───────────────────────────────────────────────────────────

test('spendableFrom: trunca hacia abajo, como floor() en SQL', () => {
  assert.equal(spendableFrom(10), 3)   // 3.0
  assert.equal(spendableFrom(15), 4)   // 4.5 → 4, NO 5
  assert.equal(spendableFrom(30), 9)
  assert.equal(spendableFrom(1), 0)    // 0.3 → 0
})

test('spendableFrom: una concesión negativa no genera gastable', () => {
  assert.equal(spendableFrom(-40), 0)
  assert.equal(spendableFrom(-30), 0)
})

// ── applyDailyCap ───────────────────────────────────────────────────────────

test('applyDailyCap: por debajo del tope, la concesión pasa entera', () => {
  const r = applyDailyCap(KARMA_WEIGHTS.comment_validated, 0)
  assert.deepEqual(r, { granted: 10, clipped: 0, capReached: false })
})

test('applyDailyCap: en el borde se RECORTA, no se rechaza', () => {
  // 115 ganados + un comentario de 10 → solo caben 5.
  const r = applyDailyCap(KARMA_WEIGHTS.comment_validated, 115)
  assert.equal(r.granted, 5)
  assert.equal(r.clipped, 5)
  assert.equal(r.capReached, true)
})

test('applyDailyCap: con el tope agotado, la concesión es 0 (nunca negativa)', () => {
  const r = applyDailyCap(KARMA_WEIGHTS.circle_hosted, 120)
  assert.equal(r.granted, 0)
  assert.equal(r.clipped, 30)
})

test('applyDailyCap: las penalizaciones se aplican enteras aunque el tope esté lleno', () => {
  const r = applyDailyCap(KARMA_WEIGHTS.spam_penalty, 120)
  assert.equal(r.granted, -40)
  assert.equal(r.clipped, 0)
  assert.equal(r.capReached, false)
})

test('applyDailyCap: una penalización NO libera cupo del tope', () => {
  // Ganar 120, ser penalizado, y volver a intentar ganar: sigue topado.
  const tras = applyDailyCap(KARMA_WEIGHTS.comment_validated, 120)
  assert.equal(tras.granted, 0)
})

test('applyDailyCap: el tope máximo alcanzable en un día son 120 exactos', () => {
  let acumulado = 0
  for (let i = 0; i < 100; i++) {
    acumulado += applyDailyCap(KARMA_WEIGHTS.marked_helpful, acumulado).granted
  }
  assert.equal(acumulado, DAILY_KARMA_CAP)
})

// ── progressToNextLevel ─────────────────────────────────────────────────────

test('progressToNextLevel: mide dentro del tramo actual, no desde cero', () => {
  const p = progressToNextLevel(2400)
  assert.equal(p.level, 'guia')
  assert.equal(p.currentThreshold, 2000)
  assert.equal(p.nextLevel, 'mentor')
  assert.equal(p.nextThreshold, 5000)
  assert.equal(p.remaining, 2600)
  // 400 / 3000, NO 2400 / 5000.
  assert.ok(Math.abs(p.ratio - 400 / 3000) < 1e-9)
})

test('progressToNextLevel: al entrar en un nivel el progreso es 0', () => {
  const p = progressToNextLevel(500)
  assert.equal(p.level, 'brote')
  assert.equal(p.ratio, 0)
  assert.equal(p.remaining, 1500)
})

test('progressToNextLevel: Mentor es el techo — sin siguiente nivel', () => {
  const p = progressToNextLevel(9000)
  assert.equal(p.level, 'mentor')
  assert.equal(p.nextLevel, null)
  assert.equal(p.nextThreshold, null)
  assert.equal(p.remaining, 0)
  assert.equal(p.ratio, 1)
})

test('progressToNextLevel: ratio siempre en [0, 1]', () => {
  for (const k of [0, 1, 499, 500, 1999, 2000, 4999, 5000, 99999, -100]) {
    const { ratio } = progressToNextLevel(k)
    assert.ok(ratio >= 0 && ratio <= 1, `ratio fuera de rango con karma ${k}`)
  }
})

// ── canAfford ───────────────────────────────────────────────────────────────

test('canAfford: informa de cuánto falta, no solo de que no llega', () => {
  assert.deepEqual(canAfford(30, 'boost'), { ok: false, missing: 20 })
  assert.deepEqual(canAfford(50, 'boost'), { ok: true, missing: 0 })
  assert.deepEqual(canAfford(0, 'wellness_fruit'), { ok: false, missing: 500 })
})
