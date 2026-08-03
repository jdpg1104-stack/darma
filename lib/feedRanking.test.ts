import test from 'node:test'
import assert from 'node:assert/strict'

import {
  W_UPVOTE,
  W_REPLY,
  GRAVITY_SECONDS,
  EPOCH_ANCHOR_SECONDS,
  BOOST_BONUS,
  computeHotScore,
  isBoostEligible,
  effectiveScore,
  rankFeed,
  encodeCursor,
  decodeCursor,
  nextCursorFrom,
  type FeedRow,
} from './feedRanking.ts'

const ANCHOR_ISO = '2026-01-01T00:00:00.000Z'
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('constantes: los pesos del Heavy Ranker no se tocan sin cambiar el SQL', () => {
  assert.equal(W_UPVOTE, 1)
  assert.equal(W_REPLY, 13.5)
  assert.equal(GRAVITY_SECONDS, 45000)
  // 2026-01-01T00:00:00Z, el literal que aparece en compute_hot_score().
  assert.equal(EPOCH_ANCHOR_SECONDS, 1767225600)
})

test('computeHotScore: en el ancla y sin señal, el score es 0', () => {
  const score = computeHotScore({ upvote_count: 0, reply_count: 0, created_at: ANCHOR_ISO })
  assert.equal(score, 0)
})

test('computeHotScore: reproduce la fórmula sign·log10 + edad/gravedad', () => {
  const row = { upvote_count: 10, reply_count: 2, created_at: '2026-01-02T00:00:00.000Z' }
  // señal social: 1·10 votos + 13,5·2 respuestas = 37
  const expected = Math.log10(37) + 86400 / GRAVITY_SECONDS
  assert.equal(computeHotScore(row), expected)
})

test('computeHotScore: una respuesta vale mucho más que un voto', () => {
  const base = { created_at: ANCHOR_ISO }
  const conVotos = computeHotScore({ ...base, upvote_count: 13, reply_count: 0 })
  const conRespuesta = computeHotScore({ ...base, upvote_count: 0, reply_count: 1 })
  assert.ok(conRespuesta > conVotos, 'una respuesta debe superar a 13 votos')
})

test('computeHotScore: nulos se tratan como 0 (columnas recién creadas)', () => {
  assert.equal(computeHotScore({ upvote_count: null, reply_count: null, created_at: ANCHOR_ISO }), 0)
})

test('computeHotScore: no depende del "ahora" — el orden es estable entre lecturas', () => {
  const row = { upvote_count: 5, reply_count: 1, created_at: '2026-03-01T10:00:00.000Z' }
  assert.equal(computeHotScore(row), computeHotScore(row))
})

// ── Boost ───────────────────────────────────────────────────────────────────

const now = new Date('2026-06-01T12:00:00.000Z')
const futuro = '2026-06-01T18:00:00.000Z'
const pasado = '2026-06-01T06:00:00.000Z'

const basePost = (extra: Partial<FeedRow> = {}): FeedRow => ({
  id: uuid(1),
  upvote_count: 3,
  reply_count: 1,
  created_at: '2026-06-01T09:00:00.000Z',
  ...extra,
})

test('boost: se aplica dentro de la ventana', () => {
  const row = basePost({ boost_until: futuro })
  assert.equal(isBoostEligible(row, now), true)
  assert.equal(effectiveScore(row, now), computeHotScore(row) + BOOST_BONUS)
})

test('boost: no se aplica fuera de la ventana', () => {
  assert.equal(isBoostEligible(basePost({ boost_until: pasado }), now), false)
})

test('boost: sin boost_until no hay bono', () => {
  assert.equal(isBoostEligible(basePost(), now), false)
  assert.equal(effectiveScore(basePost(), now), computeHotScore(basePost()))
})

test('LÍNEA ROJA: el boost NO revive contenido moderado', () => {
  for (const state of ['hidden', 'removed'] as const) {
    const row = basePost({ boost_until: futuro, state })
    assert.equal(isBoostEligible(row, now), false, `estado ${state} no debe recibir boost`)
    assert.equal(effectiveScore(row, now), computeHotScore(row))
  }
})

test('LÍNEA ROJA: el boost NO promociona contenido de crisis', () => {
  for (const risk of ['high', 'critical'] as const) {
    const row = basePost({ boost_until: futuro, risk })
    assert.equal(isBoostEligible(row, now), false, `riesgo ${risk} no debe recibir boost`)
  }
  // Riesgo bajo o nulo sí es promocionable.
  assert.equal(isBoostEligible(basePost({ boost_until: futuro, risk: 'low' }), now), true)
  assert.equal(isBoostEligible(basePost({ boost_until: futuro, risk: 'none' }), now), true)
})

test('boost: una fecha corrupta no concede bono (fallo hacia el lado seguro)', () => {
  assert.equal(isBoostEligible(basePost({ boost_until: 'no-es-una-fecha' }), now), false)
})

test('boost: +1.0 equivale exactamente a multiplicar por 10 la señal social', () => {
  const sinBoost = basePost({ upvote_count: 10, reply_count: 0, created_at: ANCHOR_ISO })
  const conSenal10x = basePost({ upvote_count: 100, reply_count: 0, created_at: ANCHOR_ISO })
  assert.ok(
    Math.abs((computeHotScore(sinBoost) + BOOST_BONUS) - computeHotScore(conSenal10x)) < 1e-9,
  )
})

// ── Orden ───────────────────────────────────────────────────────────────────

test('rankFeed: ordena descendente y no muta la entrada', () => {
  const rows: FeedRow[] = [
    basePost({ id: uuid(1), upvote_count: 1, reply_count: 0 }),
    basePost({ id: uuid(2), upvote_count: 0, reply_count: 5 }),
    basePost({ id: uuid(3), upvote_count: 10, reply_count: 0 }),
  ]
  const copia = [...rows]
  const ordenado = rankFeed(rows, now)

  assert.equal(ordenado[0]!.id, uuid(2))
  assert.deepEqual(rows, copia, 'rankFeed no debe mutar el arreglo original')
})

test('rankFeed: desempata por id descendente, igual que idx_posts_hot', () => {
  const comun = { upvote_count: 2, reply_count: 1, created_at: ANCHOR_ISO }
  const ordenado = rankFeed([
    { id: uuid(1), ...comun },
    { id: uuid(3), ...comun },
    { id: uuid(2), ...comun },
  ], now)
  assert.deepEqual(ordenado.map((r) => r.id), [uuid(3), uuid(2), uuid(1)])
})

test('rankFeed: un post con boost adelanta a uno con algo más de señal', () => {
  const sinBoost = basePost({ id: uuid(1), upvote_count: 20, reply_count: 0 })
  const conBoost = basePost({ id: uuid(2), upvote_count: 10, reply_count: 0, boost_until: futuro })
  assert.equal(rankFeed([sinBoost, conBoost], now)[0]!.id, uuid(2))
})

// ── Cursor keyset ───────────────────────────────────────────────────────────

test('cursor: ida y vuelta conserva score e id', () => {
  const cursor = { hotScore: 123.456789, id: uuid(42) }
  const decoded = decodeCursor(encodeCursor(cursor))
  assert.deepEqual(decoded, cursor)
})

test('cursor: soporta scores negativos (posts anteriores al ancla)', () => {
  const cursor = { hotScore: -3.25, id: uuid(7) }
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor)
})

test('cursor: es opaco (no se lee el uuid a simple vista)', () => {
  const token = encodeCursor({ hotScore: 1, id: uuid(1) })
  assert.ok(!token.includes('-'), 'el token no debe exponer el uuid en claro')
  // base64url: nada de +, / ni =
  assert.match(token, /^[A-Za-z0-9_-]+$/)
})

test('cursor: entrada inválida devuelve null en vez de lanzar', () => {
  assert.equal(decodeCursor(null), null)
  assert.equal(decodeCursor(''), null)
  assert.equal(decodeCursor('no-es-base64-valido!!'), null)
  assert.equal(decodeCursor(Buffer.from('sin-separador').toString('base64url')), null)
  assert.equal(decodeCursor(Buffer.from('1.5|no-es-uuid').toString('base64url')), null)
  assert.equal(decodeCursor(Buffer.from(`abc|${uuid(1)}`).toString('base64url')), null)
})

test('nextCursorFrom: null en página vacía, cursor de la última fila si no', () => {
  assert.equal(nextCursorFrom([]), null)
  const token = nextCursorFrom([
    { id: uuid(1), hot_score: 5 },
    { id: uuid(2), hot_score: 3 },
  ])
  assert.deepEqual(decodeCursor(token), { hotScore: 3, id: uuid(2) })
})
