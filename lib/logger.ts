// ============================================================================
// Logger estructurado con redacción de PII
//
// En una app normal un log de más es ruido. En Darma un log de más puede ser la
// des-anonimización de alguien: el cuerpo de un post contiene, por definición,
// lo más íntimo que esa persona ha escrito nunca, y los logs acaban en un
// proveedor externo, en un dashboard compartido y en un backup que nadie borra.
//
// De ahí las dos reglas de este módulo:
//
//   1. NUNCA se registra el cuerpo de un post o comentario. Ni truncado, ni
//      "solo los primeros 50 caracteres" para depurar: 50 caracteres del
//      desahogo de alguien son el desahogo de alguien. Se registra su id y su
//      longitud, que es lo que de verdad sirve para depurar.
//   2. Todo lo que sí se registra pasa por `redactPii` y por la lista de claves
//      sensibles. La redacción es por si acaso, no por si sí: si alguien mete
//      un texto de usuario en un log, el daño se queda en "[email]" en vez de
//      en una dirección real.
//
// FORMATO: una línea JSON por evento. No es por gusto — Vercel, Datadog y
// CloudWatch parsean JSON automáticamente y permiten filtrar por campo; con
// texto libre hay que escribir expresiones regulares sobre los logs, que es
// justo lo que nadie hace a las 3 de la mañana durante un incidente.
//
// ALTERNATIVA DESCARTADA: pino/winston. Traen transports, workers y ~40
// dependencias para algo que en serverless es `console.log` de un JSON — la
// plataforma ya se encarga del transporte. Menos superficie, menos que auditar.
// ============================================================================

import { redactPii } from './anonymity.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const

/**
 * Nivel mínimo. En producción sube a 'info': `debug` existe para desarrollo y
 * dejarlo activo en producción es la forma más habitual de que acabe
 * registrándose material del usuario "temporalmente".
 */
const MIN_LEVEL: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug'

/**
 * Claves cuyo VALOR nunca se emite.
 *
 * Se redacta por NOMBRE DE CLAVE además de por contenido, porque el contenido
 * no siempre tiene forma reconocible: un token no se parece a nada, y el cuerpo
 * de un post no se parece a PII aunque lo sea.
 *
 * REGLA DE COINCIDENCIA (ver `isRedactedKey`): igualdad exacta o sufijo
 * `_clave`, sobre la clave normalizada a snake_case. NO por inclusión: con
 * inclusión, `post_id` contendría `post` y `comment_id` contendría `comment`, y
 * acabaríamos redactando justo los identificadores que hacen falta para
 * depurar. Y al revés, `body_length` NO se redacta —la longitud es un número,
 * no contenido—, que es exactamente lo que este módulo recomienda registrar en
 * lugar del texto.
 */
const REDACTED_KEYS: readonly string[] = [
  'body', 'content', 'text', 'excerpt', 'snippet', 'bio',
  'email', 'phone', 'telefono', 'contact', 'contact_hash',
  'password', 'token', 'access_token', 'refresh_token', 'apikey', 'api_key',
  'authorization', 'cookie', 'secret', 'service_role', 'jwt', 'session',
  'ip', 'ip_address', 'user_agent',
] as const

/** Valores primitivos admitidos en el contexto de un log. */
export type LogValue = string | number | boolean | null | undefined | LogValue[] | { [k: string]: LogValue }

export type LogContext = Record<string, LogValue>

/** Máxima profundidad al recorrer el contexto. Una estructura cíclica o muy
 *  anidada (una fila de Supabase con relaciones) colgaría el serializador. */
const MAX_DEPTH = 4

/** Máxima longitud de un string en el contexto. Un log de 200 KB es un log que
 *  nadie lee y que el proveedor trunca por su cuenta y de peor manera. */
const MAX_STRING = 500

function sanitizeValue(value: LogValue, depth: number): LogValue {
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const redacted = redactPii(value)
    return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…[+${redacted.length - MAX_STRING}]` : redacted
  }

  if (depth >= MAX_DEPTH) return '[profundidad máxima]'

  if (Array.isArray(value)) {
    // 20 elementos bastan para depurar; el resto solo infla el log.
    return value.slice(0, 20).map((v) => sanitizeValue(v, depth + 1))
  }

  const out: Record<string, LogValue> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = isRedactedKey(k) ? '[redactado]' : sanitizeValue(v, depth + 1)
  }
  return out
}

/** `postBody` → `post_body`, para que camelCase y snake_case den lo mismo. */
function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function isRedactedKey(key: string): boolean {
  const k = toSnake(key)
  return REDACTED_KEYS.some((r) => k === r || k.endsWith(`_${r}`))
}

/** Sanea un contexto completo. PURA — exportada para poder testearla. */
export function sanitizeContext(context: LogContext): LogContext {
  const out: LogContext = {}
  for (const [k, v] of Object.entries(context)) {
    out[k] = isRedactedKey(k) ? '[redactado]' : sanitizeValue(v, 1)
  }
  return out
}

export interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  [key: string]: LogValue
}

/** Construye la entrada ya saneada. PURA: el test la usa sin capturar stdout. */
export function buildEntry(level: LogLevel, msg: string, context: LogContext = {}): LogEntry {
  return {
    ts: new Date().toISOString(),
    level,
    // El mensaje también se redacta: es el sitio por el que más veces se cuela
    // un valor interpolado (`Error al guardar ${body}`).
    msg: redactPii(msg),
    ...sanitizeContext(context),
  }
}

function emit(level: LogLevel, msg: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return

  const line = JSON.stringify(buildEntry(level, msg, context))
  // warn/error a stderr: es lo que separa las alertas del ruido en la mayoría
  // de recolectores, sin necesidad de configurar nada.
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const logger = {
  debug: (msg: string, context?: LogContext): void => emit('debug', msg, context),
  info: (msg: string, context?: LogContext): void => emit('info', msg, context),
  warn: (msg: string, context?: LogContext): void => emit('warn', msg, context),
  error: (msg: string, context?: LogContext): void => emit('error', msg, context),

  /**
   * Registra un error capturado sin filtrar el stack al cliente (eso lo
   * garantiza lib/apiErrors.ts; aquí solo se registra).
   *
   * El `stack` se incluye SOLO fuera de producción: en producción los stacks
   * revelan rutas del sistema de archivos y estructura interna, y quien depura
   * en producción tiene acceso al código fuente de todas formas.
   */
  exception: (msg: string, error: unknown, context?: LogContext): void => {
    const err = error instanceof Error ? error : new Error(String(error))
    emit('error', msg, {
      ...context,
      error_name: err.name,
      error_message: err.message,
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: err.stack ?? null }),
    })
  },
} as const

/**
 * Log de un evento de crisis. Se separa del resto porque tiene reglas propias:
 * se registra QUE ocurrió y con qué patrones, NUNCA el texto. Los ids de patrón
 * (`es_ideation`, `en_method`) permiten medir la calidad del triaje sin que
 * nadie tenga que leer lo que escribió una persona en su peor momento.
 */
export function logCrisisEvent(input: {
  postId?: string
  commentId?: string
  userId: string
  riskLevel: string
  signalIds: string[]
}): void {
  logger.warn('crisis_detectada', {
    post_id: input.postId ?? null,
    comment_id: input.commentId ?? null,
    // El user id sí se registra: la cola de revisión humana necesita saber a
    // quién acompañar. Es un uuid, no una identidad — el vínculo con la persona
    // real solo existe en identity_vault.
    user_id: input.userId,
    risk_level: input.riskLevel,
    signal_ids: input.signalIds,
  })
}
