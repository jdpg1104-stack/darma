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

// ============================================================================
// El FRAGMENTO curado (0224_1_b07_clips)
//
// La entrevista de 87 minutos que hay hoy en el catálogo no se puede enseñar
// entera en un feed de deslizar. Lo que se enseña es un trozo, y el trozo lo
// pone el reproductor con `start`/`end` — sin resubir nada, que es lo que la
// regla 2 de `lib/ingest/fuentes.ts` prohíbe.
// ============================================================================

test('con fragmento, la URL lleva start y end', () => {
  const url = urlEmbed({ ...VALIDO, clip_start_seconds: 3120, clip_end_seconds: 3160 }, { origen: ORIGEN })

  assert.ok(url)
  const params = new URL(url).searchParams
  assert.equal(params.get('start'), '3120')
  assert.equal(params.get('end'), '3160')
})

test('sin fragmento, la URL no lleva start ni end', () => {
  const url = urlEmbed(VALIDO, { origen: ORIGEN })

  assert.ok(url)
  const params = new URL(url).searchParams
  assert.equal(params.get('start'), null)
  assert.equal(params.get('end'), null)
})

// ── FALLO: media pareja ─────────────────────────────────────────────────────
// Un `start` suelto NO es medio fragmento: es la entrevista entera empezando
// tarde, que suena hasta el final. Es peor que no recortar, porque parece que
// se recortó.
test('media pareja no recorta nada: ni start solo ni end solo', () => {
  for (const mitad of [
    { clip_start_seconds: 3120, clip_end_seconds: null },
    { clip_start_seconds: null, clip_end_seconds: 3160 },
  ]) {
    const url = urlEmbed({ ...VALIDO, ...mitad }, { origen: ORIGEN })
    assert.ok(url)
    const params = new URL(url).searchParams
    assert.equal(params.get('start'), null, JSON.stringify(mitad))
    assert.equal(params.get('end'), null, JSON.stringify(mitad))
  }
})

// ── FALLO: marcas que producirían un embed mudo ────────────────────────────
test('un fragmento incoherente no llega a la URL', () => {
  const casos = [
    { clip_start_seconds: 3160, clip_end_seconds: 3120 }, // fin antes que inicio
    { clip_start_seconds: 100, clip_end_seconds: 100 }, // longitud cero
    { clip_start_seconds: -10, clip_end_seconds: 40 }, // inicio negativo
    { clip_start_seconds: 12.5, clip_end_seconds: 52.5 }, // el reproductor ignora decimales
  ]

  for (const caso of casos) {
    const url = urlEmbed({ ...VALIDO, ...caso }, { origen: ORIGEN })
    assert.ok(url)
    const params = new URL(url).searchParams
    assert.equal(params.get('start'), null, JSON.stringify(caso))
    assert.equal(params.get('end'), null, JSON.stringify(caso))
  }
})

test('itemVideoDesde resuelve la duración útil del fragmento, no la del vídeo', () => {
  const item = itemVideoDesde({
    id: '33333333-3333-4333-8333-333333333333',
    platform: 'youtube',
    external_id: 'dQw4w9WgXcQ',
    title: 'Cómo convertir tus heridas en propósito',
    source: 'yt:aj_historias_que_inspiran',
    language: 'es',
    duration_seconds: 5236, // 87 minutos, la pieza más larga del catálogo real
    thumbnail_url: null,
    topic: null,
    clip_start_seconds: 3120,
    clip_end_seconds: 3160,
  })

  assert.ok(item)
  assert.equal(item.duracionSegundos, 5236, 'la duración del vídeo no se pierde')
  assert.equal(item.duracionUtilSegundos, 40, 'lo que hay que ver son 40 s, no 87 minutos')
  assert.equal(item.clipInicioSegundos, 3120)
  assert.equal(item.clipFinSegundos, 3160)
})

test('itemVideoDesde trata media pareja como «sin fragmento»', () => {
  const item = itemVideoDesde({
    id: '44444444-4444-4444-8444-444444444444',
    platform: 'youtube',
    external_id: 'dQw4w9WgXcQ',
    title: 'a medias',
    source: 'oms',
    language: 'es',
    duration_seconds: 600,
    thumbnail_url: null,
    topic: null,
    clip_start_seconds: 120,
    clip_end_seconds: null,
  })

  assert.ok(item)
  assert.equal(item.clipInicioSegundos, null)
  assert.equal(item.clipFinSegundos, null)
  assert.equal(item.duracionUtilSegundos, 600)
})

test('sin columnas de fragmento (una fila vieja) el ítem sigue naciendo entero', () => {
  const item = itemVideoDesde({
    id: '55555555-5555-4555-8555-555555555555',
    platform: 'youtube',
    external_id: 'dQw4w9WgXcQ',
    title: 'fila anterior a 0224',
    source: 'oms',
    language: 'es',
    duration_seconds: null,
    thumbnail_url: null,
    topic: null,
  })

  assert.ok(item)
  assert.equal(item.clipInicioSegundos, null)
  assert.equal(item.duracionUtilSegundos, 60, 'el respaldo de 0107_1 sigue en pie')
})
