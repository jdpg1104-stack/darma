// ============================================================================
// POST /api/moderation/crisis/attend — marcar un evento de crisis como
// atendido. Solo moderadores.
//
// Escribe `attended_at`, `human_reviewed` y `outcome`. En cuanto `attended_at`
// deja de ser NULL la fila SALE del índice parcial `idx_crisis_pending`, así
// que la cola se vacía sola sin borrar histórico: la fila sigue ahí para poder
// responder algún día "¿qué hizo el sistema, y qué hizo una persona?".
//
// ⚠️ Esta ruta NO baja el `risk`. Bajar un riesgo es una decisión que se
// registra como atención humana, no un campo que se sobrescribe.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirModerador } from '@/lib/ai/guardia'
import { atenderCrisis } from '@/lib/ai/cola'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Cuerpo = z.object({
  /** `crisis_events.id` es `bigint identity`. */
  eventoId: z.string().regex(/^\d+$/),
  /** Qué se hizo. Lo escribe el revisor sobre su propia actuación. */
  outcome: z.string().min(1).max(500),
})

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const { sesion, admin } = await exigirModerador()

    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      throw new ErrorApi('entrada_invalida')
    }

    const analisis = Cuerpo.safeParse(cuerpo)
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    await atenderCrisis(admin, analisis.data.eventoId, analisis.data.outcome, sesion.userId)

    return sobreOk({ atendido: true as const })
  })
}
