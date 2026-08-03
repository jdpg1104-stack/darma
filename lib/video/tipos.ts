// ============================================================================
// B07 · Vocabulario del feed vertical de vídeo.
//
// Este archivo no importa nada a propósito: lo consumen las rutas, los
// componentes cliente y —vía `lib/video/index.ts`— los bloques B05 (perfil:
// «contenidos completados») y B13 (push: «tu vídeo diario»). Un tipo que
// arrastrase Supabase o Next no podría vivir en los tres sitios.
// ============================================================================

/**
 * Una tarjeta del feed, con lo justo para pintarla ANTES de reproducir.
 *
 * `plataforma` es literal `'youtube'` y no un `string`: la CSP de
 * `next.config.ts` solo permite `frame-src https://www.youtube-nocookie.com`,
 * así que un ítem de otra plataforma no se puede reproducir aquí. El tipo lo
 * hace imposible de construir, no solo desaconsejado.
 *
 * `url` cruda del `content_item` NO está y no debe estar: el embed se compone
 * en `lib/video/embed.ts` a partir de `externalId`.
 */
export interface ItemVideo {
  id: string
  plataforma: 'youtube'
  externalId: string
  titulo: string
  fuente: string
  idioma: string
  duracionSegundos: number | null
  miniaturaUrl: string | null
  tema: string | null
  /** ¿Esta persona ya lo completó? Decide si la tarjeta ofrece el +1. */
  completado: boolean
}

/** Paginación keyset (CONTRATOS §5). El cursor es opaco: nunca se interpreta
 *  en el cliente. */
export interface PaginaCursor<T> {
  items: T[]
  siguienteCursor: string | null
}

/** Lo que devuelve un latido. `faltan` es la ÚNICA cifra de la sesión que sale
 *  del servidor: el bruto acumulado le diría al farmeador cuánto le queda. */
export interface EstadoLatido {
  acreditados: number
  faltan: number
  listo: boolean
}

/**
 * Motivos por los que el +1 no se concede. Son CONTRATO: la UI hace switch
 * sobre ellos para distinguir «te falta vídeo» de «hoy ya llegaste al máximo»,
 * y esa diferencia es la que evita que lo segundo parezca un error.
 */
export type MotivoNoAcreditado = 'tiempo_insuficiente' | 'ya_completado' | 'tope_diario'

/** Respuesta de `POST /api/content/[id]/completado`. */
export interface ResultadoCompletado {
  acreditado: boolean
  karma: 0 | 1
  motivo?: MotivoNoAcreditado
}

/**
 * Motivos que devuelve la RPC `completar_contenido()`. Incluye dos que NO
 * cruzan la frontera de la API: `sesion_invalida` se traduce a un 403 y
 * `no_disponible` a un 404, porque decirle al cliente «tu sesión no vale» y
 * «ese contenido no existe» con el mismo 200 sería un oráculo del catálogo.
 */
export type MotivoRpc = MotivoNoAcreditado | 'sesion_invalida' | 'no_disponible'

/** Fila que devuelve `feed_animo()` (migración 0107_1). */
export interface FilaFeed {
  id: string
  platform: string
  external_id: string
  title: string
  source: string
  language: string
  duration_seconds: number | null
  thumbnail_url: string | null
  topic: string | null
  performance_score: number
}
