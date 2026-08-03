// ============================================================================
// Límites de B04
//
// Se apoyan en `lib/rateLimit.ts` (dueño F3), que ya implementa las dos capas
// —memoria por instancia y `check_rate_limit()` en Postgres—. Aquí solo se
// fijan los números de este bloque y se convierte el «no» en un `ErrorApi`:
// devolver un booleano deja la puerta abierta a un `if` olvidado; lanzar no.
//
// ── POR QUÉ NO SE USA `RATE_LIMITS.createComment` DE lib/rateLimit.ts ──────
// Aquel preset dice 30/h y la ficha de B04 fija 20/h. No es un descuido de
// ninguno de los dos: 30/h se calibró como «velocidad de bot» en abstracto, y
// 20/h es el número de este bloque porque aquí cada comentario dispara una
// validación síncrona y, si pasa, un movimiento de karma. Un solo sitio manda,
// y para las rutas de `/api/comments` es este archivo. Anotado en PEDIDOS.md
// para que B00 decida si unifica.
//
// ── POR QUÉ EL CLIENTE ADMIN, Y POR QUÉ NO CUENTA COMO UNA DE LAS TRES ─────
// `check_rate_limit()` está concedida SOLO a `service_role` (final de 0002).
// Con el cliente RLS la RPC falla, la capa 2 hace fail-open y el límite real
// desaparece sin que nada se queje. Pero esto no es una de las tres escrituras
// con admin que la ficha enumera: no escribe en ninguna tabla de dominio, solo
// incrementa un contador de `rate_limits`. Las tres escrituras de dominio con
// admin siguen siendo `is_validated`/`quality_score`, `is_helpful` y
// `crisis_events`/`moderation_flags`.
//
// ── FAIL-CLOSED ────────────────────────────────────────────────────────────
// `failClosed: true` en las tres. `lib/rateLimit.ts` documenta que su valor por
// defecto es fail-open para no cerrarle la puerta a quien necesita publicar que
// está mal — y añade la excepción: «las rutas de dinero/karma deben pasar
// failClosed: true». Comentar mueve karma y créditos de reciprocidad; son
// exactamente esas rutas.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rateLimit'
import { ErrorApi } from '@/lib/auth/errores'

export const LIMITES_HILO = {
  /** Comentar. Escuchar mucho es bueno; 20/h ya no es una persona leyendo. */
  comment: { limite: 20, ventanaSegundos: 3600 },
  /** «Me ayudó». Solo lo puede pulsar el autor del post y solo una vez por
   *  post, así que 30/h ya implica 30 posts propios abiertos a la vez. */
  util: { limite: 30, ventanaSegundos: 3600 },
  /** Editar. Bajo: corregir una errata son dos o tres intentos, no diez. */
  editar: { limite: 10, ventanaSegundos: 3600 },
} as const

export type AccionHilo = keyof typeof LIMITES_HILO

/** Aplica un límite y lanza `demasiadas_peticiones` si se ha superado. */
export async function limitarHilo(
  accion: AccionHilo,
  userId: string,
  admin: SupabaseClient,
): Promise<void> {
  const preset = LIMITES_HILO[accion]

  const resultado = await rateLimit({
    key: `${accion}:${userId}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: admin,
    failClosed: true,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
