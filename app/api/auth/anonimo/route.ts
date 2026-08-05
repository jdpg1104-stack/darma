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
// identificativo —es un booleano— y no se guarda la edad de nadie: lo que se
// registra tras crear el usuario es el consentimiento `edad_minima` con la
// versión del texto vigente (`/legal/menores`), vía el sistema de
// consentimientos de 0201. Ver `EDAD_MINIMA` en lib/privacy/avisos.ts.
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
import { anotarConsentimiento } from '@/lib/privacy/consentimientos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface DatosAltaAnonima {
  userId: string
  necesitaOnboarding: true
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    // Cliente ADMIN solo para la capa 2 del rate limit y para registrar el
    // consentimiento: tanto `check_rate_limit()` como
    // `registrar_consentimiento()` están concedidas únicamente a service_role
    // (0002 y 0201). Con el cliente RLS la RPC falla, la capa hace fail-open y
    // el límite desaparece sin que nada se queje.
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

    // La declaración NO se guarda como edad ni como fecha (no hay nada que
    // guardar: es un booleano). Lo que sí queda es el consentimiento
    // `edad_minima` versionado contra el texto de /legal/menores, que es lo que
    // el art. 7.1 RGPD obliga a poder demostrar. Si el registro falla, el alta
    // falla: manejarRuta lo convierte en error_interno y la persona reintenta.
    // Idempotente por (user_id, kind, version), así que el onboarding puede
    // volver a registrarlo sin duplicar nada.
    await anotarConsentimiento(admin, data.user.id, 'edad_minima')

    return sobreOk<DatosAltaAnonima>({
      userId: data.user.id,
      necesitaOnboarding: true,
    })
  })
}
