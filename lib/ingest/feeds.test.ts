import test from 'node:test'
import assert from 'node:assert/strict'

import { decodificarEntidades, fechaIso, limpiarTexto, parsearFeedRss, parsearFeedYoutube, urlFeedCanal, urlFeedPlaylist } from './feeds.ts'
import { normalizar, thumbnailPermitida, TITULO_MAX } from './normalizar.ts'
import type { FuenteIngesta } from './tipos.ts'

const ATOM_YT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Canal</title>
 <entry>
  <id>yt:video:AbC123xyz</id>
  <yt:videoId>AbC123xyz</yt:videoId>
  <title>Respiración &amp; calma</title>
  <published>2026-01-15T10:00:00+00:00</published>
  <media:group>
   <media:description>Un ejercicio de tres minutos.</media:description>
   <media:thumbnail url="https://i.ytimg.com/vi/AbC123xyz/hqdefault.jpg" width="480"/>
  </media:group>
 </entry>
</feed>`

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
 <title>Boletín</title>
 <item>
  <title><![CDATA[Dormir mejor]]></title>
  <link>https://example.org/dormir</link>
  <guid isPermaLink="false">art-001</guid>
  <description>&lt;p&gt;Consejos de higiene del sueño.&lt;/p&gt;</description>
  <pubDate>Tue, 20 Jan 2026 08:00:00 GMT</pubDate>
  <category>salud</category>
  <category>sueño</category>
 </item>
</channel></rss>`

test('las URLs de feed de YouTube no llevan clave de API', () => {
  assert.equal(urlFeedCanal('UC0'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UC0')
  assert.equal(urlFeedPlaylist('PL1'), 'https://www.youtube.com/feeds/videos.xml?playlist_id=PL1')
  assert.ok(!urlFeedCanal('UC0').includes('key='))
})

test('parsea un feed Atom de YouTube', () => {
  const [e] = parsearFeedYoutube(ATOM_YT)
  assert.equal(e.externalId, 'AbC123xyz')
  assert.equal(e.title, 'Respiración & calma')
  assert.equal(e.summary, 'Un ejercicio de tres minutos.')
  assert.equal(e.url, 'https://www.youtube.com/watch?v=AbC123xyz')
  assert.equal(e.thumbnailUrl, 'https://i.ytimg.com/vi/AbC123xyz/hqdefault.jpg')
  assert.equal(e.publishedAt, '2026-01-15T10:00:00.000Z')
})

test('parsea un item de RSS 2.0 con CDATA y entidades', () => {
  const [e] = parsearFeedRss(RSS)
  assert.equal(e.externalId, 'art-001')
  assert.equal(e.title, 'Dormir mejor')
  assert.equal(e.summary, 'Consejos de higiene del sueño.')
  assert.equal(e.url, 'https://example.org/dormir')
  assert.equal(e.publishedAt, '2026-01-20T08:00:00.000Z')
  assert.deepEqual(e.tags, ['salud', 'sueño'])
  // Sin miniatura a propósito: la CSP no pintaría la imagen de un medio cualquiera.
  assert.equal(e.thumbnailUrl, null)
})

test('un XML corrupto NO lanza: devuelve lista vacía', () => {
  assert.deepEqual(parsearFeedYoutube('<feed><entry>rota'), [])
  assert.deepEqual(parsearFeedRss('no soy xml'), [])
  assert.deepEqual(parsearFeedRss(''), [])
})

test('una entrada sin id o sin título se descarta en vez de inventarse', () => {
  assert.deepEqual(parsearFeedYoutube('<feed><entry><title>Sin id</title></entry></feed>'), [])
  assert.deepEqual(parsearFeedRss('<rss><item><link>https://a.b</link></item></rss>'), [])
})

test('una fecha muy futura se ignora en vez de encabezar «Novedades» para siempre', () => {
  assert.equal(fechaIso('2999-01-01T00:00:00Z'), null)
  assert.equal(fechaIso('no es una fecha'), null)
  assert.equal(fechaIso(null), null)
})

test('las entidades anidadas se decodifican', () => {
  assert.equal(decodificarEntidades('a &amp;quot;b&amp;quot; c'), 'a "b" c')
  assert.equal(limpiarTexto('<p>Hola  <b>mundo</b></p>'), 'Hola mundo')
  assert.equal(limpiarTexto('   '), null)
})

// ── Normalización a candidato ───────────────────────────────────────────────

const FUENTE_YT: FuenteIngesta = {
  key: 'yt:test',
  kind: 'youtube_channel',
  handle: 'UC0',
  language: 'es',
  topic: null,
  cursor: null,
  fallosConsecutivos: 0,
}

test('normalizar produce un candidato de plataforma cerrada', () => {
  const [cruda] = parsearFeedYoutube(ATOM_YT)
  const c = normalizar(cruda, FUENTE_YT)
  assert.ok(c)
  assert.equal(c.platform, 'youtube')
  assert.equal(c.source, 'yt:test')
})

test('normalizar descarta lo que no cumpliría los CHECK de la tabla', () => {
  assert.equal(normalizar(null, FUENTE_YT), null)
  assert.equal(normalizar('cadena', FUENTE_YT), null)
  assert.equal(normalizar({ externalId: 'a', title: 'Ok', url: null }, FUENTE_YT), null)
  // Título por debajo del mínimo del CHECK.
  assert.equal(normalizar({ externalId: 'a', title: 'ab', url: 'https://a.b' }, FUENTE_YT), null)
  // Título por encima del máximo: se descarta, no se trunca a mitad de palabra.
  assert.equal(normalizar({ externalId: 'a', title: 'x'.repeat(TITULO_MAX + 1), url: 'https://a.b' }, FUENTE_YT), null)
})

test('normalizar rechaza esquemas de URL que no son http(s)', () => {
  assert.equal(normalizar({ externalId: 'a', title: 'Título', url: 'javascript:alert(1)' }, FUENTE_YT), null)
  assert.equal(normalizar({ externalId: 'a', title: 'Título', url: 'data:text/html,x' }, FUENTE_YT), null)
})

test('el resumen sí se recorta a 1000 caracteres', () => {
  const c = normalizar({ externalId: 'a', title: 'Título', url: 'https://a.b', summary: 'y'.repeat(5000) }, FUENTE_YT)
  assert.equal(c?.summary?.length, 1000)
})

// ── La CSP manda sobre las miniaturas ───────────────────────────────────────

test('solo pasan las miniaturas de hosts que la CSP puede pintar', () => {
  assert.equal(thumbnailPermitida('https://i.ytimg.com/vi/x/hq.jpg'), 'https://i.ytimg.com/vi/x/hq.jpg')
  assert.equal(thumbnailPermitida('https://proyecto.supabase.co/storage/v1/x.png'), 'https://proyecto.supabase.co/storage/v1/x.png')

  // Cualquier otro host quedaría como un hueco roto en la tarjeta.
  assert.equal(thumbnailPermitida('https://cdn.medio.com/foto.jpg'), null)
  assert.equal(thumbnailPermitida('http://i.ytimg.com/vi/x/hq.jpg'), null, 'http no: la CSP y HSTS exigen https')
  assert.equal(thumbnailPermitida('no-una-url'), null)
  assert.equal(thumbnailPermitida(null), null)
})
