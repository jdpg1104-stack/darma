// ============================================================================
// POST /api/billing/gift  { recipientId, giftKind, refType?, refId?, mensaje?,
//                           idempotencia? }  → { regaloId, saldo }
//
// El cliente manda el TIPO de regalo, nunca su precio: el coste sale de
// `CATALOGO_REGALOS` y el reparto de `repartir()`, con `Math.floor` en la
// comisión y el resto al neto para que `cost = fee + net` cierre siempre (lo
// verifica además `gifts_amounts` en el motor).
//
// 🔴 El regalo **no da karma** al receptor: le da cristales netos y un
// reconocimiento visible en el hilo. Si diera karma, comprar cristales
// compraría reputación por interpuesta persona.
//
// Regalo a uno mismo → `entrada_invalida`. Lo impide `gifts_no_self` en la base
// y se adelanta aquí para no gastar el viaje.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { CATALOGO_REGALOS, enviarRegalo, repartir } from '@/lib/billing/regalos'
import { esquemaRegalo, parsear } from '@/lib/billing/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `billing:gift:${sesion.userId}`,
      limit: LIMITES_PETICION.gift.limite,
      windowSeconds: LIMITES_PETICION.gift.ventanaSegundos,
      supabase,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const datos = parsear(esquemaRegalo, await leerCuerpo(request))

    // `enviar_regalo` está concedida solo a service_role y `gifts` no tiene
    // política de INSERT: cobro, fila y abono van en la misma transacción.
    const admin = createAdminClient()
    const resultado = await enviarRegalo(admin, {
      senderId: sesion.userId,
      recipientId: datos.recipientId,
      giftKind: datos.giftKind,
      refType: datos.refType ?? null,
      refId: datos.refId ?? null,
      mensaje: datos.mensaje ?? null,
      idempotencia: datos.idempotencia ?? null,
    })

    const reparto = repartir(CATALOGO_REGALOS[datos.giftKind].costeCristales)

    return sobreOk({
      regaloId: resultado.regaloId,
      saldo: resultado.saldo,
      // Los tres números, para que la UI pueda explicar el reparto sin
      // recalcularlo (y sin que la explicación se separe del cobro).
      coste: reparto.coste,
      comision: reparto.comision,
      neto: reparto.neto,
    })
  })
}

async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
