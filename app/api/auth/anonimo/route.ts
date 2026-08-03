// ============================================================================
// POST /api/auth/anonimo — entrar sin dar absolutamente nada
//
// Es la primera pantalla real de Darma y la razón por la que mucha gente llega
// a escribir algo: no hay formulario, no hay email, no hay contraseña. Supabase
// emite un usuario anónimo y una cookie de sesión, y ya está.
//
// NO SE CREA EL PERFIL AQUÍ. La fila de `profiles` nace al terminar el
// onboarding, con el alias que la persona haya elegido. Crearla antes con un
// alias provisional llenaría la tabla —y el índice UNIQUE de alias, y el
// ranking— de cuentas de gente que abrió la app, miró y se fue.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { hashIp } from '@/lib/auth/identidad'
import { ipDePeticion } from '@/lib/auth/peticion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface DatosAltaAnonima {
  userId: string
  necesitaOnboarding: true
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    // Cliente ADMIN solo para la capa 2 del rate limit: `check_rate_limit()`
    // está concedida únicamente a service_role (final de 0002_comunidad.sql).
    // Con el cliente RLS la RPC falla, la capa hace fail-open y el límite
    // desaparece sin que nada se queje.
    const admin = createAdminClient()

    // Por IP y no por usuario: aquí todavía no hay usuario. Es la barrera
    // anti-multicuenta del lado de la app; la otra es el contact_hash.
    await limitar('altaAnonima', hashIp(ipDePeticion(request)), { supabase: admin })

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInAnonymously()

    if (error || !data.user) {
      throw new ErrorApi('error_interno', { causa: error })
    }

    return sobreOk<DatosAltaAnonima>({
      userId: data.user.id,
      necesitaOnboarding: true,
    })
  })
}
