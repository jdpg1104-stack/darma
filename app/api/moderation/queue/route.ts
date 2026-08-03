// ============================================================================
// GET /api/moderation/queue — cola de revisión humana. Solo moderadores.
//
// Keyset sobre `(severity, created_at)`, exactamente el par que ordena y que
// indexa `idx_moderation_queue`. Cero OFFSET, cero count(*).
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirModerador } from '@/lib/ai/guardia'
import { leerColaModeracion, LIMITE_MAXIMO } from '@/lib/ai/cola'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Consulta = z.object({
  cursor: z.string().max(512).nullable().optional(),
  limite: z.coerce.number().int().positive().max(LIMITE_MAXIMO).optional(),
})

export async function GET(request: Request) {
  return manejarRuta(async () => {
    const { admin } = await exigirModerador()

    const url = new URL(request.url)
    const analisis = Consulta.safeParse({
      cursor: url.searchParams.get('cursor'),
      limite: url.searchParams.get('limite') ?? undefined,
    })
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    const pagina = await leerColaModeracion(admin, {
      cursor: analisis.data.cursor,
      limite: analisis.data.limite,
    })
    return sobreOk(pagina)
  })
}
