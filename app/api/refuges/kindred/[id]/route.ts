// ============================================================================
// B10 · DELETE/PATCH /api/refuges/kindred/[id]
//
// `note` es la ÚNICA columna con `grant update` en `kindred` (0002). No es una
// convención de la API: un PATCH a PostgREST con cualquier otra columna muere
// con un error de privilegio. Por eso esta ruta puede ser tan corta.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { codigoDesdeErrorDeRefugio, contexto, limitar } from '../../_dominio/servidor'
import { esquemaNotaKindred } from '../../_dominio/validacion'

export const dynamic = 'force-dynamic'

const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const kindredId = (await params).id
    if (!uuidValido.test(kindredId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('kindred', ctx)

    const { error } = await ctx.supabase
      .from('kindred')
      .delete()
      .eq('owner_id', ctx.sesion.userId)
      .eq('kindred_id', kindredId)

    if (error) throw codigoDesdeErrorDeRefugio(error)
    // Idempotente: borrar a alguien que ya no estaba devuelve ok. Devolver 404
    // aquí solo serviría para que la UI tuviera que distinguir dos casos que a
    // la persona le dan igual.
    return sobreOk({ ok: true })
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const kindredId = (await params).id
    if (!uuidValido.test(kindredId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('kindred', ctx)

    const cuerpo = esquemaNotaKindred.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    const { data, error } = await ctx.supabase
      .from('kindred')
      .update({ note: cuerpo.data.note })
      .eq('owner_id', ctx.sesion.userId)
      .eq('kindred_id', kindredId)
      .select('kindred_id')

    if (error) throw codigoDesdeErrorDeRefugio(error)
    if ((data ?? []).length === 0) throw new ErrorApi('no_encontrado')

    return sobreOk({ ok: true })
  })
}
