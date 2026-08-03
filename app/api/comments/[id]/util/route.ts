// ============================================================================
// POST /api/comments/[id]/util — «me ayudó»
//
// La única señal de esta red que una máquina no puede fabricar: la firma de una
// persona que estaba sufriendo diciendo que ESTO le sirvió. Por eso paga +15,
// más que la validación automática (+10).
//
// ── QUIÉN PUEDE, Y CÓMO SE COMPRUEBA ───────────────────────────────────────
// Solo el autor del post. Se verifica EN EL SERVIDOR con una consulta —jamás
// con un flag que venga del cliente— y además lo vuelve a comprobar la función
// `marcar_comentario_util()` dentro de Postgres. Dos veces porque la regla vive
// en la base (ARCHITECTURE §0) y la ruta solo la anticipa.
//
// ── UN COMENTARIO POR POST, Y LA MARCA SE TRASLADA ─────────────────────────
// Decidido: se traslada. Se quita la anterior y se pone la nueva, en UNA
// transacción (por eso hay una función y no dos UPDATE sueltos; ver
// `0104_2_marcar_util.sql`). Rechazar el segundo intento con un «ya marcaste
// otro» obliga a deshacer para rehacer, y eso es fricción justo donde no toca.
//
// ⛔ EXCEPCIÓN DE ADMIN (2 de 3): `is_helpful` no está en el
// `grant update (body, state)` de 0001 —es una declaración sobre el trabajo de
// otra persona, y paga karma—, así que la escritura va con el cliente admin.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirPerfil, getContextoSesion } from '@/lib/auth/session'

import { limitarHilo } from '../../limites.ts'
import { esquemaUuid, validar } from '../../validacion.ts'
import type { RespuestaUtil } from '../../tipos.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FilaMarca {
  estado: string
  karma_otorgado: number
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejarRuta(async () => {
    const contexto = await getContextoSesion()
    if (!contexto) throw new ErrorApi('no_autenticado')
    exigirPerfil(contexto.sesion)
    const userId = contexto.sesion.userId

    const admin = createAdminClient()
    await limitarHilo('util', userId, admin)

    const comentarioId = validar(esquemaUuid, (await params).id)

    // Comprobación de autoría en el servidor, con el cliente RLS: si el post no
    // es visible para esta persona, tampoco puede marcar nada en él.
    const supabase = await createClient()
    const { data: comentario, error } = await supabase
      .from('comments')
      .select('id, author_id, post:posts!comments_post_id_fkey(author_id)')
      .eq('id', comentarioId)
      .eq('state', 'active')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })
    if (!comentario) throw new ErrorApi('no_encontrado')

    // El embed llega como objeto o como array de uno según la relación.
    const post = (Array.isArray(comentario.post) ? comentario.post[0] : comentario.post) as
      | { author_id: string }
      | undefined

    if (!post || post.author_id !== userId) {
      // Mismo mensaje que si no existiera: confirmar «existe pero no es tuyo»
      // le dice a quien sondea qué uuids son reales.
      throw new ErrorApi('sin_permiso', {
        mensaje: 'Solo quien escribió el desahogo puede decir qué respuesta le ayudó.',
      })
    }

    const { data, error: errorMarca } = await admin.rpc('marcar_comentario_util', {
      p_comment: comentarioId,
      p_actor: userId,
    })

    if (errorMarca) throw new ErrorApi('error_interno', { causa: errorMarca })

    const fila = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaMarca | null
    if (!fila) throw new ErrorApi('error_interno')

    if (fila.estado === 'no_encontrado') throw new ErrorApi('no_encontrado')
    if (fila.estado !== 'ok') throw new ErrorApi('sin_permiso')

    return sobreOk<RespuestaUtil>({
      comentarioId,
      // Lo REALMENTE pagado a quien escuchó, no los 15 nominales: el tope
      // diario puede haberlo recortado. Y se paga a quien escuchó, nunca a
      // quien marca — reconocer no es una forma de cobrar.
      karmaOtorgado: fila.karma_otorgado,
    })
  })
}
