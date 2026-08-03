// ============================================================================
// La consulta del hilo — una sola, con el autor unido por PK. Cero N+1.
//
// Vive aparte porque la usan DOS superficies que tienen que devolver lo mismo:
// `GET /api/comments` (paginación) y la página `app/(app)/post/[id]` (primera
// página, en el servidor). Duplicarla garantizaba que un día divergieran en el
// filtro de visibilidad, que es la parte que protege a las personas.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { aComentarioHilo, type FilaComentario } from './dominio.ts'
import { codificarCursor, type CursorHilo } from './cursor.ts'
import type { ComentarioHilo, PaginaCursor } from './tipos.ts'

/**
 * Columnas del comentario + el autor embebido.
 *
 * El embed pide EXACTAMENTE las columnas públicas de `profiles`: 0001 revocó el
 * SELECT sobre la tabla y lo devolvió solo sobre esas. Añadir aquí
 * `karma_spendable` o `shadow_banned` no devuelve null, devuelve `permission
 * denied for column` y tumba la consulta entera — que es el comportamiento
 * correcto, y la razón de que la lista esté escrita a mano y no con `*`.
 */
const COLUMNAS =
  'id, author_id, body, is_validated, is_helpful, upvote_count, created_at, ' +
  'autor:profiles!comments_author_id_fkey(id, alias, avatar_seed, level, karma_reputation, availability)'

export interface OpcionesHilo {
  postId: string
  userId: string
  limite: number
  cursor: CursorHilo | null
}

/**
 * Primera página o siguiente, en orden CRONOLÓGICO ASCENDENTE.
 *
 * Ascendente porque un hilo de apoyo se lee de arriba abajo: la conversación
 * solo tiene sentido en el orden en que ocurrió. (El feed es descendente; el
 * hilo, no. No es una inconsistencia, son dos lecturas distintas.)
 *
 * ── EL FILTRO DE VISIBILIDAD ───────────────────────────────────────────────
 * `is_validated = true` **o** el comentario es tuyo. Las dos mitades importan:
 *   · Sin la primera, el hilo revelaría que alguien escribió algo que no pasó
 *     la validación — información sobre otra persona que la ficha prohíbe que
 *     salga, y además una humillación innecesaria.
 *   · Sin la segunda, quien acaba de escribir no se ve a sí mismo y cree que su
 *     mensaje se ha perdido.
 * La política RLS `comments_read` deja ver TODOS los activos: este filtro es
 * regla de producto, no de seguridad, y por eso está escrito aquí y no allí.
 */
export async function leerHilo(
  supabase: SupabaseClient,
  opciones: OpcionesHilo,
): Promise<PaginaCursor<ComentarioHilo>> {
  const { postId, userId, limite, cursor } = opciones

  let consulta = supabase
    .from('comments')
    .select(COLUMNAS)
    .eq('post_id', postId)
    .eq('state', 'active')
    .or(`is_validated.eq.true,author_id.eq.${userId}`)

  if (cursor) {
    // Comparación de tupla `(created_at, id) > (:ts, :id)` en la sintaxis de
    // PostgREST. Es el MISMO par que ordena y que indexa
    // `idx_comments_post_keyset`; si alguna vez dejan de coincidir, el índice
    // deja de cubrir la consulta y aparece un filtro sobre heap.
    consulta = consulta.or(
      `created_at.gt.${cursor.creadoEn},and(created_at.eq.${cursor.creadoEn},id.gt.${cursor.id})`,
    )
  }

  // Se pide UNA fila de más para saber si hay página siguiente sin hacer un
  // `count(*)` sobre `comments`, que a escala es exactamente lo que no se puede
  // hacer (CONTRATOS §3).
  const { data, error } = await consulta
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite + 1)

  if (error) throw error

  const filas = (data ?? []) as unknown as FilaComentario[]
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const ultima = pagina[pagina.length - 1]

  return {
    items: pagina.map((fila) => aComentarioHilo(fila, userId)),
    siguienteCursor:
      hayMas && ultima ? codificarCursor({ creadoEn: ultima.created_at, id: ultima.id }) : null,
  }
}
