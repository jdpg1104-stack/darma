import test from 'node:test'
import assert from 'node:assert/strict'

import { FUENTES_SEMILLA, TIPOS_POR_CRON, urlDeFuente, validarSemilla } from './fuentes.ts'

test('la semilla es válida: claves únicas, idiomas legales y feeds https', () => {
  assert.deepEqual(validarSemilla(), [])
})

test('NINGUNA fuente sin justificación escrita', () => {
  // Es la regla del catálogo: hay que poder explicar por qué apareció un
  // contenido concreto en el feed de alguien, y la respuesta se escribe ANTES.
  for (const f of FUENTES_SEMILLA) {
    assert.ok(f.porQue.trim().length >= 40, `${f.key} no explica por qué está`)
  }
})

test('el catálogo cubre es y en', () => {
  const idiomas = new Set(FUENTES_SEMILLA.map((f) => f.language))
  assert.ok(idiomas.has('es'), 'Darma nace en español: el catálogo no puede depender del inglés')
  assert.ok(idiomas.has('en'))
})

test('cada cron trabaja solo sus tipos de fuente', () => {
  assert.deepEqual([...TIPOS_POR_CRON.videos], ['youtube_playlist', 'youtube_channel'])
  assert.deepEqual([...TIPOS_POR_CRON.articulos], ['rss'])
})

test('la URL de descarga nunca lleva secretos', () => {
  for (const f of FUENTES_SEMILLA) {
    const url = urlDeFuente(f)
    assert.match(url, /^https:\/\//)
    assert.ok(!/key=|token=|secret=/i.test(url), `${f.key} construye una URL con algo que parece una clave`)
  }
})

test('validarSemilla detecta los errores que reventarían el insert', () => {
  const problemas = validarSemilla([
    { key: 'a', kind: 'rss', handle: 'http://inseguro.example', language: 'es-419', topic: null, porQue: 'corto' },
    { key: 'a', kind: 'rss', handle: '', language: 'es', topic: null, porQue: 'x'.repeat(50) },
  ])
  assert.ok(problemas.some((p) => p.includes('duplicada')))
  assert.ok(problemas.some((p) => p.includes('idioma inválido')))
  assert.ok(problemas.some((p) => p.includes('no es https')))
  assert.ok(problemas.some((p) => p.includes('handle vacío')))
  assert.ok(problemas.some((p) => p.includes('justificación')))
})
