// ============================================================================
// POST /api/auth/2fa/confirmar — validar el primer código y activar el 2FA
//
// Hasta que este paso no pasa, el segundo factor NO está activo. Un secreto
// guardado pero sin confirmar no bloquea nada: si bloqueara, un fallo al
// escanear el QR dejaría a la persona fuera de su propia cuenta, y recuperarla
// exigiría precisamente la vía que el 2FA acaba de cerrar.
//
// Al confirmar se emiten 10 códigos de recuperación, se devuelven UNA sola vez
// y se guardan hasheados con scrypt. No hay forma de volver a verlos: si se
// pierden, se regeneran, y regenerar invalida los anteriores.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { exigirPerfil, getContextoSesion } from '@/lib/auth/session'
import { leerJson, validarCodigoTotp } from '@/lib/auth/validacion'
import {
  descifrarSecretoTotp,
  generarCodigosRecuperacion,
  hashCodigoRecuperacion,
  verificarTotp,
} from '@/lib/auth/totp'
import { confirmarTotp, leerRegistroTotp } from '@/lib/auth/almacenTotp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const contexto = await getContextoSesion()
    if (!contexto) throw new ErrorApi('no_autenticado')
    const sesion = exigirPerfil(contexto.sesion)

    const admin = createAdminClient()
    // failClosed: si Postgres no responde, aquí NO se deja pasar. Es la
    // excepción a la política general de fail-open de lib/rateLimit.ts, porque
    // sin límite esto es un espacio de un millón que se recorre en minutos.
    await limitar('verificarSegundoFactor', sesion.userId, { supabase: admin, failClosed: true })

    const cuerpo = (await leerJson(request)) as Record<string, unknown> | null
    const codigo = validarCodigoTotp(cuerpo?.codigo)

    const registro = await leerRegistroTotp(sesion.userId)
    if (!registro) {
      throw new ErrorApi('no_encontrado', {
        mensaje: 'No hay ninguna configuración de segundo factor a medias.',
      })
    }
    if (registro.confirmadoEn) {
      throw new ErrorApi('sin_permiso', { mensaje: 'Tu segundo factor ya estaba activo.' })
    }

    if (!verificarTotp(descifrarSecretoTotp(registro.secretoCifrado), codigo)) {
      // Mismo mensaje que en /verificar y sin decir si el fallo fue de ventana
      // o de dígitos: cualquier matiz aquí es información para quien prueba.
      throw new ErrorApi('entrada_invalida', { mensaje: 'Ese código no es válido. Prueba con el siguiente.' })
    }

    const codigosRecuperacion = generarCodigosRecuperacion()
    await confirmarTotp(sesion.userId, codigosRecuperacion.map((c) => hashCodigoRecuperacion(c)))

    return sobreOk({
      activo: true as const,
      // Se enseñan una vez. La UI debe dejar claro que no se vuelven a mostrar.
      codigosRecuperacion,
    })
  })
}
