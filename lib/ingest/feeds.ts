// ============================================================================
// B08 · Lectura de feeds: Atom (YouTube) y RSS 2.0.
//
// ── DECISIÓN: YOUTUBE POR FEED ATOM, NO POR LA DATA API ─────────────────────
// `https://www.youtube.com/feeds/videos.xml?playlist_id=…` (o `channel_id=…`)
// devuelve los últimos ~15 vídeos de una playlist o canal SIN clave de API y
// SIN consumir cuota. La Data API daría además la duración y el idioma, pero a
// cambio de 10.000 unidades/día que dos backfills agotan — y cuando la cuota se
// agota, la ingesta se queda ciega justo cuando más está corriendo. Es el mismo
// razonamiento que llevó a usar oEmbed en lugar de `videos.list` para el embed.
// Coste asumido: `duration_seconds` queda `null` (la columna lo admite) y el
// idioma se hereda de `ingest_sources.language`.
//
// ── DECISIÓN: PARSEO PROPIO, SIN DEPENDENCIA ────────────────────────────────
// Meter un parser XML completo en el bundle para leer cuatro campos de un feed
// es superficie de ataque y de mantenimiento a cambio de nada. Este lector es
// deliberadamente conservador: si una entrada no tiene id o título, se descarta
// en vez de inventarlos. Un feed malformado produce menos ítems, nunca ítems
// inventados.
//
// NUNCA LANZA: un XML corrupto devuelve lista vacía, y quien llama lo trata como
// un fallo de la fuente (backoff), no como una excepción que aborta la ejecución.
// ============================================================================

import type { EntradaCruda } from './tipos.ts'

/** URL del feed Atom de una playlist de YouTube. Sin clave, sin cuota. */
export function urlFeedPlaylist(playlistId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`
}

/** URL del feed Atom de un canal de YouTube. Sin clave, sin cuota. */
export function urlFeedCanal(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
}

// ── Utilidades de XML ───────────────────────────────────────────────────────

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
}

/** Decodifica entidades XML/HTML. Los feeds las anidan («&amp;quot;»), de ahí las dos pasadas. */
export function decodificarEntidades(texto: string): string {
  let salida = texto
  for (let pasada = 0; pasada < 2; pasada++) {
    salida = salida.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (completo, nombre: string) => {
      const clave = nombre.toLowerCase()
      if (clave in ENTIDADES) return ENTIDADES[clave]
      if (clave.startsWith('#x')) {
        const n = Number.parseInt(clave.slice(2), 16)
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : completo
      }
      if (clave.startsWith('#')) {
        const n = Number.parseInt(clave.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : completo
      }
      return completo
    })
  }
  return salida
}

/** Quita CDATA, etiquetas HTML incrustadas y espacio sobrante. */
export function limpiarTexto(bruto: string | null): string | null {
  if (bruto == null) return null
  const sinCdata = bruto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  const sinEtiquetas = decodificarEntidades(sinCdata).replace(/<[^>]*>/g, ' ')
  const limpio = sinEtiquetas.replace(/\s+/g, ' ').trim()
  return limpio.length > 0 ? limpio : null
}

/** Primer contenido de `<etiqueta …>…</etiqueta>`, admitiendo prefijo de espacio de nombres. */
function contenidoEtiqueta(xml: string, etiqueta: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${etiqueta}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${etiqueta}>`, 'i')
  return re.exec(xml)?.[1] ?? null
}

/** Valor de un atributo dentro de la primera etiqueta que coincida. */
function atributoEtiqueta(xml: string, etiqueta: string, atributo: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${etiqueta}\\b([^>]*)>`, 'i')
  const abre = re.exec(xml)?.[1]
  if (!abre) return null
  const attr = new RegExp(`\\b${atributo}\\s*=\\s*["']([^"']*)["']`, 'i').exec(abre)?.[1]
  return attr ? decodificarEntidades(attr) : null
}

/** Trocea el documento en bloques `<entry>` (Atom) o `<item>` (RSS 2.0). */
function trocear(xml: string, etiqueta: 'entry' | 'item'): string[] {
  const re = new RegExp(`<${etiqueta}\\b[^>]*>[\\s\\S]*?</${etiqueta}>`, 'gi')
  return xml.match(re) ?? []
}

/** Normaliza una fecha de feed a ISO-8601, o `null` si no es interpretable. */
export function fechaIso(bruto: string | null): string | null {
  if (!bruto) return null
  const t = Date.parse(bruto.trim())
  if (!Number.isFinite(t)) return null
  // Una fecha en el futuro casi siempre es un feed con la zona horaria mal
  // puesta. Se admite un margen de un día; más allá, se ignora la fecha en vez
  // de dejar que el ítem se cuele para siempre al principio de «Novedades».
  if (t > Date.now() + 24 * 60 * 60 * 1000) return null
  return new Date(t).toISOString()
}

// ── Parseo ──────────────────────────────────────────────────────────────────

/** Extrae las entradas de un feed Atom de YouTube. Nunca lanza. */
export function parsearFeedYoutube(xml: string): EntradaCruda[] {
  if (typeof xml !== 'string' || xml.length === 0) return []
  const salida: EntradaCruda[] = []

  for (const bloque of trocear(xml, 'entry')) {
    // `<yt:videoId>` es el id canónico. `<id>yt:video:XXXX</id>` es el respaldo
    // por si YouTube deja de emitir el espacio de nombres yt.
    const idDirecto = limpiarTexto(contenidoEtiqueta(bloque, 'videoId'))
    const idRespaldo = /yt:video:([\w-]{6,20})/.exec(limpiarTexto(contenidoEtiqueta(bloque, 'id')) ?? '')?.[1] ?? null
    const externalId = idDirecto ?? idRespaldo
    if (!externalId) continue

    salida.push({
      externalId,
      title: limpiarTexto(contenidoEtiqueta(bloque, 'title')),
      summary: limpiarTexto(contenidoEtiqueta(bloque, 'description')),
      // URL canónica construida a partir del id y no leída del `<link>`: el
      // enlace del feed puede traer parámetros de campaña, y dos URLs distintas
      // del mismo vídeo ensuciarían el catálogo aunque el unique lo dedupe.
      url: `https://www.youtube.com/watch?v=${externalId}`,
      thumbnailUrl: atributoEtiqueta(bloque, 'thumbnail', 'url'),
      publishedAt: fechaIso(limpiarTexto(contenidoEtiqueta(bloque, 'published'))),
      durationSeconds: null,
      tags: [],
    })
  }
  return salida
}

/** Extrae las entradas de un feed RSS 2.0 o Atom genérico. Nunca lanza. */
export function parsearFeedRss(xml: string): EntradaCruda[] {
  if (typeof xml !== 'string' || xml.length === 0) return []

  const bloques = trocear(xml, 'item')
  const esAtom = bloques.length === 0
  const entradas = esAtom ? trocear(xml, 'entry') : bloques
  const salida: EntradaCruda[] = []

  for (const bloque of entradas) {
    const url = esAtom
      ? (atributoEtiqueta(bloque, 'link', 'href') ?? limpiarTexto(contenidoEtiqueta(bloque, 'link')))
      : limpiarTexto(contenidoEtiqueta(bloque, 'link'))
    const guid = limpiarTexto(contenidoEtiqueta(bloque, 'guid')) ?? limpiarTexto(contenidoEtiqueta(bloque, 'id'))
    const title = limpiarTexto(contenidoEtiqueta(bloque, 'title'))

    // Sin URL no hay artículo que abrir; sin id estable no hay idempotencia.
    // El guid es preferible al enlace: un medio que cambia su estructura de URLs
    // reingeriría su archivo entero como si fuera nuevo.
    const externalId = guid ?? url
    if (!externalId || !url || !title) continue

    const categorias = [...bloque.matchAll(/<(?:[a-zA-Z0-9]+:)?category\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?category>/gi)]
      .map((m) => limpiarTexto(m[1]))
      .filter((v): v is string => v != null)

    salida.push({
      externalId,
      title,
      summary:
        limpiarTexto(contenidoEtiqueta(bloque, 'description')) ??
        limpiarTexto(contenidoEtiqueta(bloque, 'summary')) ??
        limpiarTexto(contenidoEtiqueta(bloque, 'content')),
      url,
      // Deliberadamente sin miniatura: la CSP (next.config.ts) solo admite
      // `i.ytimg.com` y Supabase Storage en `img-src`. La imagen de un medio
      // cualquiera no se pintaría y dejaría un hueco roto en la tarjeta.
      thumbnailUrl: null,
      publishedAt:
        fechaIso(limpiarTexto(contenidoEtiqueta(bloque, 'pubDate'))) ??
        fechaIso(limpiarTexto(contenidoEtiqueta(bloque, 'published'))) ??
        fechaIso(limpiarTexto(contenidoEtiqueta(bloque, 'updated'))),
      language: limpiarTexto(contenidoEtiqueta(bloque, 'language')),
      durationSeconds: null,
      tags: categorias,
    })
  }
  return salida
}
