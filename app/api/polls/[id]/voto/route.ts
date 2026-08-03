// ============================================================================
// POST /api/polls/[id]/voto  { opcionId }  →  { ok: true, data: EncuestaFeed }
//
// ── EL VOTO ES DEFINITIVO, Y ESO SE DECIDIÓ EN EL ESQUEMA ──────────────────
// `0002` revoca UPDATE **y** DELETE sobre `poll_votes`, y la PK es
// `(poll_id, user_id)`. No hay «cambiar de respuesta»: no porque falte
// implementarlo, sino porque poder cambiarlo convierte una encuesta anónima en
// un canal de señalización (voto A, miro el agregado, cambio a B, vuelvo a
// mirar: acabo de medir a los demás). La tarjeta lo dice ANTES de votar, no
// después — un aviso que llega cuando ya no se puede hacer nada no es un aviso.
//
// ── LOS TRES ERRORES QUE IMPORTAN, Y NINGUNO ES UN 500 ─────────────────────
//   · Ya has votado (23505)          → 403 `sin_permiso`, mensaje humano.
//   · La opción no es de esta encuesta o no existe (23503) → 422, sin decir
//     cuál de las dos cosas: sería un oráculo para enumerar ids.
//   · La encuesta está cerrada o el `user_id` no es el tuyo (42501) → 403.
// Los tres los decide Postgres. Comprobar cualquiera de ellos aquí antes de
// insertar sería una condición de carrera con dos peticiones simultáneas.
//
// ── POR QUÉ SE DEVUELVEN LOS RESULTADOS EN LA MISMA RESPUESTA ──────────────
// Quien acaba de votar quiere ver el agregado en ese instante, no tras un
// refetch. Son dos consultas —el insert y `encuesta_resultados()`— y la segunda
// es la que aplica el umbral: si todavía no se llega a `min_reveal`, lo que
// vuelve es `revelado: false` sin un solo porcentaje, incluso para quien acaba
// de votar. Es exactamente ahí donde se filtraría el voto de los demás.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { registrarVoto, resultadosDeEncuesta } from '@/lib/polls/consulta'
import { LIMITES_PETICION } from '@/lib/polls/limites'
import { parsearIdEncuesta, parsearVoto } from '@/lib/polls/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `polls:voto:${sesion.userId}`,
      limit: LIMITES_PETICION.voto.limite,
      windowSeconds: LIMITES_PETICION.voto.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { id } = await contexto.params
    const pollId = parsearIdEncuesta(id)
    const { opcionId } = parsearVoto(await leerCuerpo(request))

    await registrarVoto(supabase, {
      pollId,
      opcionId,
      // De la SESIÓN. Aceptar un `userId` del body es la vulnerabilidad más
      // común de este tipo de ruta (CONTRATOS §6) — y aquí sería votar en
      // nombre de otra persona en una encuesta sobre su salud mental.
      userId: sesion.userId,
    })

    return sobreOk(await resultadosDeEncuesta(supabase, pollId))
  })
}

/**
 * `request.json()` LANZA con un cuerpo vacío o que no es JSON, y esa excepción
 * llegaría al `catch` de `manejarRuta` como un 500. Un cuerpo mal formado es un
 * 422, así que se convierte aquí.
 */
async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
