// ============================================================================
// POST /api/auth/2fa/iniciar — generar el secreto del segundo factor
//
// ── SOLO PARA MENTORES ─────────────────────────────────────────────────────
// Un mentor ve contenido en crisis de otras personas. Su cuenta no vale lo que
// vale una cuenta: vale lo que valen las conversaciones a las que da acceso. Si
// se la roban, el daño no es suyo. Por eso el segundo factor se ofrece a partir
// de `profiles.level = 'mentor'` y no antes — para todos los demás, añadir una
// barrera de acceso a una app de apoyo emocional es un coste sin contrapartida.
//
// El nivel se lee de `profiles.level`, que es una COLUMNA GENERADA a partir de
// karma_reputation: no se puede falsear ni desincronizar.
//
// El secreto se devuelve UNA vez, en claro, porque hay que pintarlo en el QR.
// A partir de ahí solo existe cifrado (AES-256-GCM) en `auth_totp`.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { exigirPerfil, getContextoSesion } from '@/lib/auth/session'
import { cifrarSecretoTotp, generarSecretoTotp, uriOtpauth } from '@/lib/auth/totp'
import { guardarSecretoTotp, leerRegistroTotp } from '@/lib/auth/almacenTotp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return manejarRuta(async () => {
    const contexto = await getContextoSesion()
    if (!contexto) throw new ErrorApi('no_autenticado')
    const sesion = exigirPerfil(contexto.sesion)

    if (sesion.nivel !== 'mentor') {
      throw new ErrorApi('sin_permiso', {
        mensaje: 'El segundo factor está disponible a partir del nivel mentor.',
      })
    }

    const admin = createAdminClient()
    await limitar('segundoFactor', sesion.userId, { supabase: admin, failClosed: true })

    // Volver a iniciar cuando ya está confirmado exigiría desactivarlo primero:
    // si no, quien tenga la sesión abierta un minuto puede sustituir el segundo
    // factor por el suyo, que es justo el ataque del que protege.
    const existente = await leerRegistroTotp(sesion.userId)
    if (existente?.confirmadoEn) {
      throw new ErrorApi('sin_permiso', {
        mensaje: 'Ya tienes el segundo factor activo. Desactívalo antes de configurar otro.',
      })
    }

    const secreto = generarSecretoTotp()
    await guardarSecretoTotp(sesion.userId, cifrarSecretoTotp(secreto))

    return sobreOk({
      secreto,
      // El URI lleva el ALIAS, nunca el email: el QR acaba en capturas de
      // pantalla y en gestores de contraseñas.
      uri: uriOtpauth(sesion.alias, secreto),
    })
  })
}
