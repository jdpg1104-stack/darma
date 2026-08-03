// ============================================================================
// B10 · POST /api/refuges/[id]/salir
//
// Salir es poner `left_at`, no borrar la fila ni la sala. Borrar el refugio
// borraría el historial de la otra persona sin su consentimiento, y borrar la
// pertenencia haría que sus mensajes perdieran el contexto de quién estaba.
//
// El efecto es inmediato y no hace falta desplegar nada: `is_refuge_member()`
// exige `left_at is null`, así que en cuanto se escribe esa fecha la sala deja
// de existir para quien salió — no puede leer, ni escribir, ni saber si sigue
// habiendo conversación.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { codigoDesdeErrorDeRefugio, contexto, exigirRefugio, limitar } from '../../_dominio/servidor'

export const dynamic = 'force-dynamic'

const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = (await params).id
    if (!uuidValido.test(refugeId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('leido', ctx)

    // El id de la sala viene de la RUTA, nunca del cuerpo: es una acción
    // destructiva y el cuerpo de un POST es lo más fácil de manipular.
    await exigirRefugio(ctx, refugeId)

    const { error } = await ctx.supabase
      .from('refuge_members')
      .update({ left_at: new Date().toISOString() })
      .eq('refuge_id', refugeId)
      .eq('user_id', ctx.sesion.userId)
      .is('left_at', null)

    if (error) throw codigoDesdeErrorDeRefugio(error)
    return sobreOk({ ok: true })
  })
}
