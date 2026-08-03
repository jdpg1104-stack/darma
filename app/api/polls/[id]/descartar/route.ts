// ============================================================================
// POST /api/polls/[id]/descartar  →  { ok: true, data: { descartada: true } }
//
// «No me interesa». Es la ruta que evita que una encuesta persiga por el feed a
// alguien que no quiere responderla — y eso, en una app de bienestar, no es una
// comodidad: hay preguntas («¿te sientes solo?») que a alguien le sientan mal
// justo hoy, y la respuesta del producto tiene que ser retirarla, no insistir.
//
// Idempotente por la clave primaria `(poll_id, user_id)`: descartar dos veces
// devuelve el mismo `ok`. Un 409 por volver a pulsar un botón que ya hizo lo
// que se le pedía es un error inventado por el servidor.
//
// No hay ruta inversa. Des-descartar es votar: la encuesta sigue accesible por
// `/api/polls/[id]/resultados`, solo deja de ofrecerse en el feed.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { registrarDescarte } from '@/lib/polls/consulta'
import { LIMITES_PETICION } from '@/lib/polls/limites'
import { parsearIdEncuesta } from '@/lib/polls/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(_request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `polls:descartar:${sesion.userId}`,
      limit: LIMITES_PETICION.descartar.limite,
      windowSeconds: LIMITES_PETICION.descartar.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { id } = await contexto.params

    await registrarDescarte(supabase, {
      pollId: parsearIdEncuesta(id),
      userId: sesion.userId,
    })

    return sobreOk({ descartada: true as const })
  })
}
