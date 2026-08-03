// ============================================================================
// B10 · POST /api/refuges/[id]/leido — mover la marca de lectura
//
// `last_read_message_id` es lo que sustituye a contar no leídos. Es una de las
// tres columnas que 0002 deja escribir en `refuge_members` (`muted`,
// `last_read_message_id`, `left_at`) y la política solo permite tocar la propia
// fila, así que nadie puede marcar como leída la conversación de otro.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { codigoDesdeErrorDeRefugio, contexto, exigirRefugio, limitar } from '../../_dominio/servidor'
import { esquemaLeido } from '../../_dominio/validacion'

export const dynamic = 'force-dynamic'

const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = (await params).id
    if (!uuidValido.test(refugeId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('leido', ctx)

    const cuerpo = esquemaLeido.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    await exigirRefugio(ctx, refugeId)

    const { error } = await ctx.supabase
      .from('refuge_members')
      .update({ last_read_message_id: cuerpo.data.hastaId })
      .eq('refuge_id', refugeId)
      .eq('user_id', ctx.sesion.userId)

    if (error) throw codigoDesdeErrorDeRefugio(error)
    return sobreOk({ ok: true })
  })
}
