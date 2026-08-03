// ============================================================================
// B07 · Límites de las rutas de /api/content/*.
//
// Se apoya en `lib/rateLimit.ts` (dueño F3), que ya implementa las dos capas.
// Aquí solo se hacen las dos cosas que aquel módulo no puede hacer: convertir
// el «no» en un `ErrorApi` que no se puede olvidar, y fijar los números de este
// bloque en un sitio donde se puedan leer juntos.
//
// No se reutiliza `lib/auth/limites.ts` porque su tabla de presets es de B01 y
// añadirle claves sería editar un archivo ajeno (README: cada archivo tiene un
// dueño). Lo que sí se comparte es el motor.
//
// ⚠️ `check_rate_limit()` (la capa 2, la que de verdad limita en serverless)
// está concedida SOLO a `service_role`. Por eso hay que pasarle el cliente
// ADMIN: con el de RLS la RPC falla, la capa 2 hace fail-open y el límite real
// desaparece sin que nada se queje.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '../rateLimit.ts'
import { ErrorApi } from '../auth/errores.ts'

/**
 * Límites del feed vertical, calibrados sobre lo que hace una persona viendo
 * vídeos, no sobre lo que aguanta el servidor.
 */
export const LIMITES_VIDEO = {
  /** Leer el feed. Una página cada scroll largo; 60/min es holgado. */
  feed: { limite: 60, ventanaSegundos: 60 },
  /** Abrir sesión de reproducción. Una por vídeo que se mira de verdad. */
  sesion: { limite: 30, ventanaSegundos: 60 },
  /**
   * Latido. La clave incluye el CONTENIDO además del usuario: el cliente late
   * cada 5 s, es decir 12/min por vídeo. Veinte deja margen para reintentos y
   * para el latido extra al volver de segundo plano; por encima de eso no es
   * una persona viendo un vídeo, es un bucle.
   */
  latido: { limite: 20, ventanaSegundos: 60 },
  /** Completado. Uno por vídeo terminado. */
  completado: { limite: 30, ventanaSegundos: 60 },
} as const

export type AccionVideo = keyof typeof LIMITES_VIDEO

/**
 * Aplica un límite y lanza `demasiadas_peticiones` si se ha superado.
 *
 * @param sujeto  SIEMPRE derivado de `sesion.userId` (CONTRATOS §6), nunca de
 *                la IP sola: en móvil una IP puede ser un operador entero y
 *                limitar por ella castiga a miles de personas por una.
 * @param failClosed  `true` en lo que otorga karma: ante una caída de Postgres,
 *                    en una ruta que paga, la respuesta correcta es «ahora no».
 */
export async function limitarVideo(
  accion: AccionVideo,
  sujeto: string,
  opciones: { supabase?: SupabaseClient; failClosed?: boolean } = {},
): Promise<void> {
  const preset = LIMITES_VIDEO[accion]

  const resultado = await rateLimit({
    key: `${accion}:${sujeto}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: opciones.supabase,
    failClosed: opciones.failClosed,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
