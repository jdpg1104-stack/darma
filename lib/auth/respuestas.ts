// ============================================================================
// Forma de las respuestas de API (CONTRATOS §4) — parte PURA.
//
// Este archivo no importa `next/server` a propósito: así se puede cargar desde
// `node --test` sin arrastrar el runtime de Next. Los envoltorios que sí
// construyen un `NextResponse` viven en `http.ts`, que es lo que importan las
// rutas. La frontera está aquí para que las pruebas de "¿el cuerpo y el status
// son idénticos en los dos caminos?" (magic link) sean pruebas de verdad y no
// una comparación de dos objetos de Next.
// ============================================================================

import { ErrorApi, esErrorApi, type CodigoError } from './errores.ts'

export interface RespuestaOk<T> {
  ok: true
  data: T
}

export interface RespuestaError {
  ok: false
  code: CodigoError
  message: string
  retryAfter?: number
}

export type Respuesta<T> = RespuestaOk<T> | RespuestaError

/** Sobre público completo: cuerpo + status. Lo que se pasa a `NextResponse`. */
export interface Sobre<T> {
  status: number
  cuerpo: Respuesta<T>
}

export function sobreOk<T>(data: T, status = 200): Sobre<T> {
  return { status, cuerpo: { ok: true, data } }
}

/**
 * Convierte cualquier excepción en un sobre público.
 *
 * Lo que NO es un `ErrorApi` se convierte en `error_interno` con el mensaje
 * genérico: un error de Supabase, de zod o de la red no puede llegar al cliente
 * ni de rebote. Es la última red del sistema y por eso no tiene ninguna rama
 * "en desarrollo sí lo enseñamos" — preview y staging son públicos.
 */
export function sobreDeError(causa: unknown): Sobre<never> {
  const error = esErrorApi(causa) ? causa : new ErrorApi('error_interno', { causa })

  const cuerpo: RespuestaError = {
    ok: false,
    code: error.code,
    message: error.message,
  }
  if (error.retryAfter !== undefined) cuerpo.retryAfter = error.retryAfter

  return { status: error.status, cuerpo }
}
