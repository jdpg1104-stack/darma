// ============================================================================
// POST   /api/posts/[id]/voto — apoyar un post
// DELETE /api/posts/[id]/voto — quitar el apoyo
//
// ── TRES COSAS QUE NADIE DEBE «ARREGLAR» MÁS ADELANTE ──────────────────────
//
//  1. AQUÍ NO SE TOCA `upvote_count`. Lo mantiene `trg_post_votes_sync`
//     (0001_core.sql) en el mismo `AFTER INSERT/DELETE`. Si además lo
//     incrementara esta ruta, cada voto contaría dos veces; y como `hot_score`
//     deriva de ese contador por `trg_posts_hot`, el orden del feed de TODA la
//     red quedaría corrompido de una forma que solo se nota semanas después.
//
//  2. UN VOTO NO DA KARMA. El karma se gana escuchando (`comment_validated`,
//     `marked_helpful`), no pulsando un botón. Si votar pagara, farmear karma
//     sería un bucle de un segundo y la reputación dejaría de significar nada.
//
//  3. UN VOTO NO CUENTA COMO ESCUCHA. No suma `listen_credits` ni acerca a nadie
//     a publicar. El crédito de reciprocidad solo lo da un comentario VALIDADO
//     (eso es B04). Votar es barato por diseño; escuchar es lo que cuesta, y esa
//     asimetría es la regla que sostiene Darma.
//
// ── POR QUÉ ESTA RUTA SÍ USA EL CLIENTE RLS ────────────────────────────────
// A diferencia de publicar y editar, votar no necesita leer `posts` ni escribir
// ninguna columna vetada: las políticas `votes_write_own` / `votes_delete_own`
// comprueban `user_id = auth.uid()` y no consultan `profiles`, así que no
// tropiezan con el 42501 de la política `posts_read` (ver PEDIDOS.md). Que la
// base haga el trabajo es la norma (CONTRATOS §6); el cliente admin de las otras
// rutas es la excepción justificada, no el atajo por defecto.
//
// La PK `(post_id, user_id)` ES la garantía de «un voto por persona»: no hay
// comprobación previa que pueda quedar desincronizada, y por eso el insert va
// con `on conflict do nothing` — votar dos veces es idempotente, no un error.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import type { RespuestaVoto } from '@/components/composer/contrato'
import { codigoDesdeErrorDePost } from '../../_dominio/publicar.ts'
import { adminOFallar, limitarB03 } from '../../_dominio/servidor.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function idValido(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params
  if (!RE_UUID.test(id)) throw new ErrorApi('no_encontrado')
  return id
}

export async function POST(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta<RespuestaVoto>(async () => {
    const sesion = await requirePerfil()
    const id = await idValido(contexto.params)

    // El admin solo se usa para el contador de rate limit (`check_rate_limit()`
    // está concedida a service_role y a nadie más). El voto en sí va por RLS.
    await limitarB03('votar', sesion.userId, adminOFallar())

    const supabase = await createClient()
    const { error } = await supabase
      .from('post_votes')
      // `user_id` de la sesión, nunca del cuerpo. La política lo comprobaría de
      // todas formas; está escrito así para que no dependa de eso.
      .upsert({ post_id: id, user_id: sesion.userId }, { ignoreDuplicates: true })

    if (error) throw new ErrorApi(codigoDesdeErrorDePost(error), { causa: error })

    return sobreOk<RespuestaVoto>({ votado: true })
  })
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta<RespuestaVoto>(async () => {
    const sesion = await requirePerfil()
    const id = await idValido(contexto.params)

    await limitarB03('votar', sesion.userId, adminOFallar())

    const supabase = await createClient()
    const { error } = await supabase
      .from('post_votes')
      .delete()
      .eq('post_id', id)
      .eq('user_id', sesion.userId)

    if (error) throw new ErrorApi(codigoDesdeErrorDePost(error), { causa: error })

    // Borrar algo que no estaba no es un error: el estado final es el pedido.
    return sobreOk<RespuestaVoto>({ votado: false })
  })
}
