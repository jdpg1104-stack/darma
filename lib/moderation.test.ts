import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
  validateComment,
  normalize,
  tokenize,
  lexicalDiversity,
  fillerRatio,
  bigramSimilarity,
  moderationMessage,
} from './moderation.ts'

const BUENO =
  'Yo pasé por algo muy parecido el año pasado. Lo que de verdad me sirvió fue ' +
  'contárselo a alguien de mi familia, aunque tardé meses en atreverme. Si quieres ' +
  'te cuento cómo empecé esa conversación.'

test('normalize: quita tildes, mayúsculas, puntuación y emojis', () => {
  assert.equal(normalize('¡ÁNIMO!! 😔😔'), 'animo')
  assert.equal(normalize('  Hola,   qué   tal  '), 'hola que tal')
})

test('tokenize: un texto vacío no produce tokens fantasma', () => {
  assert.deepEqual(tokenize('   '), [])
  assert.deepEqual(tokenize('😔😔😔'), [])
})

test('un comentario sincero y concreto se valida', () => {
  const r = validateComment({ body: BUENO })
  assert.equal(r.valid, true)
  assert.equal(r.reason, 'ok')
  assert.deepEqual(r.signals, [])
  assert.ok(r.score >= 0.9)
})

// ── Longitud ────────────────────────────────────────────────────────────────

test('demasiado corto: rechazo duro, igual que el CHECK de la columna', () => {
  const r = validateComment({ body: 'ánimo, un abrazo' })
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'too_short')
  assert.equal(r.score, 0)
})

test('el mínimo es inclusivo en 40 caracteres', () => {
  const justo = 'a'.repeat(MIN_COMMENT_LENGTH)
  assert.notEqual(validateComment({ body: justo }).reason, 'too_short')
  assert.equal(validateComment({ body: 'a'.repeat(MIN_COMMENT_LENGTH - 1) }).reason, 'too_short')
})

test('demasiado largo: se rechaza antes de que lo rechace Postgres', () => {
  const r = validateComment({ body: 'palabra '.repeat(MAX_COMMENT_LENGTH) })
  assert.equal(r.reason, 'too_long')
  assert.equal(r.valid, false)
})

// ── Repetición ──────────────────────────────────────────────────────────────

test('lexicalDiversity: detecta el texto inflado por repetición', () => {
  assert.equal(lexicalDiversity('fuerza fuerza fuerza fuerza'), 0.25)
  assert.equal(lexicalDiversity('hoy ha sido un dia raro'), 1)
})

test('repetir la misma palabra para llegar al mínimo no cuela', () => {
  const r = validateComment({ body: 'fuerza fuerza fuerza fuerza fuerza fuerza fuerza fuerza' })
  assert.equal(r.valid, false)
  assert.ok(r.signals.includes('low_diversity'))
})

// ── Relleno ─────────────────────────────────────────────────────────────────

test('fillerRatio: mide proporción, no presencia', () => {
  assert.ok(fillerRatio('mucho animo fuerza') > 0.9)
  assert.ok(fillerRatio(BUENO) < 0.1)
})

test('el relleno puro se rechaza aunque supere la longitud mínima', () => {
  const r = validateComment({ body: 'Mucho ánimo, fuerza, un abrazo, todo pasa, ya verás, suerte' })
  assert.equal(r.valid, false)
  assert.ok(r.signals.includes('filler_only'))
})

test('empezar con una frase hecha NO invalida un comentario con contenido', () => {
  const r = validateComment({ body: `Mucho ánimo. ${BUENO}` })
  assert.equal(r.valid, true, 'penalizar la presencia de "ánimo" castigaría a gente que escribe bien')
})

// ── Eco del post ────────────────────────────────────────────────────────────

test('bigramSimilarity: textos sin bigramas comunes dan 0', () => {
  assert.equal(bigramSimilarity('hola que tal', 'el perro corre rapido'), 0)
})

test('bigramSimilarity: un texto consigo mismo da 1', () => {
  assert.equal(bigramSimilarity(BUENO, BUENO), 1)
})

test('bigramSimilarity: un texto de una palabra no puede parecerse a nada', () => {
  assert.equal(bigramSimilarity('hola', 'hola'), 0)
})

test('copiar el post y devolverlo no cuenta como escucha', () => {
  const post =
    'Llevo tres semanas sin poder dormir y creo que es por el trabajo. ' +
    'Cada noche me quedo mirando el techo dándole vueltas a lo mismo.'
  const r = validateComment({ body: post, postBody: post })
  assert.equal(r.valid, false)
  assert.ok(r.signals.includes('echoes_post'))
})

test('compartir el TEMA del post no penaliza (por eso bigramas y no palabras)', () => {
  const post = 'Llevo tres semanas sin dormir por culpa del trabajo y de la ansiedad.'
  const respuesta =
    'La ansiedad me quitó el sueño durante meses y lo único que funcionó en mi caso ' +
    'fue dejar el móvil fuera de la habitación. Igual a ti también te sirve probarlo.'
  const r = validateComment({ body: respuesta, postBody: post })
  assert.equal(r.valid, true)
  assert.ok(!r.signals.includes('echoes_post'))
})

// ── Plantilla del propio autor ──────────────────────────────────────────────

test('pegar la misma plantilla en varios posts se detecta', () => {
  const r = validateComment({ body: BUENO, previousByAuthor: [BUENO, 'otro texto cualquiera'] })
  assert.equal(r.valid, false)
  assert.ok(r.signals.includes('self_repetition'))
})

test('comentarios distintos del mismo autor no se penalizan', () => {
  const otro =
    'A mí me pasó algo distinto: lo que me descolocó fue volver a la ciudad después ' +
    'del verano y no reconocer a nadie de los que estaban antes.'
  const r = validateComment({ body: BUENO, previousByAuthor: [otro] })
  assert.equal(r.valid, true)
})

// ── Contrato ────────────────────────────────────────────────────────────────

test('es determinista: la misma entrada da exactamente el mismo resultado', () => {
  const input = { body: BUENO, postBody: 'algo', previousByAuthor: ['otra cosa'] }
  assert.deepEqual(validateComment(input), validateComment(input))
})

test('score siempre en [0, 1] y con 3 decimales (numeric(4,3))', () => {
  const casos = [
    BUENO,
    'fuerza fuerza fuerza fuerza fuerza fuerza fuerza fuerza',
    'Mucho ánimo, fuerza, un abrazo, todo pasa, ya verás, suerte',
    `Mucho ánimo. ${BUENO}`,
  ]
  for (const body of casos) {
    const { score } = validateComment({ body })
    assert.ok(score >= 0 && score <= 1, `score fuera de rango: ${score}`)
    assert.equal(Math.round(score * 1000), score * 1000)
  }
})

test('cada motivo tiene un mensaje que propone cómo mejorar', () => {
  for (const reason of ['too_short', 'too_long', 'low_diversity', 'filler_only', 'echoes_post', 'self_repetition', 'ok'] as const) {
    assert.ok(moderationMessage(reason).length > 10)
  }
})
