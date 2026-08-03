// ============================================================================
// B07 · Pruebas de la construcción del embed.
//
// Las dos primeras son CAMINOS DE FALLO y son las que de verdad importan: un
// ítem que no sea de YouTube o un `external_id` manipulado no pueden llegar a
// un atributo `src`.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORIGEN_EMBED,
  esIdYoutubeValido,
  esReproducible,
  itemVideoDesde,
  urlEmbed,
  urlMiniatura,
} from './embed.ts'

const ORIGEN = 'https://darma.app'
const VALIDO = { platform: 'youtube', external_id: 'dQw4w9WgXcQ' }

// ── 1 · FALLO: plataforma que no es YouTube ─────────────────────────────────
test('urlEmbed descarta cualquier plataforma que no sea youtube', () => {
  for (const plataforma of ['vimeo', 'tiktok', 'instagram', 'article', 'internal', '']) {
    assert.equal(
      urlEmbed({ platform: plataforma, external_id: 'dQw4w9WgXcQ' }, { origen: ORIGEN }),
      null,
      `${plataforma} no puede producir una URL de embed`,
    )
  }
})

test('un item de vimeo no se convierte en ItemVideo: se descarta antes', () => {
  const descartado = itemVideoDesde({
    id: '11111111-1111-4111-8111-111111111111',
    platform: 'vimeo',
    external_id: '123456789',
    title: 'Meditación',
    source: 'oms',
    language: 'es',
    duration_seconds: 90,
    thumbnail_url: null,
    topic: null,
  })

  assert.equal(descartado, null)
})

// ── 1b · FALLO: external_id manipulado ──────────────────────────────────────
test('urlEmbed rechaza un external_id que no tenga la forma de un id de YouTube', () => {
  const peligrosos = [
    'abc"onload=',                 // cierra el atributo src
    'abc" onload="alert(1)',
    '../../etc/passwd',
    'dQw4w9WgXcQ&autoplay=1',      // inyecta un parámetro
    'dQw4w9WgXc',                  // 10 caracteres
    'dQw4w9WgXcQQ',                // 12 caracteres
    'dQw4 w9WgXc',                 // espacio
    '',
  ]

  for (const id of peligrosos) {
    assert.equal(esIdYoutubeValido(id), false, `${id} no es un id válido`)
    assert.equal(urlEmbed({ platform: 'youtube', external_id: id }, { origen: ORIGEN }), null)
  }
})

test('esReproducible exige las dos condiciones a la vez', () => {
  assert.equal(esReproducible(VALIDO), true)
  assert.equal(esReproducible({ platform: 'youtube', external_id: 'mal' }), false)
  assert.equal(esReproducible({ platform: 'vimeo', external_id: 'dQw4w9WgXcQ' }), false)
})

// ── 2 · La URL generada ─────────────────────────────────────────────────────
test('la URL sale de youtube-nocookie y lleva los parámetros que la API exige', () => {
  const url = urlEmbed(VALIDO, { origen: ORIGEN })
  assert.ok(url, 'debería producir URL')

  assert.ok(
    url.startsWith(`${ORIGEN_EMBED}/embed/dQw4w9WgXcQ?`),
    'el origen del iframe es el único que permite la CSP',
  )
  assert.equal(ORIGEN_EMBED, 'https://www.youtube-nocookie.com')

  const parametros = new URL(url).searchParams
  assert.equal(parametros.get('enablejsapi'), '1')
  assert.equal(parametros.get('playsinline'), '1')
  assert.equal(parametros.get('mute'), '1')
  assert.equal(parametros.get('autoplay'), '0')
  assert.equal(parametros.get('controls'), '0')
  assert.equal(parametros.get('rel'), '0')
  assert.equal(parametros.get('origin'), ORIGEN)
})

test('la URL no contiene la url cruda del content_item', () => {
  const url = urlEmbed(VALIDO, { origen: ORIGEN })
  assert.ok(url && !url.includes('youtube.com/watch'))
})

// ── Miniaturas: solo hosts que la CSP permite ──────────────────────────────
test('urlMiniatura descarta un host que la CSP no permite y cae a la canónica', () => {
  assert.equal(
    urlMiniatura(VALIDO, 'https://evil.example/x.jpg'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  )
  assert.equal(
    urlMiniatura(VALIDO, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  )
  assert.equal(
    urlMiniatura(VALIDO, 'no-es-una-url'),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  )
})

test('itemVideoDesde no filtra la url cruda y fija la plataforma', () => {
  const item = itemVideoDesde({
    id: '22222222-2222-4222-8222-222222222222',
    platform: 'youtube',
    external_id: 'dQw4w9WgXcQ',
    title: 'Respiración 4-7-8',
    source: 'oms',
    language: 'es',
    duration_seconds: 60,
    thumbnail_url: null,
    topic: 'respiración',
  })

  assert.ok(item)
  assert.equal(item.plataforma, 'youtube')
  assert.equal(item.completado, false)
  assert.ok(!Object.prototype.hasOwnProperty.call(item, 'url'))
})
