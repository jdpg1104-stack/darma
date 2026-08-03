// ============================================================================
// GET /api/moderation/crisis — LA COLA QUE MÁS IMPORTA. Solo moderadores.
//
// Réplica literal del `WHERE` de `idx_crisis_pending`, ordenada por
// `created_at` ascendente: lo que lleva más tiempo sin atender va primero.
//
// La respuesta NO incluye `country_code`. El país solo sale del servidor
// incrustado en la tarjeta de recursos que ve la propia persona; como campo
// suelto en una lista es un dato de perfilado sobre alguien en crisis.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirModerador } from '@/lib/ai/guardia'
import { leerColaCrisis, LIMITE_MAXIMO } from '@/lib/ai/cola'

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

    const pagina = await leerColaCrisis(admin, {
      cursor: analisis.data.cursor,
      limite: analisis.data.limite,
    })
    return sobreOk(pagina)
  })
}
