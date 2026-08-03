import test from 'node:test'
import assert from 'node:assert/strict'

import { obtenerTraductor } from '../i18n/traductor.ts'
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

// Que el copy no diga «crédito» se vigila donde ahora vive el copy: sobre el
// catálogo y en los dos idiomas, en `i18n/deteccion.test.ts`. Aquí se comprueba
// lo que decide este módulo, que es QUÉ clave le toca a cada estado.

test('cada estado elige su clave, y con los params que su ICU necesita', () => {
  assert.deepEqual(reciprocityMessage(state({ bannedUntil: '2026-07-01T00:00:00.000Z' }), now), {
    clave: 'publicar.enPausa',
  })
  assert.deepEqual(reciprocityMessage(state({ postsPublished: 0 }), now), {
    clave: 'publicar.primeraVez',
  })
  assert.deepEqual(reciprocityMessage(state({ listenCredits: 3 }), now), {
    clave: 'publicar.listo',
  })
  assert.deepEqual(reciprocityMessage(state({ listenCredits: 1 }), now), {
    clave: 'publicar.faltan',
    params: { n: 2 },
  })
})

test('la pausa manda sobre el saldo y sobre el primer post', () => {
  // Decirle «te faltan 3 escuchas» a quien está en pausa es mentira, y además
  // le hace perder el tiempo escuchando para nada.
  const s = state({ listenCredits: 99, postsPublished: 0, bannedUntil: '2026-07-01T00:00:00.000Z' })
  assert.equal(reciprocityMessage(s, now).clave, 'publicar.enPausa')
})

test('el copy resultante concuerda en singular y en plural, en los dos idiomas', () => {
  for (const idioma of ['es', 'en'] as const) {
    const t = obtenerTraductor(idioma)
    const una = reciprocityMessage(state({ listenCredits: 2 }), now)
    const dos = reciprocityMessage(state({ listenCredits: 1 }), now)
    const textoUna = t(una.clave, una.params)
    const textoDos = t(dos.clave, dos.params)

    // `obtenerTraductor` devuelve la clave tal cual si no existe la traducción:
    // sin esto, las dos aserciones de abajo pasarían con el catálogo vacío.
    assert.notEqual(textoUna, una.clave, `falta ${una.clave} en ${idioma}.json`)

    assert.doesNotMatch(textoUna, /\d/, `el singular no debe llevar número (${idioma}): «${textoUna}»`)
    assert.match(textoDos, /\b2\b/, `el plural debe decir cuántas faltan (${idioma}): «${textoDos}»`)
  }
})
