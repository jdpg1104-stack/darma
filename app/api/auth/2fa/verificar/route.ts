// ============================================================================
// POST /api/auth/2fa/verificar — comprobar un código en el acceso
//
// Acepta un código TOTP de 6 dígitos o uno de los códigos de recuperación. El
// de recuperación se CONSUME: se recalcula la lista sin él y se persiste en la
// misma petición. Verificar sin guardar convertiría diez códigos de un solo uso
// en diez llaves permanentes, que es el fallo clásico de esta función.
//
// La respuesta no distingue "código incorrecto" de "código caducado" ni de "ese
// código de recuperación ya se usó": los tres son el mismo mensaje. Cualquier
// matiz es información para quien está probando combinaciones.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { requireSesion } from '@/lib/auth/session'
import { leerJson } from '@/lib/auth/validacion'
import { consumirCodigoRecuperacion, descifrarSecretoTotp, verificarTotp } from '@/lib/auth/totp'
import { guardarHashesRecuperacion, leerRegistroTotp } from '@/lib/auth/almacenTotp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MENSAJE_FALLO = 'Ese código no es válido. Prueba con el siguiente.'

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    const admin = createAdminClient()
    await limitar('verificarSegundoFactor', sesion.userId, { supabase: admin, failClosed: true })

    const cuerpo = (await leerJson(request)) as Record<string, unknown> | null
    const codigoCrudo = typeof cuerpo?.codigo === 'string' ? cuerpo.codigo : ''
    if (codigoCrudo.trim().length === 0) {
      throw new ErrorApi('entrada_invalida', { mensaje: MENSAJE_FALLO })
    }

    const registro = await leerRegistroTotp(sesion.userId)
    if (!registro?.confirmadoEn) {
      throw new ErrorApi('no_encontrado', { mensaje: 'No tienes segundo factor activo.' })
    }

    // Primero el TOTP, que es el camino normal y no gasta nada.
    if (verificarTotp(descifrarSecretoTotp(registro.secretoCifrado), codigoCrudo)) {
      return sobreOk({ verificado: true as const, usoCodigoRecuperacion: false })
    }

    const resultado = consumirCodigoRecuperacion(registro.hashesRecuperacion, codigoCrudo)
    if (!resultado.ok) {
      throw new ErrorApi('entrada_invalida', { mensaje: MENSAJE_FALLO })
    }

    // Se persiste ANTES de responder: si se respondiera primero y el guardado
    // fallara, el código seguiría siendo válido para siempre.
    await guardarHashesRecuperacion(sesion.userId, resultado.restantes)

    return sobreOk({
      verificado: true as const,
      usoCodigoRecuperacion: true,
      // Para poder avisar "te quedan 2". Es un número, no una lista.
      codigosRestantes: resultado.restantes.length,
    })
  })
}
