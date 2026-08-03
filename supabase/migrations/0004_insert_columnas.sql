-- ============================================================================
-- Darma · 0004 · Cerrar la escritura de columnas en el INSERT
--
-- Encontrado ejecutando la suite de intrusión con una sesión REAL de usuario
-- (no con la anon key sin sesión, que no prueba nada): un usuario cualquiera
-- podía insertar un comentario con `is_validated = true`.
--
-- Por qué se coló: 0001 fue meticuloso con el UPDATE —`revoke update` y luego
-- `grant update (body, state)`— pero no tocó el INSERT. Y la política RLS
-- `comments_insert_own` solo comprueba QUIÉN eres (`author_id = auth.uid()`),
-- no QUÉ columnas escribes. RLS decide filas; los privilegios de columna
-- deciden columnas. Con el INSERT intacto, el cliente podía rellenar la fila
-- entera a su gusto.
--
-- Impacto real, aunque el karma no se otorgara en el acto (el trigger que paga
-- es AFTER UPDATE, no de inserción):
--   · `comments.is_validated` es lo que cuenta una escucha. El ranking de
--     escuchas (B06) y el gate de reciprocidad se apoyan en ese campo, así que
--     era falsificable sin escuchar a nadie — exactamente lo contrario de lo
--     que Darma mide.
--   · `posts.boost_until` es visibilidad comprada. Insertable a mano = boost
--     gratis e ilimitado, saltándose la economía entera.
--   · `posts.upvote_count` alimenta el hot score en el trigger BEFORE INSERT,
--     así que un valor inventado entraba en el cálculo del feed.
--
-- La regla que se aplica aquí, y que conviene repetir en toda tabla futura:
-- **enumerar las columnas que el cliente PUEDE escribir**, nunca confiar en que
-- una política de fila proteja una columna.
-- ============================================================================

-- ── comments ────────────────────────────────────────────────────────────────
-- El cliente escribe el comentario y nada más. `is_validated`, `quality_score`,
-- `is_helpful` y `upvote_count` los decide el servidor: son el resultado de que
-- alguien o algo revise el contenido, no una declaración de quien lo escribe.
revoke insert on public.comments from anon, authenticated;
grant  insert (post_id, author_id, body) on public.comments to authenticated;

-- ── posts ───────────────────────────────────────────────────────────────────
-- `risk` queda fuera aposta: el nivel de riesgo lo asigna la evaluación de
-- crisis del servidor. Que el autor pudiera declararse `risk = 'none'` sería
-- darle un interruptor para salir de la cola de revisión.
revoke insert on public.posts from anon, authenticated;
grant  insert (author_id, kind, body, topic) on public.posts to authenticated;

-- ── El resto de tablas que el cliente puede insertar ────────────────────────
-- post_votes y poll_votes: sus columnas son (id de la cosa, id de la persona,
-- created_at). No hay nada que falsificar más allá del user_id, que ya cubre la
-- política. Se enumeran igualmente para que la regla sea uniforme y para que
-- añadir una columna nueva mañana no la conceda sola.
revoke insert on public.post_votes from anon, authenticated;
grant  insert (post_id, user_id) on public.post_votes to authenticated;

revoke insert on public.poll_votes from anon, authenticated;
grant  insert (poll_id, option_id, user_id) on public.poll_votes to authenticated;

-- content_views ya estaba protegida por el `with check` de su política
-- (completed = false y watched_seconds = 0), pero la defensa no debe descansar
-- en un único mecanismo: si alguien relaja esa política, el privilegio sigue.
revoke insert on public.content_views from anon, authenticated;
grant  insert (content_id, user_id) on public.content_views to authenticated;
