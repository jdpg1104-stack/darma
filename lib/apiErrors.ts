// ============================================================================
// Errores de API — lo que ve el cliente vs. lo que se registra
//
// REGLA ÚNICA DE ESTE MÓDULO: el cliente recibe un CÓDIGO estable y un mensaje
// escrito por nosotros. Jamás un mensaje de Postgres, ni un stack, ni el
// `error.message` de la librería de turno. El detalle interno se registra
// entero (lib/logger.ts) y se le adjunta un `traceId` que también viaja al
// cliente, para que soporte pueda cruzar "me ha salido el error a3f9c1" con la
// línea exacta del log.
//
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE:
//   · Un mensaje de Postgres filtra nombres de tablas, de columnas y de
//     restricciones. `duplicate key value violates unique constraint
//     "uq_comments_one_listen_per_post"` le cuenta a un atacante el esquema, la
//     mecánica antifarmeo y el nombre del índice, gratis.
//   · Los mensajes de error son también producto: quien recibe "reciprocidad:
//     necesitas escuchar a 3 personas" en crudo está leyendo una excepción de
//     plpgsql escrita para un desarrollador. La versión de cara a la persona
//     está en lib/reciprocity.ts y tiene otro tono a propósito.
//
// ALTERNATIVA DESCARTADA: devolver el mensaje interno solo cuando
// NODE_ENV !== 'production'. Suena inofensivo y es la fuga clásica: preview y
// staging corren con datos parecidos a los de producción y son públicos. Si el
// detalle nunca sale, no hay entorno en el que se pueda escapar.
// ============================================================================

import { NextResponse } from 'next/server'
import { logger } from './logger.ts'
import { randomUUID } from 'node:crypto'

/**
 * Códigos de error. Son CONTRATO: el cliente hace switch sobre ellos, así que
 * renombrar uno rompe la app aunque el mensaje siga igual.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation_failed'
  | 'pii_detected'
  | 'reciprocity_required'
  | 'insufficient_karma'
  | 'comment_rejected'
  | 'crisis_intervention'
  | 'conflict'
  | 'internal'

interface ErrorSpec {
  status: number
  /** Mensaje de cara a la persona. Español, sin jerga, sin culpar. */
  message: string
}

const ERRORS: Readonly<Record<ApiErrorCode, ErrorSpec>> = {
  unauthorized: { status: 401, message: 'Necesitas iniciar sesión para hacer esto.' },
  forbidden: { status: 403, message: 'No puedes hacer esto.' },
  not_found: { status: 404, message: 'No hemos encontrado lo que buscas.' },
  rate_limited: { status: 429, message: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' },
  validation_failed: { status: 400, message: 'Hay algo en lo que has enviado que no podemos procesar.' },
  pii_detected: { status: 400, message: 'Has incluido datos de contacto. En Darma no se comparten: quítalos y vuelve a intentarlo.' },
  reciprocity_required: { status: 403, message: 'Te falta acompañar a alguien más antes de publicar. Tu texto no se ha perdido.' },
  insufficient_karma: { status: 402, message: 'No tienes suficiente karma gastable para esto todavía.' },
  comment_rejected: { status: 400, message: 'Tu comentario necesita algo más para contar como escucha.' },
  crisis_intervention: { status: 200, message: 'Antes de continuar, queremos enseñarte algo.' },
  conflict: { status: 409, message: 'Esto ya estaba hecho.' },
  // 'internal' NUNCA lleva detalle. Es el destino de todo lo inesperado.
  internal: { status: 500, message: 'Algo ha fallado por nuestra parte. Ya lo estamos mirando.' },
}

/** Cuerpo JSON que ve el cliente. No hay más campos, y no debe haberlos. */
export interface ApiErrorBody {
  error: ApiErrorCode
  message: string
  /** Para soporte: cruza esta respuesta con la línea del log. */
  traceId: string
  /** Datos ESTRUCTURADOS y seguros que la UI necesita para reaccionar
   *  (cuántas escuchas faltan, cuánto karma falta, segundos de espera).
   *  Nunca texto de error interno. */
  details?: Record<string, string | number | boolean | string[]>
}

/**
 * Respuesta de error. Registra el detalle interno y devuelve solo lo público.
 *
 * @param code   código del contrato.
 * @param cause  el error real (Error, error de Supabase, lo que sea). Se
 *               registra, no se devuelve.
 * @param opts.details    datos seguros para la UI.
 * @param opts.logContext contexto extra para el log (ids, ruta, acción).
 */
export function apiError(
  code: ApiErrorCode,
  cause?: unknown,
  opts: {
    details?: ApiErrorBody['details']
    logContext?: Record<string, string | number | boolean | null>
    headers?: Record<string, string>
  } = {},
): NextResponse<ApiErrorBody> {
  const spec = ERRORS[code]
  const traceId = randomUUID()

  // Los 5xx y los errores con causa se registran como error; los 4xx esperados
  // (validación, rate limit) como info: son el funcionamiento normal del
  // sistema y llenar el canal de errores con ellos hace que nadie mire el canal.
  const level = spec.status >= 500 || (cause && spec.status !== 429) ? 'error' : 'info'

  if (level === 'error') {
    logger.exception(`api_error:${code}`, cause ?? new Error(code), {
      trace_id: traceId,
      status: spec.status,
      ...opts.logContext,
    })
  } else {
    logger.info(`api_error:${code}`, { trace_id: traceId, status: spec.status, ...opts.logContext })
  }

  const body: ApiErrorBody = { error: code, message: spec.message, traceId }
  if (opts.details) body.details = opts.details

  return NextResponse.json(body, { status: spec.status, headers: opts.headers })
}

/**
 * Atajo para el 429: añade la cabecera Retry-After, que es lo que hace que un
 * cliente bien escrito espere en vez de reintentar en bucle.
 */
export function rateLimitedResponse(retryAfterSeconds: number, logContext?: Record<string, string | number>): NextResponse<ApiErrorBody> {
  return apiError('rate_limited', undefined, {
    details: { retryAfter: retryAfterSeconds },
    logContext,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  })
}

/**
 * Envuelve el cuerpo de un route handler y convierte CUALQUIER excepción no
 * controlada en un 500 genérico ya registrado.
 *
 * Sin esto, una excepción se propaga al runtime de Next, que en algunas
 * configuraciones serializa el mensaje del error en la respuesta. Este wrapper
 * garantiza que ningún camino de error se salte la redacción.
 */
export async function withApiErrorHandling<T>(
  handler: () => Promise<NextResponse<T>>,
  logContext?: Record<string, string | number | boolean | null>,
): Promise<NextResponse<T | ApiErrorBody>> {
  try {
    return await handler()
  } catch (cause) {
    return apiError('internal', cause, { logContext })
  }
}

/**
 * Traduce un error de Postgres al código público correspondiente.
 *
 * Es el único punto donde se INSPECCIONA un mensaje de la base de datos, y ese
 * mensaje no sale de aquí: entra un error de plpgsql, sale un enum. Se compara
 * contra los textos que lanzan nuestras propias funciones en 0001_core.sql; si
 * ninguno casa, `internal` (nunca "lo que dijera Postgres").
 */
export function codeFromPostgresError(cause: unknown): ApiErrorCode {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')

  if (message.includes('reciprocidad:')) return 'reciprocity_required'
  if (message.includes('duplicate key value')) return 'conflict'
  if (message.includes('violates row-level security')) return 'forbidden'
  if (message.includes('karma kind desconocido')) return 'validation_failed'
  if (message.includes('importe inválido')) return 'validation_failed'

  return 'internal'
}
