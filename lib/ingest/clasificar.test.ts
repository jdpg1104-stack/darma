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

// ── La puerta de relevancia ─────────────────────────────────────────────────
//
// Los cuatro títulos de abajo NO son inventados: son los que salieron de la
// primera ingesta real contra las fuentes semilla (OMS, CDC, OPS) y los que se
// guardaron con tema en `content_items`. Si esta sección se pone en verde con
// la puerta quitada, es que la puerta no hace nada.

test('🔴 la prosa institucional ya NO se lleva un tema por una palabra suelta', () => {
  const reales = [
    'Road safety is everyone’s job',
    "Governments agree to continue their steady progress on proposed pandemic agreement",
    'Ireland and WHO work together to improve access to assistive technology globally',
    'India commits US$ 85 million to WHO Global Traditional Medicine Centre',
    'Seven strategies to prevent drowning - technical package for policy-makers',
    'Making waters safer in Ghana',
  ]
  for (const titulo of reales) {
    assert.equal(detectarTema(titulo), null, `«${titulo}» no debería llevar tema`)
  }
})

test('🔴 el peor caso real: proyecciones de cáncer NO son «duelo»', () => {
  // El que más daño haría: fue el único etiquetado como duelo, o sea el único
  // que aparecería ante alguien que acaba de perder a una persona.
  const titulo =
    'Llamado urgente a la acción de la OMS ante la previsión de que el número de ' +
    'nuevos casos de cáncer prácticamente se duplicará de aquí a 2050'
  assert.equal(detectarTema(titulo), null)

  // Y con su resumen REAL, que es como se clasifica de verdad. Sobrevivió a la
  // primera versión de la puerta por una sola palabra: «impacto físico,
  // EMOCIONAL y económico». Por eso 'emocional' a secas no es una señal.
  const resumen =
    'Millones de personas se enfrentan al impacto físico, emocional y económico del ' +
    'cáncer, una enfermedad que se cobra más de 26 000 vidas cada día, según un informe ' +
    'publicado hoy por la Organización Mundial de la Salud (OMS). Con unas cifras ' +
    'anuales estimadas de 20,6 millones de nuevos casos y cerca de 10 millones de defunciones'
  assert.equal(detectarTema(`${titulo} ${resumen}`), null)
})

test('el contenido que SÍ es de salud mental conserva su tema', () => {
  // La puerta es permisiva a propósito: basta una señal. Si esto se rompiera,
  // habríamos cambiado un catálogo con ruido por un catálogo vacío.
  assert.equal(detectarTema('Cómo manejar la ansiedad en el trabajo'), 'ansiedad')
  assert.equal(detectarTema('Burnout: cuando el desgaste laboral te supera'), 'trabajo')
  assert.equal(detectarTema('Coping with grief after the loss of a parent'), 'duelo')
  assert.equal(detectarTema('Mental health and loneliness in older adults'), 'soledad')
  // Sin «sleep»: 'sueño' va antes que 'respiración' en la taxonomía y ganaría.
  assert.equal(detectarTema('Guided breathing for relaxation'), 'respiración')
})

test('«solo» como «únicamente» no convierte un texto español en soledad', () => {
  // 'solo' está en TERMINOS de soledad y en español es la palabra para
  // «únicamente». Sin la puerta, media web en español entra como soledad.
  assert.equal(detectarTema('Solo se puede acceder con cita previa'), null)
  // Pero con contexto de salud mental sí, que es lo que se quiere.
  assert.equal(detectarTema('Me siento solo: la soledad y la salud mental'), 'soledad')
})
