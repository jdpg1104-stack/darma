// ============================================================================
// B08 · Tipos del pipeline de ingesta.
//
// Este archivo no importa nada: es el vocabulario compartido entre el crib(ad)o
// de seguridad, la sonda de embed, el clasificador y el orquestador. Que no
// tenga dependencias es lo que permite testear las funciones puras sin arrastrar
// ni Supabase ni Next.
// ============================================================================

/** Las TRES salidas del filtro de seguridad. Nunca dos: ver lib/ingest/seguridad.ts. */
export type DecisionSeguridad = 'seguro' | 'incierto' | 'peligroso'

/** Qué contestó YouTube sobre la incrustación. `desconocido` NO es un «no». */
export type ResultadoEmbed = 'embebible' | 'no_embebible' | 'ausente_o_privado' | 'desconocido'

/** Plataformas que este bloque puede escribir en content_items. Cerrada a propósito. */
export type PlataformaContenido = 'youtube' | 'article'

/** Tipos de origen. Espejo exacto del CHECK de `ingest_sources.kind`. */
export type TipoFuente = 'youtube_playlist' | 'youtube_channel' | 'rss'

/** Valores admitidos por el CHECK de `ingest_log.decision`. */
export type DecisionRegistrada =
  | 'inserted'
  | 'duplicate'
  | 'rejected_safety'
  | 'rejected_embed'
  | 'rejected_quality'
  // Los dos de abajo llegaron con B21 y su CHECK está en 0211_1_b21_ingesta.sql.
  //
  // POR QUÉ NO SE REAPROVECHÓ `rejected_embed` NI `rejected_quality`: porque este
  // campo es exactamente lo que se consultará cuando alguien pregunte «¿por qué
  // no entra nada de esta fuente?». Registrar un rechazo por idioma como
  // `rejected_quality` no es una imprecisión: es contestar mal a la única
  // pregunta que se le va a hacer a la tabla. Dos sesiones en paralelo (B21 §2 y
  // §4) llegaron a esta misma conclusión por separado.
  /** El audio declarado del vídeo no es español. Ver `idiomaAudio.ts`. */
  | 'rejected_language'
  /** El vídeo no pertenece a un canal del registro. Ver `canalesPermitidos.ts`. */
  | 'rejected_channel'
  | 'error'

/** Estados de `content_items.state` (enum public.content_state de 0002). */
export type EstadoContenido = 'pending' | 'approved' | 'rejected'

/** Una fila de `ingest_sources`, tal como la lee el orquestador. */
export interface FuenteIngesta {
  key: string
  kind: TipoFuente
  handle: string
  /** ^[a-z]{2}$ — idioma por defecto de lo que produzca esta fuente. */
  language: string
  topic: string | null
  /** published_at ISO-8601 del ítem más nuevo ya ingerido, o null si nunca corrió. */
  cursor: string | null
  /**
   * Fallos seguidos hasta ahora. Se lee para que el BACKOFF se calcule en
   * TypeScript —donde está probado— y no dentro del almacén: si el cálculo
   * viviera en la capa de base de datos, el test de la curva exponencial
   * necesitaría Postgres.
   */
  fallosConsecutivos: number
}

/** Semilla de una fuente: lo que se upserta, más el porqué de que esté. */
export interface SemillaFuente extends Omit<FuenteIngesta, 'cursor' | 'fallosConsecutivos'> {
  /**
   * JUSTIFICACIÓN OBLIGATORIA. Una fuente sin motivo escrito no entra: este
   * catálogo es lo que verá alguien en su peor noche, y «lo puso alguien hace
   * seis meses» no es una respuesta aceptable ante un contenido dañino.
   */
  porQue: string
}

/** Un candidato normalizado, antes de decidir nada sobre él. */
export interface CandidatoContenido {
  source: string
  platform: PlataformaContenido
  externalId: string
  title: string
  summary: string | null
  url: string
  thumbnailUrl: string | null
  /** ^[a-z]{2}$ — lo exige el CHECK de content_items. */
  language: string
  durationSeconds: number | null
  /** De la taxonomía cerrada, o null. Nunca un tema inventado. */
  topic: string | null
  tags: string[]
  /** ISO-8601 o null. */
  publishedAt: string | null
}

/** Lo que devuelve una ejecución del cron. Es también el cuerpo de la respuesta. */
export interface ResultadoEjecucion {
  /** false = se agotó el presupuesto de tiempo. El cursor quedó guardado. */
  completado: boolean
  fuentesVistas: number
  insertados: number
  duplicados: number
  /**
   * Desglose por CAUSA, no un total. Es lo que convierte «no entra nada» en un
   * diagnóstico: `canal` alto significa una fuente que trae material de
   * terceros; `idioma` alto, una fuente que no es del idioma que declara.
   */
  rechazados: { seguridad: number; embed: number; calidad: number; canal: number; idioma: number }
  pendientes: number
  errores: number
  msTranscurridos: number
}

/** Resultado del cribado de seguridad, con el motivo para `ingest_log.reason`. */
export interface VeredictoSeguridad {
  decision: DecisionSeguridad
  /** Identificador de motivo (`promesa_terapeutica`, `sin_clave_moderacion`…). Nunca texto del upstream. */
  motivo: string | null
}

/** Lo que el clasificador determina de forma determinista, sin modelo. */
export type ClasificacionContenido = Pick<CandidatoContenido, 'language' | 'topic' | 'tags'>

/** Una entrada cruda de un feed, antes de normalizar. Todo opcional: los feeds mienten. */
export interface EntradaCruda {
  externalId?: string | null
  title?: string | null
  summary?: string | null
  url?: string | null
  thumbnailUrl?: string | null
  publishedAt?: string | null
  language?: string | null
  durationSeconds?: number | null
  tags?: string[]
}
