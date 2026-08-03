import test from 'node:test'
import assert from 'node:assert/strict'

import { TAXONOMIA, clasificar, detectarTema, normalizarTags, recortarIdioma } from './clasificar.ts'
import type { CandidatoContenido } from './tipos.ts'

function candidato(parcial: Partial<CandidatoContenido> = {}): CandidatoContenido {
  return {
    source: 'rss:who_es',
    platform: 'article',
    externalId: 'x1',
    title: 'Título',
    summary: null,
    url: 'https://example.org/a',
    thumbnailUrl: null,
    language: 'es',
    durationSeconds: null,
    topic: null,
    tags: [],
    publishedAt: null,
    ...parcial,
  }
}

// ── Prueba exigida nº 7 ─────────────────────────────────────────────────────

test('recorta «es-419» a «es»', () => {
  assert.equal(recortarIdioma('es-419'), 'es')
  assert.equal(recortarIdioma('EN_US'), 'en')
  assert.equal(recortarIdioma('pt-BR'), 'pt')
  assert.equal(recortarIdioma('  fr  '), 'fr')

  const c = clasificar(candidato({ language: 'es-419' }), 'en')
  assert.equal(c.language, 'es')
})

test('un idioma irreconocible HEREDA el de la fuente', () => {
  assert.equal(clasificar(candidato({ language: 'zzzz-nope' }), 'en').language, 'en')
  assert.equal(clasificar(candidato({ language: '' }), 'es').language, 'es')
  // @ts-expect-error — el feed puede devolver cualquier cosa; el tipo lo prohíbe,
  // la realidad no. El clasificador tiene que sobrevivirlo igual.
  assert.equal(clasificar(candidato({ language: null }), 'en').language, 'en')
})

test('el idioma NUNCA rompe el CHECK ^[a-z]{2}$', () => {
  const basuras = ['', '1', 'x', 'español', 'ES-es-ES', '  ', '--', '中文', 'e5']
  for (const basura of basuras) {
    const c = clasificar(candidato({ language: basura }), 'es')
    assert.match(c.language, /^[a-z]{2}$/, `«${basura}» produjo «${c.language}»`)
  }
  // Incluso si la propia fuente trajera un idioma inválido (hoy el CHECK de
  // ingest_sources lo impide, mañana quién sabe), el respaldo final es 'es'.
  assert.match(clasificar(candidato({ language: 'nope' }), 'invalido').language, /^[a-z]{2}$/)
})

test('un tema fuera de la taxonomía queda en null: NO se inventa', () => {
  // Los chips del feed de B07 filtran por la lista cerrada; un tema libre no
  // casaría con ninguno y el contenido quedaría invisible sin que nadie sepa por qué.
  const c = clasificar(candidato({ topic: 'gestión emocional del estrés laboral moderno' }), 'es')
  assert.equal(c.topic, null)

  const sinSenales = clasificar(candidato({ title: 'Episodio 12', topic: null }), 'es')
  assert.equal(sinSenales.topic, null)
})

// ── Detección de tema ───────────────────────────────────────────────────────

test('detecta los temas de la taxonomía por término', () => {
  assert.equal(detectarTema('Ejercicios para la ansiedad'), 'ansiedad')
  assert.equal(detectarTema('Cómo acompañar un duelo'), 'duelo')
  assert.equal(detectarTema('Higiene del sueño: dormir mejor'), 'sueño')
  assert.equal(detectarTema('Sentirse en soledad en una ciudad grande'), 'soledad')
  assert.equal(detectarTema('Trabajar la autoestima'), 'autoestima')
  assert.equal(detectarTema('Respiración diafragmática guiada'), 'respiración')
  assert.equal(detectarTema('Poner límites en las relaciones'), 'relaciones')
  assert.equal(detectarTema('Burnout: cuando el trabajo te vacía'), 'trabajo')
})

test('el tema detectado SIEMPRE pertenece a la taxonomía', () => {
  const tema = detectarTema('respirar hondo antes de dormir')
  assert.ok(tema === null || (TAXONOMIA as readonly string[]).includes(tema))
})

test('la coincidencia es por palabra, no por subcadena', () => {
  // «solo» dentro de «consolo» no debe mandar medio catálogo a 'soledad'.
  assert.notEqual(detectarTema('Me consolo con la música'), 'soledad')
})

test('un tema válido que ya trae el candidato se respeta', () => {
  const c = clasificar(candidato({ topic: 'duelo', title: 'Ejercicio de respiración' }), 'es')
  assert.equal(c.topic, 'duelo')
})

// ── Etiquetas ───────────────────────────────────────────────────────────────

test('las etiquetas se normalizan, se deduplican y se acotan', () => {
  assert.deepEqual(normalizarTags(['  Salud ', 'salud', 'MENTAL']), ['salud', 'mental'])
  assert.deepEqual(normalizarTags(['', '   ']), [])
  assert.deepEqual(normalizarTags(undefined), [])
  // @ts-expect-error — un feed puede meter números en <category>.
  assert.deepEqual(normalizarTags([1, 'ok']), ['ok'])
  assert.ok(normalizarTags(Array.from({ length: 50 }, (_, i) => `t${i}`)).length <= 10)
})
