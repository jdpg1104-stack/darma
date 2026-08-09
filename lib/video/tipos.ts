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
  /** Lo que dura el VÍDEO. Para lo que hay que ver, `duracionUtilSegundos`. */
  duracionSegundos: number | null
  miniaturaUrl: string | null
  tema: string | null
  /** ¿Esta persona ya lo completó? Decide si la tarjeta ofrece el +1. */
  completado: boolean

  /**
   * El fragmento curado, o `null` en los dos si la tarjeta reproduce el vídeo
   * entero. Van SIEMPRE en pareja (lo impone un CHECK, ver `0224_1_b07_clips`).
   */
  clipInicioSegundos: number | null
  clipFinSegundos: number | null

  /**
   * Los segundos que de verdad hay que ver: la longitud del fragmento si lo
   * hay, si no la del vídeo, si no 60.
   *
   * Viaja RESUELTO y no se recalcula en cada consumidor a propósito. La regla
   * vive en `duracionUtil()` y en `duracion_util()` de Postgres; una tercera
   * copia en el componente sería la que un día se quedara atrás — y quedarse
   * atrás aquí significa pedir 78 minutos por un fragmento de 40 segundos.
   */
  duracionUtilSegundos: number
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

/** Fila que devuelve `feed_animo()` (migraciones 0107_1 y 0224_1). */
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
  clip_start_seconds: number | null
  clip_end_seconds: number | null
}
