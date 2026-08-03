import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LISTENS_PER_POST,
  canPublish,
  creditsNeeded,
  listensRemaining,
  reciprocityMessage,
  type ReciprocityState,
} from './reciprocity.ts'

const now = new Date('2026-06-01T12:00:00.000Z')

const state = (overrides: Partial<ReciprocityState> = {}): ReciprocityState => ({
  listenCredits: 0,
  postsPublished: 5,
  bannedUntil: null,
  ...overrides,
})

test('la regla es 3:1', () => {
  assert.equal(LISTENS_PER_POST, 3)
})

test('el primer post es gratis (rama posts_published = 0 del trigger)', () => {
  const r = canPublish(state({ postsPublished: 0, listenCredits: 0 }), now)
  assert.equal(r.allowed, true)
  assert.equal(r.isFirstPost, true)
  assert.equal(r.creditsNeeded, 0)
})

test('a partir del segundo post hacen falta 3 créditos', () => {
  assert.equal(canPublish(state({ listenCredits: 2 }), now).allowed, false)
  assert.equal(canPublish(state({ listenCredits: 3 }), now).allowed, true)
  assert.equal(canPublish(state({ listenCredits: 10 }), now).allowed, true)
})

test('creditsNeeded: cuenta lo que falta, nunca negativo', () => {
  assert.equal(creditsNeeded(state({ listenCredits: 0 })), 3)
  assert.equal(creditsNeeded(state({ listenCredits: 1 })), 2)
  assert.equal(creditsNeeded(state({ listenCredits: 3 })), 0)
  assert.equal(creditsNeeded(state({ listenCredits: 99 })), 0)
})

test('creditsNeeded: un saldo corrupto negativo se trata como 0 créditos', () => {
  assert.equal(creditsNeeded(state({ listenCredits: -5 })), 3)
})

test('listensRemaining habla de personas, y coincide con los créditos', () => {
  const s = state({ listenCredits: 1 })
  assert.equal(listensRemaining(s), creditsNeeded(s))
})

test('baneo: bloquea aunque sobren créditos, y con otro motivo', () => {
  const r = canPublish(state({ listenCredits: 99, bannedUntil: '2026-06-02T00:00:00.000Z' }), now)
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'banned')
  // No se le dice "te faltan escuchas": sería mentira.
  assert.equal(r.creditsNeeded, 0)
})

test('baneo: un baneo ya vencido no bloquea', () => {
  const r = canPublish(state({ listenCredits: 3, bannedUntil: '2026-05-01T00:00:00.000Z' }), now)
  assert.equal(r.allowed, true)
  assert.equal(r.reason, null)
})

test('baneo: una fecha corrupta se trata como baneo vigente (lado seguro)', () => {
  assert.equal(canPublish(state({ bannedUntil: 'basura' }), now).allowed, false)
})

test('baneo: tiene prioridad sobre el primer post gratis', () => {
  const r = canPublish(state({ postsPublished: 0, bannedUntil: '2026-07-01T00:00:00.000Z' }), now)
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'banned')
})

// ── Copy ────────────────────────────────────────────────────────────────────

test('el mensaje nunca usa la palabra "crédito" de cara al usuario', () => {
  const casos: ReciprocityState[] = [
    state({ listenCredits: 0 }),
    state({ listenCredits: 2 }),
    state({ listenCredits: 3 }),
    state({ postsPublished: 0 }),
    state({ bannedUntil: '2026-07-01T00:00:00.000Z' }),
  ]
  for (const s of casos) {
    const msg = reciprocityMessage(s, now)
    assert.ok(!/cr[eé]dito/i.test(msg), `el copy no debe hablar de créditos: "${msg}"`)
    assert.ok(msg.length > 0)
  }
})

test('el mensaje concuerda en singular cuando falta una sola persona', () => {
  const msg = reciprocityMessage(state({ listenCredits: 2 }), now)
  assert.match(msg, /una persona/)
  assert.ok(!/1 personas/.test(msg))
})

test('el mensaje dice cuántas faltan cuando son varias', () => {
  assert.match(reciprocityMessage(state({ listenCredits: 1 }), now), /2 personas/)
  assert.match(reciprocityMessage(state({ listenCredits: 0 }), now), /3 personas/)
})
