// ============================================================================
// B11 · Configuración del modelo, coste y presupuesto
//
// Todo lo que cuesta dinero está en este archivo, junto, y con el número al
// lado del razonamiento. La razón es práctica: el día que la factura sorprenda
// a alguien, este es el único archivo que hay que abrir.
//
// NO se construye ningún cliente aquí. Este módulo es datos puros y se puede
// importar desde cualquier sitio (incluidos los tests) sin efectos.
// ============================================================================

/**
 * Modelo por defecto. Id EXACTO, sin sufijo de fecha.
 *
 * Se lee de `MODERATION_MODEL` para poder cambiar de tier sin desplegar: si un
 * día el cribado se puede hacer más barato, es un cambio de variable de entorno
 * y no una release.
 */
export const MODELO_POR_DEFECTO = 'claude-opus-5'

/** Modelo efectivo. Función y no constante: la env puede cambiar en caliente. */
export function modeloActivo(): string {
  const declarado = process.env.MODERATION_MODEL?.trim()
  return declarado && declarado.length > 0 ? declarado : MODELO_POR_DEFECTO
}

/**
 * Esfuerzo de razonamiento. `low` porque esto es CRIBADO, no razonamiento
 * profundo: un clasificador con rúbrica fija no mejora pensando más, solo
 * cuesta más y tarda más.
 *
 * ⚠️ NO se pasa `thinking: {type:'disabled'}`. En `claude-opus-5` el
 * pensamiento va activado por defecto y desactivarlo tiene dos fallos
 * conocidos: llamadas a herramienta emitidas como texto plano (que
 * silenciosamente no se ejecutan) y fuga de etiquetas `<thinking>` en la
 * respuesta. Bajar el esfuerzo es el ahorro correcto; apagar el pensamiento no.
 */
export const ESFUERZO = 'low' as const

/**
 * Tope de tokens de salida.
 *
 * ⚠️ En `claude-opus-5`, `max_tokens` acota pensamiento + texto JUNTOS. Con
 * `effort: 'low'` y una salida de ~120 tokens sobra, pero si algún día se sube
 * el esfuerzo hay que subir esto o la respuesta se corta a la mitad. Una
 * respuesta cortada (`stop_reason: 'max_tokens'`) se trata como
 * `indeterminado`, nunca como un veredicto parcial válido.
 */
export const MAX_TOKENS = 512

/**
 * Plazo del cliente, en MILISEGUNDOS (en el SDK de TypeScript el timeout va en
 * ms, no en segundos como en Python).
 *
 * 2 500 ms es una decisión de producto, no de infraestructura: un composer
 * colgado ocho segundos es peor experiencia que uno que publica sin validar.
 * Pasado el plazo se degrada (ver `lib/ai/pipeline.ts`).
 */
export const TIMEOUT_MS = 2500

/** Un reintento y basta: dos reintentos de 2,5 s ya son 7,5 s de espera. */
export const MAX_REINTENTOS = 1

// ── Coste ───────────────────────────────────────────────────────────────────
// Tarifa pública de claude-opus-5, en dólares por millón de tokens.

export const COSTE_ENTRADA_MTOK = 5
export const COSTE_SALIDA_MTOK = 25
export const COSTE_CACHE_LECTURA_MTOK = 0.5
/** Escribir caché cuesta 1,25× la entrada normal. Se paga una vez cada 5 min. */
export const COSTE_CACHE_ESCRITURA_MTOK = 6.25

/**
 * Mínimo cacheable en `claude-opus-5`: 512 tokens (la mitad que en Opus 4.8).
 *
 * Por debajo NO da error: simplemente `cache_creation_input_tokens` sale 0 y
 * nadie se entera. Por eso `lib/ai/rubrica.ts` tiene un test de longitud.
 */
export const MINIMO_CACHEABLE_TOKENS = 512

export interface UsoTokens {
  entrada: number
  salida: number
  cacheLectura: number
  cacheEscritura: number
}

export const USO_CERO: UsoTokens = Object.freeze({
  entrada: 0,
  salida: 0,
  cacheLectura: 0,
  cacheEscritura: 0,
})

/** Coste en dólares de un uso concreto. PURA. */
export function costeUsd(uso: UsoTokens): number {
  return (
    (uso.entrada * COSTE_ENTRADA_MTOK +
      uso.salida * COSTE_SALIDA_MTOK +
      uso.cacheLectura * COSTE_CACHE_LECTURA_MTOK +
      uso.cacheEscritura * COSTE_CACHE_ESCRITURA_MTOK) /
    1_000_000
  )
}

/**
 * Perfil de una clasificación típica, medido sobre la rúbrica real:
 *   · ~1 200 tokens de system, CACHEADOS (lectura a 0,5 $/MTok) → 0,000600 $
 *   · ~250 tokens de entrada nueva (el texto de la persona)     → 0,001250 $
 *   · ~120 tokens de salida (el JSON del veredicto)             → 0,003000 $
 *                                                          total ≈ 0,00485 $
 *
 * Si la caché NO funciona (fecha interpolada en el system, rúbrica editada en
 * cada despliegue…), esos 1 200 tokens pasan a costar 0,006 $ y la llamada se
 * va a 0,0103 $: más del DOBLE. Ese es el error más caro y más silencioso de
 * este bloque, y por eso hay un test que lo vigila.
 */
export const USO_TIPICO: UsoTokens = Object.freeze({
  entrada: 250,
  salida: 120,
  cacheLectura: 1200,
  cacheEscritura: 0,
})

/** ≈ 0,00485 $. El número que gobierna el presupuesto. */
export const COSTE_ESTIMADO_LLAMADA_USD = costeUsd(USO_TIPICO)

/**
 * Presupuesto diario en dólares. Por defecto 600 $/día ≈ 123 000 clasificaciones.
 *
 * El orden de magnitud: a 100 000 comentarios clasificados al día son ~485 $/día
 * (~14 500 $/mes). Que ese número exista es la razón de que el cortacircuitos de
 * `lib/ai/presupuesto.ts` sea un requisito duro y no una optimización.
 */
export function presupuestoDiarioUsd(): number {
  const declarado = Number(process.env.MODERATION_BUDGET_USD_DAY)
  return Number.isFinite(declarado) && declarado > 0 ? declarado : 600
}

/** Cuántas llamadas caben en el presupuesto de hoy. */
export function llamadasDiariasMaximas(): number {
  return Math.max(1, Math.floor(presupuestoDiarioUsd() / COSTE_ESTIMADO_LLAMADA_USD))
}

/** Límite por persona: 20 clasificaciones/hora (CONTRATOS §6 + ficha B11 §9). */
export const LIMITE_USUARIO = Object.freeze({ limite: 20, ventanaSegundos: 3600 })

/**
 * Límite de reportes: 10/hora y persona.
 *
 * Bajo a propósito. Sin este límite el botón de reportar deja de ser una
 * herramienta de la comunidad y pasa a ser el arma del acosador: diez cuentas
 * reportando en bucle tumban a cualquiera.
 */
export const LIMITE_REPORTE = Object.freeze({ limite: 10, ventanaSegundos: 3600 })

/** Clave del contador global diario en `public.rate_limits`. */
export const CLAVE_PRESUPUESTO_GLOBAL = 'ia:global:diaria'

/** Fracción del presupuesto a partir de la cual se avisa (80 %). */
export const UMBRAL_AVISO = 0.8

/**
 * Versión de la rúbrica. Se SUBE A MANO al cambiar `lib/ai/rubrica.ts`.
 *
 * Va en cada fila de auditoría: sin ella, "el clasificador empezó a fallar la
 * semana pasada" no se puede correlacionar con nada.
 */
export const PROMPT_VERSION = '2026-08-03.1'
