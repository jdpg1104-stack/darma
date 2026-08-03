// ============================================================================
// POST /api/auth/salir — cerrar sesión
//
// POST y no GET a propósito: un GET que cierra sesión se dispara con un `<img
// src>` en cualquier página, y aunque el daño sea menor (echar a alguien de su
// sesión) es un CSRF de manual. Con POST, la cookie `SameSite=Lax` que pone
// @supabase/ssr no viaja en una petición de otro origen.
//
// La cookie la borra el propio cliente de Supabase a través de `setAll`; no se
// toca a mano. Reescribirla aquí es como se acaba bajando el `sameSite` sin
// darse cuenta.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return manejarRuta(async () => {
    const supabase = await createClient()

    // Un fallo al cerrar sesión no se convierte en error: si el token ya estaba
    // caducado, `signOut` devuelve error y la persona ya está fuera. Decirle
    // "no hemos podido cerrar tu sesión" sería mentira y daría miedo.
    await supabase.auth.signOut()

    return sobreOk({ cerrado: true as const })
  })
}
