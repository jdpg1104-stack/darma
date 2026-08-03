// ============================================================================
// B08 · De entrada cruda de feed a candidato válido — o a `null`.
//
// Esta función es la ÚNICA puerta entre «lo que dijo el feed» y «lo que puede
// entrar en content_items». Todo lo que no cumpla los CHECK de la tabla se
// descarta AQUÍ, en memoria y gratis, en vez de reventar el insert después de
// haber pagado la descarga, la clasificación y la llamada al modelo.
//
// Devolver `null` no es un error: es un rechazo por calidad, y quien llama lo
// registra como `rejected_quality`.
// ============================================================================

import type { CandidatoContenido, EntradaCruda, FuenteIngesta, PlataformaContenido } from './tipos.ts'
import { recortarIdioma, normalizarTags } from './clasificar.ts'

/** Espejo del CHECK `char_length(title) between 3 and 200`. */
export const TITULO_MIN = 3
export const TITULO_MAX = 200
/** Espejo del CHECK `char_length(summary) <= 1000`. */
export const RESUMEN_MAX = 1000

/**
 * Hosts admitidos en `thumbnail_url`.
 *
 * next.config.ts limita `img-src` a `i.ytimg.com` y a Supabase Storage. Una
 * miniatura de cualquier otro host NO se pintaría: el navegador la bloquea y
 * queda un hueco roto en la tarjeta, que es peor que no tener miniatura. Por eso
 * lo que no está en esta lista se guarda como `null`.
 */
export function thumbnailPermitida(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null
  let host: string
  let protocolo: string
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase()
    protocolo = u.protocol
  } catch {
    return null
  }
  if (protocolo !== 'https:') return null
  if (host === 'i.ytimg.com') return url

  // Supabase Storage: se deriva de la URL del proyecto, igual que hace la CSP.
  // Escrito a mano, el mismo archivo dejaría de valer entre desarrollo, preview
  // y producción.
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (supabase) {
    try {
      if (host === new URL(supabase).hostname.toLowerCase()) return url
    } catch {
      /* URL de proyecto mal formada: se ignora y la miniatura no pasa. */
    }
  }
  if (host.endsWith('.supabase.co')) return url

  return null
}

/** La plataforma que produce cada tipo de fuente. Cerrada: nada más entra en la tabla. */
export function plataformaDe(kind: FuenteIngesta['kind']): PlataformaContenido {
  return kind === 'rss' ? 'article' : 'youtube'
}

/**
 * Normaliza una entrada cruda. `null` = no cumple el mínimo para existir.
 *
 * @param crudo `unknown` a propósito: viene de parsear XML de terceros y no hay
 *              ninguna garantía sobre su forma.
 */
export function normalizar(crudo: unknown, fuente: FuenteIngesta): CandidatoContenido | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const e = crudo as EntradaCruda

  const externalId = texto(e.externalId)
  const titulo = texto(e.title)
  const url = texto(e.url)
  if (!externalId || !titulo || !url) return null

  // Solo http(s). Un `javascript:` o un `data:` en un feed es un intento de
  // inyección, y aquí es gratis pararlo.
  let urlValida: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    urlValida = u.toString()
  } catch {
    return null
  }

  // El título NO se recorta a 200: un título truncado a mitad de palabra es peor
  // que no tener el ítem, y un feed que da títulos de 300 caracteres casi
  // siempre está dando otra cosa (un párrafo, un error). Se descarta.
  if (titulo.length < TITULO_MIN || titulo.length > TITULO_MAX) return null

  // El resumen SÍ se recorta: es contexto, no identidad del ítem, y perder la
  // cola de un párrafo no cambia lo que la persona ve en la tarjeta.
  const resumen = texto(e.summary)
  const summary = resumen ? resumen.slice(0, RESUMEN_MAX) : null

  const duracion = typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds) && e.durationSeconds >= 0
    ? Math.floor(e.durationSeconds)
    : null

  return {
    source: fuente.key,
    platform: plataformaDe(fuente.kind),
    externalId: externalId.slice(0, 400),
    title: titulo,
    summary,
    url: urlValida,
    thumbnailUrl: thumbnailPermitida(e.thumbnailUrl),
    // El idioma definitivo lo fija `clasificar()`; aquí solo se recorta lo que
    // dijo el feed para no arrastrar 'es-419' más allá de este punto.
    language: recortarIdioma(e.language) ?? fuente.language,
    durationSeconds: duracion,
    topic: fuente.topic,
    tags: normalizarTags(e.tags),
    publishedAt: texto(e.publishedAt),
  }
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}
