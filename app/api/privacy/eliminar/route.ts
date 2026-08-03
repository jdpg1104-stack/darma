// ============================================================================
// POST   /api/privacy/eliminar — solicita el borrado y emite el token
// DELETE /api/privacy/eliminar — confirma con el token y programa la ejecución
//
// ── POR QUÉ EL POST NO BORRA NADA ──────────────────────────────────────────
// Sin la confirmación en dos pasos, un XSS o una sesión robada bastan para
// borrarle la cuenta a alguien de forma irreversible. El POST solo crea la
// solicitud y devuelve un token de un solo uso con 24 h de vida; en la base se
// guarda `sha256(token)`, nunca el token.
//
// ── POR QUÉ EL DELETE TAMPOCO BORRA NADA ───────────────────────────────────
// Confirmar arranca los 30 días de arrepentimiento y suspende la cuenta. La
// ejecución la hace el cron con `borrados_vencidos()` + `borrar_usuario()`.
// Alguien que pide borrar su cuenta a las cuatro de la madrugada en su peor
// noche merece poder cambiar de opinión al día siguiente; y el plazo sigue
// dentro del mes que fija el art. 12.3 del RGPD.
//
// El cuerpo de POST admite `{"accion":"cancelar"}` para arrepentirse. Va aquí y
// no en una ruta nueva porque el reparto de rutas de la ficha es cerrado
// (CONTRATOS §7 y la tabla de B20): inventar `/api/privacy/cancelar` sería
// crear superficie fuera del contrato.
// ============================================================================

import { z } from 'zod'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import {
  cancelarBorradoCon,
  confirmarBorradoCon,
  DIAS_ARREPENTIMIENTO,
  fechaDeEjecucion,
  HORAS_CONFIRMACION,
  solicitarBorradoCon,
} from '@/lib/privacy/borrado'
import { createAdminClient } from '@/lib/supabase/admin'

import { limitarPrivacidad, registrarMovimiento } from '../_dominio/comun'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const EsquemaPost = z
  .object({ accion: z.enum(['solicitar', 'cancelar']).default('solicitar') })
  .strict()

const EsquemaDelete = z
  .object({
    solicitudId: z.string().uuid(),
    // 32 bytes en base64url = 43 caracteres. El rango se acota igualmente para
    // que un token de un megabyte no llegue a consumir un sha256.
    token: z.string().min(20).max(256),
  })
  .strict()

/** Lee y valida el cuerpo. Un JSON roto es `entrada_invalida`, no un 500. */
async function cuerpoJson(request: Request): Promise<unknown> {
  const texto = await request.text()
  if (texto.trim() === '') return {}
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErrorApi('entrada_invalida')
  }
}

/** Las dos formas que puede devolver el POST: solicitar o cancelar. */
type RespuestaPost =
  | { cancelado: boolean }
  | {
      solicitudId: string
      token: string
      expiraEn: string
      validoDuranteHoras: number
      diasDeArrepentimiento: number
    }

export async function POST(request: Request) {
  return manejarRuta<RespuestaPost>(async () => {
    const sesion = await requirePerfil()
    const admin = createAdminClient()

    await limitarPrivacidad('eliminar', sesion.userId, admin)

    const parseado = EsquemaPost.safeParse(await cuerpoJson(request))
    if (!parseado.success) throw new ErrorApi('entrada_invalida')

    if (parseado.data.accion === 'cancelar') {
      const cancelado = await cancelarBorradoCon(admin, sesion.userId)
      registrarMovimiento('borrado_cancelado', sesion.userId, { habia_solicitud: cancelado })
      return sobreOk({ cancelado })
    }

    const { solicitudId, token, expiraEn } = await solicitarBorradoCon(admin, sesion.userId)
    registrarMovimiento('borrado_solicitado', sesion.userId, { solicitud: solicitudId })

    // El token se devuelve UNA vez y no se puede volver a pedir: en la base
    // solo vive su huella. Que viaje en el cuerpo de la respuesta y no en un
    // enlace por correo es deliberado — Darma no tiene por qué conocer un
    // correo al que escribirte, y meterlo aquí sería crear el vínculo con la
    // persona real que el resto del sistema se esfuerza en no tener.
    return sobreOk({
      solicitudId,
      token,
      expiraEn,
      validoDuranteHoras: HORAS_CONFIRMACION,
      diasDeArrepentimiento: DIAS_ARREPENTIMIENTO,
    })
  })
}

export async function DELETE(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const admin = createAdminClient()

    await limitarPrivacidad('eliminar', sesion.userId, admin)

    const parseado = EsquemaDelete.safeParse(await cuerpoJson(request))
    if (!parseado.success) throw new ErrorApi('entrada_invalida')

    const ok = await confirmarBorradoCon(
      admin,
      parseado.data.solicitudId,
      sesion.userId,
      parseado.data.token,
    )

    // Un token inválido, uno caducado y uno ya usado devuelven EXACTAMENTE lo
    // mismo. Distinguirlos le diría a quien prueba tokens contra qué muro ha
    // chocado, que es la mitad del trabajo de adivinarlo.
    if (!ok) throw new ErrorApi('entrada_invalida')

    registrarMovimiento('borrado_confirmado', sesion.userId, {
      solicitud: parseado.data.solicitudId,
    })

    return sobreOk({
      confirmado: true,
      ejecucionPrevistaEn: fechaDeEjecucion(),
      diasDeArrepentimiento: DIAS_ARREPENTIMIENTO,
      // Se repite aquí, en el momento exacto de confirmar, lo que la página de
      // privacidad explica largo: es la última pantalla antes de lo
      // irreversible y no puede ser la primera vez que alguien lo lee.
      queSeConserva:
        'Tus comentarios en los hilos de otras personas se conservan sin autor identificable: ' +
        'borrarlos le quitaría a alguien el apoyo que recibió. Todo lo que escribiste sobre ti se elimina.',
    })
  })
}
