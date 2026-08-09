// ============================================================================
// B07 · Construcción de la URL del reproductor.
//
// ── LA REGLA DURA ──────────────────────────────────────────────────────────
// `plataforma !== 'youtube'` → el ítem SE DESCARTA. No se busca otro origen, no
// se degrada a un enlace. La CSP de `next.config.ts` dice literalmente
// `frame-src 'self' https://www.youtube-nocookie.com`, así que un iframe hacia
// cualquier otro host sale EN BLANCO, sin error de red y sin error de consola
// que lo explique. Es el peor fallo posible: parece un bug intermitente de
// conexión y nadie lo relaciona nunca con una cabecera.
//
// Y no es solo la CSP: los embeds de TikTok e Instagram exigen cargar su script
// propietario en nuestra página, es decir, darles telemetría de quién ve qué en
// una red de apoyo emocional. Descartado en ARCHITECTURE §9.
//
// ── POR QUÉ SE VALIDA `externalId` ─────────────────────────────────────────
// Es un dato de INGESTA: viene de un feed Atom de terceros (B08), no de nuestra
// base de código. Un id con una comilla dentro (`abc"onload=`) interpolado en
// el atributo `src` cierra el atributo y abre uno nuevo. La expresión regular
// `^[A-Za-z0-9_-]{11}$` es exactamente la forma de un id de vídeo de YouTube;
// todo lo demás se descarta antes de tocar el DOM.
// ============================================================================

import { duracionUtil } from './acreditacion.ts'
import type { ItemVideo } from './tipos.ts'

/** El ÚNICO origen de reproducción permitido. Espejo del `frame-src` de la CSP. */
export const ORIGEN_EMBED = 'https://www.youtube-nocookie.com'

/** Host de las miniaturas. Espejo del `img-src` de la CSP. */
export const ORIGEN_MINIATURA = 'https://i.ytimg.com'

/** Forma exacta de un id de vídeo de YouTube. */
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/

/**
 * Parámetros FIJOS del reproductor. No son configurables a propósito: cada uno
 * está aquí por un motivo concreto y dejarlos abiertos invita a "probar" con
 * `autoplay=1`, que es justo lo que hace que el navegador pause el vídeo.
 *
 *  · `enablejsapi=1` + `origin`  → sin los dos, el navegador rechaza los
 *    `postMessage` y el reproductor deja de responder a play/pause/unMute. Es
 *    la causa nº 1 de "el vídeo no arranca y no da error".
 *  · `playsinline=1` → en iOS, sin esto el vídeo salta a pantalla completa y
 *    rompe el scroll vertical.
 *  · `mute=1` + `autoplay=0` → el sonido lo desbloquea un gesto real
 *    (components/video/desbloqueoAudio.ts) y la reproducción la ordena el
 *    coordinador de autoplay. Pedir autoplay con sonido aquí solo consigue que
 *    el navegador ignore la orden.
 *  · `controls=0` → los controles los pone la tarjeta; los de YouTube incluyen
 *    enlaces que sacan a la persona de Darma.
 *  · `rel=0` + `modestbranding=1` → sin sugerencias de vídeos ajenos al final.
 *    En una app de bienestar, "vídeos relacionados" es contenido sin curar
 *    delante de alguien vulnerable.
 */
const PARAMETROS_FIJOS: ReadonlyArray<readonly [string, string]> = [
  ['enablejsapi', '1'],
  ['playsinline', '1'],
  ['rel', '0'],
  ['modestbranding', '1'],
  ['controls', '0'],
  ['autoplay', '0'],
  ['mute', '1'],
]

/**
 * Parámetros del FRAGMENTO. No están en `PARAMETROS_FIJOS` porque no son fijos:
 * salen de la fila curada. Pero tampoco son configurables desde fuera — quien
 * llama no puede inventarse un recorte, solo puede pasar el ítem.
 *
 *  · `start` → segundo en el que el reproductor empieza.
 *  · `end`   → segundo en el que PARA. Es lo que convierte el embed en un
 *    fragmento y no en «un vídeo largo que empieza más tarde»: sin `end`, la
 *    entrevista de 87 minutos sigue sonando después del momento curado.
 *
 * Los dos van juntos o no va ninguno. Un `start` suelto no es medio fragmento:
 * es el vídeo entero empezando tarde, que es peor que no recortar.
 */
const PARAMETRO_INICIO = 'start'
const PARAMETRO_FIN = 'end'

/** Lo mínimo que hay que saber de un ítem para decidir si se puede reproducir. */
export interface CandidatoEmbed {
  platform: string
  external_id: string
  /** Marcas del fragmento curado. Ausentes o nulas = vídeo entero. */
  clip_start_seconds?: number | null
  clip_end_seconds?: number | null
}

/** ¿Es un id de vídeo de YouTube bien formado? */
export function esIdYoutubeValido(valor: unknown): valor is string {
  return typeof valor === 'string' && ID_YOUTUBE.test(valor)
}

/**
 * ¿Se puede reproducir este ítem dentro de Darma?
 *
 * Es el filtro que se aplica ANTES de construir un `ItemVideo`: lo que no pasa
 * por aquí no llega al cliente, y por eso `ItemVideo.plataforma` puede ser el
 * literal `'youtube'` sin mentir.
 */
export function esReproducible(candidato: CandidatoEmbed): boolean {
  return candidato.platform === 'youtube' && esIdYoutubeValido(candidato.external_id)
}

/**
 * Origen de nuestra propia página, para el parámetro `origin`.
 *
 * En el navegador se prefiere `window.location.origin` al valor de entorno: si
 * los dos no coinciden (preview de Vercel, un puerto distinto en desarrollo),
 * el reproductor descarta nuestros mensajes en silencio.
 */
export function origenPropio(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

export interface OpcionesEmbed {
  /** Sobrescribe el origen. Inyectable para que los tests no dependan del entorno. */
  origen?: string
}

/**
 * URL del reproductor, o `null` si el ítem no se puede reproducir aquí.
 *
 * Devuelve `null` en vez de lanzar porque el caso normal —un ítem de otra
 * plataforma que se coló en el catálogo— no es excepcional: es un ítem que se
 * descarta. Lanzar obligaría a envolver cada tarjeta en un try/catch y una
 * excepción no capturada tumbaría el feed entero por un vídeo malo.
 */
export function urlEmbed(
  item: CandidatoEmbed,
  opciones: OpcionesEmbed = {},
): string | null {
  if (!esReproducible(item)) return null

  const parametros = new URLSearchParams(PARAMETROS_FIJOS.map(([k, v]) => [k, v]))
  parametros.set('origin', opciones.origen ?? origenPropio())

  // El fragmento se aplica solo si la PAREJA está completa y es coherente. La
  // fuente normal es una fila que ya pasó los CHECK del esquema, pero esta
  // función también la llaman los tests y —el día de mañana— cualquier ruta
  // nueva: un `start` mayor que el `end` produciría un embed que no reproduce
  // nada, y en silencio.
  const inicio = item.clip_start_seconds
  const fin = item.clip_end_seconds
  if (
    typeof inicio === 'number' &&
    typeof fin === 'number' &&
    Number.isInteger(inicio) &&
    Number.isInteger(fin) &&
    inicio >= 0 &&
    fin > inicio
  ) {
    parametros.set(PARAMETRO_INICIO, String(inicio))
    parametros.set(PARAMETRO_FIN, String(fin))
  }

  return `${ORIGEN_EMBED}/embed/${item.external_id}?${parametros.toString()}`
}

/**
 * Igual que `urlEmbed`, partiendo del `ItemVideo` que ya viaja al cliente.
 *
 * Existe para que la tarjeta no tenga que traducir `plataforma`/`externalId` a
 * la forma de la fila: esa traducción a mano en cada consumidor es donde se
 * cuela un día un `platform: 'youtube'` fijo sin comprobar el id real.
 */
export function urlEmbedDeItem(item: ItemVideo, opciones: OpcionesEmbed = {}): string | null {
  return urlEmbed(
    {
      platform: item.plataforma,
      external_id: item.externalId,
      clip_start_seconds: item.clipInicioSegundos,
      clip_end_seconds: item.clipFinSegundos,
    },
    opciones,
  )
}

/**
 * Miniatura de la tarjeta mientras NO hay iframe.
 *
 * Solo se acepta lo que la CSP deja cargar: `i.ytimg.com` o Supabase Storage.
 * Si `thumbnail_url` trae otra cosa (un feed puede traer cualquier cosa), se
 * cae a la miniatura canónica derivada del id, que siempre existe.
 */
export function urlMiniatura(item: CandidatoEmbed, thumbnailUrl: string | null): string | null {
  if (!esReproducible(item)) return null

  if (thumbnailUrl) {
    try {
      const host = new URL(thumbnailUrl).host
      if (host === 'i.ytimg.com' || host.endsWith('.supabase.co')) return thumbnailUrl
    } catch {
      // URL malformada: se ignora y se usa la canónica.
    }
  }

  return `${ORIGEN_MINIATURA}/vi/${item.external_id}/hqdefault.jpg`
}

/**
 * Convierte una fila del catálogo en la tarjeta que ve el cliente, o `null` si
 * no es reproducible. Es el único sitio donde nace un `ItemVideo`.
 */
export function itemVideoDesde(
  fila: {
    id: string
    platform: string
    external_id: string
    title: string
    source: string
    language: string
    duration_seconds: number | null
    thumbnail_url: string | null
    topic: string | null
    clip_start_seconds?: number | null
    clip_end_seconds?: number | null
  },
  completado = false,
): ItemVideo | null {
  if (!esReproducible(fila)) return null

  // La pareja se normaliza AQUÍ, en el único sitio donde nace un `ItemVideo`.
  // Una mitad suelta —que el esquema no deja escribir, pero que una fila vieja
  // o un test podrían traer— se trata como «sin fragmento»: es la única lectura
  // que no miente al reproductor ni a la acreditación.
  const inicio = fila.clip_start_seconds ?? null
  const fin = fila.clip_end_seconds ?? null
  const conFragmento = inicio !== null && fin !== null && fin > inicio

  return {
    id: fila.id,
    plataforma: 'youtube',
    externalId: fila.external_id,
    titulo: fila.title,
    fuente: fila.source,
    idioma: fila.language,
    duracionSegundos: fila.duration_seconds,
    miniaturaUrl: urlMiniatura(fila, fila.thumbnail_url),
    tema: fila.topic,
    completado,
    clipInicioSegundos: conFragmento ? inicio : null,
    clipFinSegundos: conFragmento ? fin : null,
    duracionUtilSegundos: duracionUtil(
      fila.duration_seconds,
      conFragmento ? inicio : null,
      conFragmento ? fin : null,
    ),
  }
}
