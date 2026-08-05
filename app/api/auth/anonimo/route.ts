// ============================================================================
// POST /api/auth/anonimo — entrar sin dar ningún dato que identifique
//
// Es la primera pantalla real de Darma y la razón por la que mucha gente llega
// a escribir algo: no hay formulario, no hay email, no hay contraseña. Supabase
// emite un usuario anónimo y una cookie de sesión, y ya está.
//
// LO ÚNICO QUE SE PIDE es la declaración de edad mínima («tengo 16 años o
// más»), obligatoria y validada aquí además de en la casilla del cliente: un
// cliente que no la envíe recibe 422 y NO se crea el usuario. No es un dato
// identificativo —es un booleano— y no se guarda la edad de nadie. El
// consentimiento `edad_minima` NO puede registrarse aquí: `consents.user_id`
// tiene FK contra `profiles(id)` y el perfil todavía no existe (nace en el
// onboarding). Se registra en POST /api/auth/perfil, junto al nacimiento de la
// fila — y nadie llega ahí sin haber pasado por este 422 antes.
// Ver `EDAD_MINIMA` en lib/privacy/avisos.ts.
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
import { validarAltaAnonima } from '@/lib/auth/validacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface DatosAltaAnonima {
  userId: string
  necesitaOnboarding: true
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    // Cliente ADMIN solo para la capa 2 del rate limit: `check_rate_limit()`
    // está concedida únicamente a service_role (0002). Con el cliente RLS la
    // RPC falla, la capa hace fail-open y el límite desaparece sin quejarse.
    const admin = createAdminClient()

    // Por IP y no por usuario: aquí todavía no hay usuario. Es la barrera
    // anti-multicuenta del lado de la app; la otra es el contact_hash.
    await limitar('altaAnonima', hashIp(ipDePeticion(request)), { supabase: admin })

    // Un cuerpo ausente o un JSON roto se tratan igual que una casilla sin
    // marcar: la petición viene de un cliente que no mostró la declaración, y
    // la respuesta útil es la misma (422 con el mensaje de edad), no un
    // «no hemos podido leer lo que has enviado» genérico.
    const cuerpo: unknown = await request.json().catch(() => null)
    validarAltaAnonima(cuerpo)

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
