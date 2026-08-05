import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ALIAS_NOUNS,
  ALIAS_ADJECTIVES,
  ALIAS_SPACE,
  createIdentitySeed,
  createAnonymousIdentity,
  deriveAlias,
  deriveAvatarSeed,
  detectPii,
  assertNoPii,
  redactPii,
  PiiDetectedError,
} from './anonymity.ts'
import * as pii from './pii.ts'

// El CHECK exacto de la columna profiles.alias en 0001_core.sql.
const ALIAS_CHECK = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$/

// ── Listas ──────────────────────────────────────────────────────────────────

test('las palabras caben en el CHECK de la columna y en 24 caracteres', () => {
  for (const w of [...ALIAS_NOUNS, ...ALIAS_ADJECTIVES]) {
    assert.match(w, ALIAS_CHECK, `"${w}" usa caracteres que el CHECK rechaza`)
    assert.ok(w.length <= 9, `"${w}" tiene ${w.length} caracteres (máx. 9)`)
  }
})

test('no hay palabras repetidas dentro de una misma lista', () => {
  assert.equal(new Set(ALIAS_NOUNS).size, ALIAS_NOUNS.length)
  assert.equal(new Set(ALIAS_ADJECTIVES).size, ALIAS_ADJECTIVES.length)
})

test('el espacio de alias es lo bastante grande para cientos de miles de cuentas', () => {
  assert.ok(ALIAS_SPACE > 10_000_000, `espacio insuficiente: ${ALIAS_SPACE}`)
})

// ── Alias ───────────────────────────────────────────────────────────────────

test('deriveAlias: determinista para la misma semilla', () => {
  const seed = 'a'.repeat(32)
  assert.equal(deriveAlias(seed), deriveAlias(seed))
})

test('deriveAlias: cumple el CHECK y el rango de longitud de la columna', () => {
  for (let i = 0; i < 2000; i++) {
    const alias = deriveAlias(`semilla-${i}`)
    assert.match(alias, ALIAS_CHECK, `alias inválido: "${alias}"`)
    assert.ok(alias.length >= 3 && alias.length <= 24, `longitud ${alias.length}: "${alias}"`)
  }
})

test('deriveAlias: cambiar de attempt da otro alias (reintento ante colisión)', () => {
  const seed = createIdentitySeed()
  const a0 = deriveAlias(seed, 0)
  const a1 = deriveAlias(seed, 1)
  assert.notEqual(a0, a1)
  // Y sigue siendo determinista por attempt.
  assert.equal(a1, deriveAlias(seed, 1))
})

test('deriveAlias: reparte razonablemente (sin colapsar en pocas combinaciones)', () => {
  const alias = new Set<string>()
  for (let i = 0; i < 5000; i++) alias.add(deriveAlias(`s${i}`))
  // Con 5000 semillas y ~20M de espacio, casi todas deben ser distintas.
  assert.ok(alias.size > 4950, `demasiadas colisiones: ${alias.size}/5000`)
})

// ── No derivabilidad (el requisito de anonimato) ────────────────────────────

test('ANONIMATO: la semilla es aleatoria, no derivada del usuario', () => {
  // Dos altas distintas nunca producen la misma semilla: si la semilla se
  // derivara del email o del user id, esto sería reproducible.
  const semillas = new Set<string>()
  for (let i = 0; i < 200; i++) semillas.add(createIdentitySeed())
  assert.equal(semillas.size, 200)
})

test('ANONIMATO: el alias no contiene ni el user id ni el email', () => {
  const userId = 'd3f1b2a4-1111-4222-8333-444455556666'
  const email = 'maria.lopez@gmail.com'
  for (let i = 0; i < 500; i++) {
    const { alias, avatarSeed } = createAnonymousIdentity()
    for (const fragmento of [userId, email, 'maria', 'lopez', 'gmail', 'd3f1b2a4']) {
      assert.ok(!alias.toLowerCase().includes(fragmento.toLowerCase()))
      assert.ok(!avatarSeed.toLowerCase().includes(fragmento.toLowerCase()))
    }
  }
})

test('ANONIMATO: el alias es sustantivo + adjetivo + número, nada más', () => {
  const { alias } = createAnonymousIdentity()
  const [noun, adj, num, ...resto] = alias.split(' ')
  assert.equal(resto.length, 0, `el alias tiene partes de más: "${alias}"`)
  assert.ok(ALIAS_NOUNS.includes(noun!))
  assert.ok(ALIAS_ADJECTIVES.includes(adj!))
  assert.match(num!, /^\d{4}$/)
})

test('avatarSeed: 16 hex, mismo formato que el default de la columna', () => {
  for (let i = 0; i < 100; i++) {
    const seed = deriveAvatarSeed(`s${i}`)
    assert.match(seed, /^[0-9a-f]{16}$/)
  }
})

test('avatarSeed: determinista y ligado a la semilla', () => {
  assert.equal(deriveAvatarSeed('x'), deriveAvatarSeed('x'))
  assert.notEqual(deriveAvatarSeed('x'), deriveAvatarSeed('y'))
})

// ── PII (reexportada desde lib/pii.ts) ──────────────────────────────────────
// Los tests de detección viven en lib/pii.test.ts, junto al código. Aquí solo
// se comprueba la capa de compatibilidad: que los llamantes históricos de
// lib/anonymity.ts reciben LAS MISMAS funciones, no copias que puedan divergir.

test('COMPATIBILIDAD: la API de PII reexportada es idéntica a la de lib/pii.ts', () => {
  assert.equal(detectPii, pii.detectPii)
  assert.equal(assertNoPii, pii.assertNoPii)
  assert.equal(redactPii, pii.redactPii)
  assert.equal(PiiDetectedError, pii.PiiDetectedError)
})
