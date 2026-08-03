// ============================================================================
// POST /api/moderation/resolve — resolver un flag y, si toca, sancionar.
// Solo moderadores.
//
// Las sanciones van SIEMPRE por el cliente admin: `award_karma()` está
// revocada a `authenticated` y `profiles.shadow_banned` no está en su
// `grant update`. Eso no es un obstáculo a sortear, es el diseño.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirModerador } from '@/lib/ai/guardia'
import { resolverFlag } from '@/lib/ai/cola'
import { aplicarShadowBan, decidirSancion, penalizar, reincidencia } from '@/lib/ai/sancion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Cuerpo = z.object({
  /** `moderation_flags.id` es `bigint identity`: llega como cadena numérica. */
  flagId: z.string().regex(/^\d+$/),
  accion: z.enum(['resolved', 'dismissed']),
  nota: z.string().max(500).optional(),
  /** Sobre quién recae la sanción. Solo se usa con accion 'resolved'. */
  sujetoId: z.string().uuid().optional(),
  /** true ⇒ además de resolver, aplica penalización y evalúa el shadow-ban. */
  sancionar: z.boolean().optional(),
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
    const { flagId, accion, nota, sujetoId, sancionar } = analisis.data

    const estado = await resolverFlag(admin, flagId, accion, sesion.userId, nota)

    // Descartar un flag no sanciona a nadie: 'dismissed' significa justamente
    // "esto no era nada".
    if (accion === 'resolved' && sancionar === true && sujetoId) {
      const previas = await reincidencia(sujetoId, { admin })
      const decision = decidirSancion(previas)
      // El id del flag es la clave de idempotencia: si el moderador hace doble
      // clic o la petición se reintenta tras un timeout, no se cobra dos veces.
      await penalizar(sujetoId, decision.penalizar, null, `mod:${flagId}`, { admin })
      if (decision.shadowBan) await aplicarShadowBan(sujetoId, true, { admin })
    }

    return sobreOk({ estado })
  })
}
