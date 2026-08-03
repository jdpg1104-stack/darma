// ============================================================================
// POST /api/push/unsubscribe — retirar un dispositivo
//
// ── EL BORRADO VA ACOTADO POR `user_id`, AUNQUE EL ENDPOINT SEA ÚNICO ─────
// Un endpoint identifica una fila por sí solo, así que `delete where endpoint`
// bastaría… y sería un borrador universal: quien conociera (o adivinara, o
// interceptara) el endpoint de otra persona podría dejarla sin avisos, incluido
// el de un Alma Afín en crisis. Denegar el servicio a alguien vulnerable es un
// ataque real y barato. El `eq('user_id', ...)` de abajo lo cierra.
//
// Se responde `{ suscrito: false }` tanto si había fila como si no. Distinguir
// los dos casos convertiría esta ruta en un oráculo de «¿existe este endpoint
// en Darma?».
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requireSesion } from '@/lib/auth/session'

import { limitarPush } from '../limites.ts'
import { esquemaDesuscribir, leerJson, validar } from '../validacion.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    const admin = createAdminClient()
    await limitarPush('desuscribir', sesion.userId, admin)

    const entrada = validar(esquemaDesuscribir, await leerJson(request))

    // Admin y no el cliente RLS por una razón concreta: `authenticated` no
    // tiene privilegio de SELECT sobre `endpoint` (migración 0131 — es una
    // capability URL), así que un `delete ... where endpoint = ...` con el
    // cliente de sesión moriría con 42501. La acotación por `user_id` de aquí
    // hace el mismo trabajo que haría RLS.
    const { error } = await admin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', entrada.endpoint)
      .eq('user_id', sesion.userId)

    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk<{ suscrito: false }>({ suscrito: false })
  })
}
