-- ============================================================================
-- Darma · B04 · Hilo: escuchar, validar y «me ayudó»
--
-- Rango de migración de B04 según HANDOFF/PARALELO.md §3: `0104x`. El nombre
-- `0004_b04_hilo.sql` que pedía la ficha ya está ocupado por
-- `0004_insert_columnas.sql` (cimientos), así que se respeta el rango propio.
--
-- Solo añade. No modifica 0001–0004: ya están aplicadas.
-- ============================================================================

-- ── 1. Realtime sobre comments ──────────────────────────────────────────────
-- Sin esto el cliente se suscribe, NO recibe error, y no llega nada: el fallo
-- silencioso que cuesta una tarde de depuración en el navegador.
--
-- Qué se emite: `components/thread/HiloEnVivo.tsx` escucha SOLO eventos UPDATE,
-- no INSERT. La razón es de privacidad, no de comodidad: un comentario SIEMPRE
-- nace con `is_validated = false` (0004 cerró el INSERT a `(post_id, author_id,
-- body)`), así que suscribirse a INSERT emitiría por el cable el cuerpo de todo
-- comentario pendiente de validar de cualquier persona — y la ficha B04 prohíbe
-- expresamente que salga «si otra persona tiene un comentario no validado».
-- Realtime aplica RLS a nivel de FILA, pero no recorta COLUMNAS ni sabe de
-- nuestra regla de producto. La validación es lo que dispara el UPDATE, así que
-- escuchar UPDATE es exactamente «ha llegado una escucha nueva», sin filtrar
-- nada en el cliente que ya haya viajado por la red.
alter publication supabase_realtime add table public.comments;

-- ── 2. Índice del keyset del hilo ───────────────────────────────────────────
-- El de 0001 es `(post_id, created_at) where state='active'`: sirve para
-- ordenar, pero el desempate por `id` del cursor queda fuera del índice y
-- Postgres tiene que filtrarlo tras leer la fila. Con dos comentarios en el
-- mismo milisegundo (dos personas respondiendo a la vez a un post que acaba de
-- salir en el feed, que es justo cuando pasa) eso es un filtro sobre heap.
create index idx_comments_post_keyset
  on public.comments (post_id, created_at, id)
  where state = 'active';

comment on index public.idx_comments_post_keyset is
  'Hilo de un post, orden CRONOLÓGICO ASCENDENTE (una conversación de apoyo se lee de arriba abajo). Replica literalmente: where post_id = $1 and state = ''active'' and (created_at, id) > ($2, $3) order by created_at asc, id asc limit $4. El predicado parcial es el mismo que el de la consulta para que el índice se use entero y nunca toque los comentarios retirados.';

-- ── 3. La política de UPDATE que faltaba en `comments` ──────────────────────
-- 0001 concede `grant update (body, state) on public.comments to authenticated`
-- —es decir, decidió deliberadamente QUÉ columnas puede editar el autor— pero
-- no creó ninguna política de UPDATE. Con RLS activo eso significa DENEGADO:
-- el privilegio de columna existía sin puerta por la que usarlo, y
-- `PATCH /api/comments/[id]` (editar) y `DELETE` (retirar, que es
-- `state = 'removed'`) devolvían 200 sin escribir nada. El mismo fallo
-- silencioso que 0004 documenta para el INSERT, en el otro sentido.
--
-- La política SOLO decide filas: «la tuya, y mientras siga activa». Qué
-- columnas se pueden tocar lo sigue decidiendo el `grant` de 0001, así que
-- `is_validated`, `quality_score`, `is_helpful` y `upvote_count` continúan
-- fuera del alcance del cliente. Sin el `state = 'active'` del `using`, quien
-- retirase un comentario podría resucitarlo después de que un moderador lo
-- ocultara.
create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()) and state = 'active')
  with check (author_id = (select auth.uid()));

-- NOTA sobre editar un comentario YA validado (vector de farmeo conocido):
-- escribir algo bueno, cobrar los +10 y el crédito, y luego sustituirlo por
-- «ánimo». La política no lo impide a propósito —bloquear la edición obligaría
-- a elegir entre corregir una errata y conservar la escucha—; lo cubre la ruta
-- PATCH, que revalida el texto nuevo y, si degrada, escribe una señal en
-- `moderation_flags` (`edited_after_validation`, severidad 3). NO se retira el
-- karma desde ahí: quitar reputación es una decisión de moderación
-- (B11/humana), no de una heurística de longitud. Mismo criterio que la ficha
-- fija para `spam_penalty`.
