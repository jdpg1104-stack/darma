// ============================================================================
// B13 · Límites de las rutas de push
//
// Se apoyan en `lib/rateLimit.ts` (dueño F3), que ya implementa las dos capas.
// Aquí solo se fijan los números del bloque y se convierte el «no» en un
// `ErrorApi`: devolver un booleano deja la puerta abierta a un `if` olvidado.
//
// `check_rate_limit()` está concedida SOLO a `service_role` (final de 0002), así
// que la capa 2 exige el cliente ADMIN. Con el de RLS la RPC falla, la capa 2
// hace fail-open y el límite real desaparece sin que nada se queje.
//
// FAIL-OPEN aquí, y es deliberado: si Postgres no responde, preferimos que
// alguien pueda registrar su dispositivo a que no pueda. Estas rutas no mueven
// karma ni dinero; lo peor que permite un fallo abierto es una fila de más en
// `push_subscriptions`, que la restricción única de `endpoint` ya deduplica.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rateLimit'
import { ErrorApi } from '@/lib/auth/errores'

export const LIMITES_PUSH = {
  /** Registrar un dispositivo. Se hace una vez por navegador; el resto son
   *  reintentos y re-suscripciones tras una rotación de endpoint. */
  suscribir: { limite: 10, ventanaSegundos: 3600 },
  /** Retirar un dispositivo. Mismo orden de magnitud. */
  desuscribir: { limite: 20, ventanaSegundos: 3600 },
  /** Cambiar preferencias. Una pantalla de ajustes con seis interruptores
   *  genera ráfagas legítimas: 60/h cabe sin dar problemas a nadie. */
  prefs: { limite: 60, ventanaSegundos: 3600 },
} as const

export type AccionPush = keyof typeof LIMITES_PUSH

export async function limitarPush(
  accion: AccionPush,
  userId: string,
  admin?: SupabaseClient,
): Promise<void> {
  const preset = LIMITES_PUSH[accion]

  const resultado = await rateLimit({
    key: `push_${accion}:${userId}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: admin,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
