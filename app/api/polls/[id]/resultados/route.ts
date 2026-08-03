// ============================================================================
// GET /api/polls/[id]/resultados  →  { ok: true, data: EncuestaFeed }
//
// El agregado sale SIEMPRE de `poll_options.vote_count` y `polls.total_votes`,
// que mantiene el trigger `poll_votes_sync()`. NUNCA de un `count(*)` sobre
// `poll_votes`: funciona perfecto con 20 votos y es un `Seq Scan` con 20
// millones. Medido con 1 000 007 votos sembrados, el plan de esta consulta no
// toca `poll_votes` ni una vez (ver la nota de rendimiento en la ficha).
//
// El umbral de revelación lo aplica `encuesta_resultados()` DENTRO de Postgres,
// no esta ruta. La diferencia importa: mientras `total_votes < min_reveal`, los
// recuentos ni siquiera salen del motor, así que no hay ninguna versión de este
// endpoint —ni un curl a PostgREST— que los devuelva. Sin ese umbral, la
// primera persona que vota en una encuesta nueva ve «100 % opción A» y sabe qué
// votó la siguiente en cuanto el porcentaje se mueve.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { resultadosDeEncuesta } from '@/lib/polls/consulta'
import { LIMITES_PETICION } from '@/lib/polls/limites'
import { parsearIdEncuesta } from '@/lib/polls/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `polls:resultados:${sesion.userId}`,
      limit: LIMITES_PETICION.resultados.limite,
      windowSeconds: LIMITES_PETICION.resultados.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { id } = await contexto.params

    return sobreOk(await resultadosDeEncuesta(supabase, parsearIdEncuesta(id)))
  })
}
