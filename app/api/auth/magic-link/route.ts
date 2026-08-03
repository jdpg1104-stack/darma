// ============================================================================
// POST /api/auth/magic-link — recuperar la cuenta sin que el email toque nada
//
// El correo entra, se usa para pedirle a Supabase Auth que envíe el enlace, y
// se descarta. No se guarda en `profiles`, ni en `identity_vault` (ahí va su
// HASH, y lo escribe el callback), ni en un log.
//
// La respuesta es SIEMPRE la misma exista o no la cuenta. El porqué está
// explicado entero en lib/auth/magicLink.ts, y es la decisión más importante de
// esta ruta.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { limitar } from '@/lib/auth/limites'
import { leerJson, validarEmail } from '@/lib/auth/validacion'
import { hashContacto, hashIp } from '@/lib/auth/identidad'
import { ipDePeticion, urlDelSitio } from '@/lib/auth/peticion'
import { procesarMagicLink } from '@/lib/auth/magicLink'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const cuerpo = await leerJson(request)
    const email = validarEmail((cuerpo as { email?: unknown } | null)?.email)

    const admin = createAdminClient()

    // Dos límites, y hacen falta los dos:
    //  · por contacto: impide usar Darma para bombardear el buzón de alguien.
    //  · por IP: cubre el ataque que el anterior no ve, muchas direcciones
    //    distintas desde el mismo origen (sondeo de quién está en la red).
    // La clave es siempre un hash: se persiste en `rate_limits`, y ahí no puede
    // haber ni un email ni una IP.
    await limitar('magicLinkContacto', hashContacto(email), { supabase: admin })
    await limitar('magicLinkIp', hashIp(ipDePeticion(request)), { supabase: admin })

    const supabase = await createClient()
    const destino = `${urlDelSitio(request)}/api/auth/callback`

    // Hay dos situaciones distintas detrás del mismo botón, y la que aplica
    // depende de la sesión de QUIEN PIDE, nunca de si el correo tiene cuenta —
    // así la ramificación no reintroduce el oráculo que la respuesta constante
    // acaba de cerrar:
    //
    //  · CON sesión anónima y sin correo asociado → VINCULAR. `updateUser` ata
    //    ese email a la cuenta que la persona ya está usando, así que al volver
    //    desde el enlace sigue siendo la MISMA cuenta, con su alias y su karma.
    //    Es lo que hace que "he perdido el móvil" tenga solución.
    //  · SIN sesión → RECUPERAR. `signInWithOtp` con `shouldCreateUser: false`:
    //    desde aquí no se crean cuentas. Si las creara, cualquiera podría
    //    provocar el alta de un correo ajeno y ese buzón recibiría un mensaje
    //    de una app de salud mental que nadie pidió.
    const { data: usuarioActual } = await supabase.auth.getUser()
    const puedeVincular = Boolean(usuarioActual.user && !usuarioActual.user.email)

    return procesarMagicLink({
      email,
      enviar: async (correo) => {
        if (puedeVincular) {
          const { error } = await supabase.auth.updateUser(
            { email: correo },
            { emailRedirectTo: destino },
          )
          if (error) throw error
          return
        }

        const { error } = await supabase.auth.signInWithOtp({
          email: correo,
          options: { emailRedirectTo: destino, shouldCreateUser: false },
        })
        if (error) throw error
      },
    })
  })
}
