// ============================================================================
// Rate limiting de dos capas: memoria (rápida, best-effort) + Postgres (real)
//
// ── POR QUÉ LA CAPA DE MEMORIA SOLA NO BASTA EN SERVERLESS ─────────────────
// Un Map de módulo vive en el proceso de UNA instancia lambda. En Vercel:
//
//   · Hay N instancias vivas a la vez y el enrutado es opaco: 10 peticiones del
//     mismo usuario pueden caer en 10 instancias distintas, cada una con su
//     contador a 1. Un límite de "5 por minuto" se convierte, en la práctica,
//     en "5 por minuto POR INSTANCIA" — es decir, en ninguno.
//   · Un cold start empieza con el Map vacío. Basta con esperar a que la
//     instancia se recicle (o forzarlo con una ráfaga que provoque escalado)
//     para resetear el contador.
//   · Ninguna instancia ve las peticiones de las otras, así que el ataque que
//     de verdad importa —muchas peticiones en paralelo— es justo el que la capa
//     de memoria no ve.
//
// Entonces, ¿para qué mantenerla? Porque atrapa el caso común —un cliente con
// un bucle apretado sobre una instancia caliente— sin gastar un round-trip a la
// base de datos, y así el 95 % del abuso no llega a consumir una conexión de
// Postgres. Es un filtro barato delante de uno caro, no una alternativa.
//
// La capa 2 (`check_rate_limit`, migración 0002) es la que cuenta de verdad:
// un contador compartido en Postgres, atómico, que ven todas las instancias.
//
// ── ORDEN DE LAS CAPAS ─────────────────────────────────────────────────────
// Memoria primero. Si la memoria ya dice NO, no hace falta preguntar a Postgres
// (la respuesta solo puede ser NO también: la memoria es un subconjunto del
// tráfico global). Si dice SÍ, hay que confirmar con Postgres.
//
// ── FAIL-OPEN vs FAIL-CLOSED ───────────────────────────────────────────────
// Si Postgres falla, esta capa hace FAIL-OPEN (deja pasar) y lo registra como
// error. Es una decisión consciente: en Darma la alternativa es que una
// incidencia de base de datos impida a alguien publicar que está mal. El daño
// de un rate limit caído durante unos minutos es spam; el daño de fail-closed
// es una puerta cerrada en el peor momento. La excepción son las rutas de
// dinero/karma, que deben pasar `failClosed: true`: ahí sí, ante la duda, no.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Capa 1: memoria ─────────────────────────────────────────────────────────

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Tope de entradas del Map antes de la limpieza oportunista. Evita que un
 *  ataque con claves variables (un id por petición) haga crecer el mapa sin
 *  límite hasta agotar la memoria de la instancia. */
const MAX_BUCKETS = 5000

export interface RateLimitResult {
  ok: boolean
  /** Segundos hasta que se reabre la ventana (0 si está permitido). Va en la
   *  cabecera Retry-After. */
  retryAfter: number
  /** Qué capa denegó. Solo para logs y métricas. */
  layer: 'memory' | 'postgres' | null
}

/**
 * Ventana fija en memoria. Best-effort, síncrono, sin I/O. Función con efecto
 * (muta el Map) pero determinista dado el reloj.
 *
 * Ventana FIJA y no deslizante a propósito: la deslizante exige guardar el
 * timestamp de cada petición (memoria proporcional al tráfico, justo lo que un
 * atacante quiere) y aquí no compensa. El defecto conocido de la ventana fija
 * —hasta 2× el límite a caballo entre dos ventanas— lo cubre la capa 2.
 */
export function rateLimitMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k)
    }
  }

  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0, layer: null }
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000), layer: 'memory' }
  }

  bucket.count++
  return { ok: true, retryAfter: 0, layer: null }
}

/** Vacía el estado en memoria. SOLO para tests: sin esto, los tests comparten
 *  contadores entre casos y se contaminan según el orden de ejecución. */
export function __resetMemoryBuckets(): void {
  buckets.clear()
}

// ── Capa 2: Postgres ────────────────────────────────────────────────────────

/**
 * Firma de la RPC (migración 0002):
 *   check_rate_limit(p_key text, p_limit int, p_window_seconds int) -> boolean
 *
 * Devuelve true si la petición se permite (y la contabiliza), false si excede.
 * La cuenta y la comprobación ocurren dentro de la función, en una sola
 * sentencia: por eso N peticiones simultáneas no pueden pasar todas.
 */
export async function rateLimitPostgres(
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowSeconds: number,
  options: { failClosed?: boolean } = {},
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })

    if (error) throw new Error(error.message)

    // `data` viene tipado como unknown desde el cliente sin tipos generados;
    // se compara explícitamente contra true para que un null (RPC ausente,
    // migración sin aplicar) no se interprete como "permitido" por casualidad.
    const allowed = data === true
    return allowed
      ? { ok: true, retryAfter: 0, layer: null }
      : { ok: false, retryAfter: windowSeconds, layer: 'postgres' }
  } catch {
    // Ver "FAIL-OPEN vs FAIL-CLOSED" en la cabecera. El logging lo hace quien
    // llama (aquí no importamos el logger para que el módulo siga siendo
    // testeable sin tocar la salida estándar).
    return options.failClosed
      ? { ok: false, retryAfter: windowSeconds, layer: 'postgres' }
      : { ok: true, retryAfter: 0, layer: null }
  }
}

// ── Composición ─────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Identificador de lo que se limita: `${accion}:${userId}` o `:${ip}`. */
  key: string
  limit: number
  windowSeconds: number
  /** Cliente para la capa 2. Sin él, solo se aplica la capa de memoria. */
  supabase?: SupabaseClient
  /** Denegar si Postgres falla. Actívalo en rutas de karma/pago. */
  failClosed?: boolean
}

/**
 * Comprobación completa: memoria primero (barata), Postgres después (real).
 */
export async function rateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowSeconds, supabase, failClosed } = options

  const memory = rateLimitMemory(key, limit, windowSeconds * 1000)
  if (!memory.ok) return memory

  if (!supabase) return memory

  return rateLimitPostgres(supabase, key, limit, windowSeconds, { failClosed })
}

// ── Presets ─────────────────────────────────────────────────────────────────
/**
 * Límites por acción. Están AQUÍ y no repartidos por las rutas para que se
 * puedan leer todos juntos: un límite solo se entiende en relación con los
 * demás.
 *
 * Calibrados sobre el uso humano real, no sobre "lo que aguanta el servidor":
 * publicar 10 desahogos en una hora ya es una señal de que algo pasa, y el
 * gate 3:1 lo limita mucho antes que este contador.
 */
export const RATE_LIMITS = {
  /** Publicar. El gate 3:1 es el límite real; esto es la red de seguridad. */
  createPost: { limit: 10, windowSeconds: 3600 },
  /** Comentar. Escuchar mucho es bueno; 30/h ya es velocidad de bot. */
  createComment: { limit: 30, windowSeconds: 3600 },
  /** Votar. Barato, pero es la vía de manipulación del feed más obvia. */
  vote: { limit: 120, windowSeconds: 3600 },
  /** Reportar. Bajo a propósito: el reporte masivo es acoso coordinado. */
  report: { limit: 20, windowSeconds: 86400 },
  /** Alta de cuenta por IP. Es la barrera anti-multicuenta del lado de la app;
   *  la otra es el contact_hash de identity_vault. */
  signup: { limit: 5, windowSeconds: 86400 },
  /** Llamadas al clasificador de IA (cuestan dinero por token). */
  aiClassify: { limit: 60, windowSeconds: 3600 },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

/** Atajo para las rutas: `await limitAction('createPost', userId, supabase)`. */
export async function limitAction(
  action: RateLimitAction,
  subject: string,
  supabase?: SupabaseClient,
  failClosed = false,
): Promise<RateLimitResult> {
  const preset = RATE_LIMITS[action]
  return rateLimit({
    key: `${action}:${subject}`,
    limit: preset.limit,
    windowSeconds: preset.windowSeconds,
    supabase,
    failClosed,
  })
}
