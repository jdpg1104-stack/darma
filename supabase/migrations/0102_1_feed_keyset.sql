-- ============================================================================
-- Darma · 0102_1 · B02 · Las cuatro RPC keyset del feed «Para ti»
--
-- POR QUÉ EXISTEN ESTAS FUNCIONES Y NO SE CONSULTA DESDE supabase-js
--
-- La paginación del feed es por keyset sobre la MISMA tupla que ordena el
-- índice: `where (hot_score, id) < (:score, :id) order by hot_score desc,
-- id desc`. Esa comparación de TUPLA (row comparison) es lo que permite que
-- Postgres haga un salto directo dentro de `idx_posts_hot` y lea exactamente
-- `limite` filas, esté el usuario en la página 1 o en la 200.
--
-- PostgREST no sabe expresar una comparación de tupla. El `.or()` de supabase-js
-- genera `hot_score < X or id < Y`, que NO es lo mismo: devuelve filas de más
-- (todas las de hot_score mayor cuyo id sea menor), y el usuario lo percibe como
-- «la app se repite» al hacer scroll. Escribir el predicado a mano en SQL es la
-- única forma de que el planificador use el índice ENTERO —las dos columnas— en
-- vez de solo la primera.
--
-- ── security INVOKER, no definer ────────────────────────────────────────────
-- Las cuatro son `security invoker` a propósito. Una función `security definer`
-- ejecutaría con los privilegios del dueño y SALTARÍA las políticas RLS: el feed
-- devolvería posts de personas en shadow-ban, contenido sin aprobar y encuestas
-- retiradas. Aquí RLS no es una comprobación redundante, es LA comprobación
-- (ARCHITECTURE §1). `invoker` significa que `posts_read`,
-- `content_items_read_approved` y `polls_read` siguen aplicándose dentro de la
-- función exactamente igual que fuera.
--
-- ── `stable`, no `volatile` ─────────────────────────────────────────────────
-- No escriben nada. Marcarlas `stable` permite al planificador cachear el
-- resultado dentro de un statement y, sobre todo, es lo que hace que PostgREST
-- no las trate como mutaciones.
--
-- ── Dos ramas en plpgsql en vez de un `p_cursor is null or (...)` ───────────
-- Es la decisión menos obvia del archivo y la que sostiene el requisito de
-- rendimiento. Con un solo statement de la forma
--
--     where p_cursor_id is null or (p.hot_score, p.id) < (p_cursor_score, p_cursor_id)
--
-- la comparación queda DENTRO de un OR, y un qual dentro de un OR no se puede
-- usar como condición de acceso al índice: Postgres arrancaría el recorrido en
-- la cima del índice y descartaría filas una a una hasta llegar a la posición
-- del cursor. En la página 200 eso son 4 000 filas leídas para devolver 20, y el
-- coste vuelve a crecer con la profundidad — justo lo que el keyset existe para
-- evitar. Con dos ramas, cada statement tiene su propio plan y el de la rama con
-- cursor lleva la tupla como `Index Cond`.
--
-- Solo AÑADE. No modifica nada de 0001–0004, que ya están aplicadas.
-- ============================================================================

-- ============================================================================
-- 1 · feed_keyset — carril «Para ti». Índice: idx_posts_hot.
--
-- `he_votado` se resuelve AQUÍ, con un `exists` correlacionado sobre la PK de
-- post_votes `(post_id, user_id)`, y no con una segunda consulta desde la app:
-- una consulta extra por página es un N+1 disfrazado de «solo una más».
--
-- Lo que NO hace esta función, a propósito:
--   · NO filtra por `risk`. Un post en crisis entra en el feed con su hot_score
--     normal (CONTRATOS §9). Se prioriza a la persona, no se la archiva.
--   · NO filtra por `shadow_banned`. Ya lo hace la política `posts_read`, y
--     escribirlo otra vez aquí ocultaría también los posts PROPIOS de quien está
--     silenciado — que debe seguir viéndolos con normalidad o sabrá que lo está.
--   · NO aplica el boost. `boost_until` sale crudo y el bono lo decide
--     `isBoostEligible()` en lectura (lib/feedRanking.ts): la columna hot_score
--     guarda siempre el score SIN boost para que el índice keyset sea estable y
--     un boost que expira no obligue a reescribir filas.
-- ============================================================================
create or replace function public.feed_keyset(
  p_cursor_score double precision,
  p_cursor_id    uuid,
  p_limite       integer
)
returns table (
  id             uuid,
  autor_id       uuid,
  kind           public.post_kind,
  body           text,
  topic          text,
  upvote_count   integer,
  reply_count    integer,
  hot_score      double precision,
  boost_until    timestamptz,
  risk           public.risk_level,
  created_at     timestamptz,
  he_votado      boolean,
  alias          text,
  avatar_seed    text,
  level          text,
  availability   text,
  karma_reputation integer
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  if p_cursor_id is null or p_cursor_score is null then
    -- Primera página: sin qual de cursor. Index Scan desde la cima de
    -- idx_posts_hot, exactamente v_limite filas.
    return query
      select p.id, p.author_id, p.kind, p.body, p.topic,
             p.upvote_count, p.reply_count, p.hot_score, p.boost_until,
             p.risk, p.created_at,
             exists (
               select 1 from public.post_votes v
                where v.post_id = p.id and v.user_id = (select auth.uid())
             ) as he_votado,
             pr.alias, pr.avatar_seed, pr.level, pr.availability, pr.karma_reputation
        from public.posts p
        join public.profiles pr on pr.id = p.author_id
       where p.state = 'active'
       order by p.hot_score desc, p.id desc
       limit v_limite;
  else
    -- Páginas siguientes: la tupla ES la condición de acceso al índice.
    return query
      select p.id, p.author_id, p.kind, p.body, p.topic,
             p.upvote_count, p.reply_count, p.hot_score, p.boost_until,
             p.risk, p.created_at,
             exists (
               select 1 from public.post_votes v
                where v.post_id = p.id and v.user_id = (select auth.uid())
             ) as he_votado,
             pr.alias, pr.avatar_seed, pr.level, pr.availability, pr.karma_reputation
        from public.posts p
        join public.profiles pr on pr.id = p.author_id
       where p.state = 'active'
         and (p.hot_score, p.id) < (p_cursor_score, p_cursor_id)
       order by p.hot_score desc, p.id desc
       limit v_limite;
  end if;
end;
$$;

comment on function public.feed_keyset(double precision, uuid, integer) is
  'Feed «Para ti». Keyset sobre (hot_score, id) con idx_posts_hot. security invoker: RLS (posts_read) sigue aplicándose. Nunca OFFSET, nunca count(*).';

-- ============================================================================
-- 2 · feed_keyset_nuevo — carril «Recientes». Índice: idx_posts_new.
--
-- El cursor es un timestamptz y NO un número de milisegundos: `created_at` tiene
-- precisión de microsegundos, y truncar a milisegundos haría que el predicado
-- `(created_at, id) < (:ts, :id)` saltara las filas escritas en los microsegundos
-- intermedios. En un feed con mucha escritura eso son posts que nadie llega a
-- ver nunca, y el fallo es invisible desde la app.
-- ============================================================================
create or replace function public.feed_keyset_nuevo(
  p_cursor_creado timestamptz,
  p_cursor_id     uuid,
  p_limite        integer
)
returns table (
  id             uuid,
  autor_id       uuid,
  kind           public.post_kind,
  body           text,
  topic          text,
  upvote_count   integer,
  reply_count    integer,
  hot_score      double precision,
  boost_until    timestamptz,
  risk           public.risk_level,
  created_at     timestamptz,
  he_votado      boolean,
  alias          text,
  avatar_seed    text,
  level          text,
  availability   text,
  karma_reputation integer
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  if p_cursor_id is null or p_cursor_creado is null then
    return query
      select p.id, p.author_id, p.kind, p.body, p.topic,
             p.upvote_count, p.reply_count, p.hot_score, p.boost_until,
             p.risk, p.created_at,
             exists (
               select 1 from public.post_votes v
                where v.post_id = p.id and v.user_id = (select auth.uid())
             ) as he_votado,
             pr.alias, pr.avatar_seed, pr.level, pr.availability, pr.karma_reputation
        from public.posts p
        join public.profiles pr on pr.id = p.author_id
       where p.state = 'active'
       order by p.created_at desc, p.id desc
       limit v_limite;
  else
    return query
      select p.id, p.author_id, p.kind, p.body, p.topic,
             p.upvote_count, p.reply_count, p.hot_score, p.boost_until,
             p.risk, p.created_at,
             exists (
               select 1 from public.post_votes v
                where v.post_id = p.id and v.user_id = (select auth.uid())
             ) as he_votado,
             pr.alias, pr.avatar_seed, pr.level, pr.availability, pr.karma_reputation
        from public.posts p
        join public.profiles pr on pr.id = p.author_id
       where p.state = 'active'
         and (p.created_at, p.id) < (p_cursor_creado, p_cursor_id)
       order by p.created_at desc, p.id desc
       limit v_limite;
  end if;
end;
$$;

comment on function public.feed_keyset_nuevo(timestamptz, uuid, integer) is
  'Carril «Recientes». Keyset sobre (created_at, id) con idx_posts_new.';

-- ============================================================================
-- 3 · feed_contenido_keyset — contenido curado del interleave.
-- Índice: idx_content_feed (language, performance_score desc, id desc)
--         where state = 'approved'.
--
-- El «ya visto» va con `not exists` y NUNCA con `not in (subselect)`: con un
-- NULL dentro del subselect, `not in` devuelve CERO filas —el feed de contenido
-- se vaciaría entero y en silencio— y además impide que el planificador elija un
-- anti-join. El acceso a content_views es por su clave primaria
-- (content_id, user_id), o sea un lookup por fila, no un recorrido.
-- ============================================================================
create or replace function public.feed_contenido_keyset(
  p_idioma       text,
  p_cursor_score double precision,
  p_cursor_id    uuid,
  p_limite       integer
)
returns table (
  id                uuid,
  title             text,
  summary           text,
  url               text,
  thumbnail_url     text,
  platform          text,
  duration_seconds  integer,
  topic             text,
  performance_score double precision
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 4), 1), 20);
  v_idioma text := coalesce(p_idioma, 'es');
begin
  if p_cursor_id is null or p_cursor_score is null then
    return query
      select c.id, c.title, c.summary, c.url, c.thumbnail_url, c.platform,
             c.duration_seconds, c.topic, c.performance_score
        from public.content_items c
       where c.state = 'approved'
         and c.language = v_idioma
         and not exists (
               select 1 from public.content_views w
                where w.content_id = c.id and w.user_id = (select auth.uid())
             )
       order by c.performance_score desc, c.id desc
       limit v_limite;
  else
    return query
      select c.id, c.title, c.summary, c.url, c.thumbnail_url, c.platform,
             c.duration_seconds, c.topic, c.performance_score
        from public.content_items c
       where c.state = 'approved'
         and c.language = v_idioma
         and (c.performance_score, c.id) < (p_cursor_score, p_cursor_id)
         and not exists (
               select 1 from public.content_views w
                where w.content_id = c.id and w.user_id = (select auth.uid())
             )
       order by c.performance_score desc, c.id desc
       limit v_limite;
  end if;
end;
$$;

comment on function public.feed_contenido_keyset(text, double precision, uuid, integer) is
  'Contenido curado del interleave. Keyset sobre (performance_score, id) con idx_content_feed, excluyendo lo ya visto con not exists.';

-- ============================================================================
-- 4 · feed_encuestas_keyset — encuestas del interleave.
-- Índice: idx_polls_feed (created_at desc, id desc) where state = 'active'.
--
-- Devuelve solo el id: la tarjeta la pinta B09 y el contrato del feed
-- (ElementoFeed) solo declara `encuestaId`. Traer aquí la pregunta y las
-- opciones sería adelantarse a un componente que aún no existe y arrastrar dos
-- consultas más por página para nada.
-- ============================================================================
create or replace function public.feed_encuestas_keyset(
  p_cursor_creado timestamptz,
  p_cursor_id     uuid,
  p_limite        integer
)
returns table (
  id         uuid,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 2), 1), 20);
begin
  if p_cursor_id is null or p_cursor_creado is null then
    return query
      select q.id, q.created_at
        from public.polls q
       where q.state = 'active'
       order by q.created_at desc, q.id desc
       limit v_limite;
  else
    return query
      select q.id, q.created_at
        from public.polls q
       where q.state = 'active'
         and (q.created_at, q.id) < (p_cursor_creado, p_cursor_id)
       order by q.created_at desc, q.id desc
       limit v_limite;
  end if;
end;
$$;

comment on function public.feed_encuestas_keyset(timestamptz, uuid, integer) is
  'Encuestas del interleave. Keyset sobre (created_at, id) con idx_polls_feed.';

-- ============================================================================
-- PRIVILEGIOS
--
-- `revoke ... from public` antes del grant: un `grant execute to authenticated`
-- a secas NO quita el EXECUTE que PUBLIC tiene por defecto, así que la función
-- quedaría publicada en /rest/v1/rpc/ para cualquiera sin sesión. El feed no es
-- público (ficha B02, §Seguridad) y `anon` no debe poder ni enumerarlo.
--
-- Al ser `security invoker`, conceder EXECUTE no concede acceso a ningún dato:
-- dentro de la función el rol efectivo sigue siendo `authenticated` y RLS decide
-- qué filas existen. Sin sesión, `auth.uid()` es NULL y `posts_read` no
-- selecciona nada.
-- ============================================================================
revoke all on function public.feed_keyset(double precision, uuid, integer) from public, anon;
revoke all on function public.feed_keyset_nuevo(timestamptz, uuid, integer) from public, anon;
revoke all on function public.feed_contenido_keyset(text, double precision, uuid, integer) from public, anon;
revoke all on function public.feed_encuestas_keyset(timestamptz, uuid, integer) from public, anon;

grant execute on function public.feed_keyset(double precision, uuid, integer) to authenticated;
grant execute on function public.feed_keyset_nuevo(timestamptz, uuid, integer) to authenticated;
grant execute on function public.feed_contenido_keyset(text, double precision, uuid, integer) to authenticated;
grant execute on function public.feed_encuestas_keyset(timestamptz, uuid, integer) to authenticated;

-- ── Índices ─────────────────────────────────────────────────────────────────
-- NINGUNO NUEVO, y es el resultado correcto: los cuatro predicados de arriba
-- están escritos para caber en índices que ya existen.
--   · idx_posts_hot        (hot_score desc, id desc) where state='active'  → 1
--   · idx_posts_new        (created_at desc, id desc) where state='active' → 2
--   · idx_content_feed     (language, performance_score desc, id desc)
--                          where state='approved'                          → 3
--   · idx_polls_feed       (created_at desc, id desc) where state='active' → 4
--   · post_votes_pkey      (post_id, user_id)                → `he_votado`
--   · content_views_pkey   (content_id, user_id)             → «ya visto»
-- Si alguna de estas consultas empieza a aparecer como Seq Scan, la causa no es
-- que falte un índice: es que el ORDER BY dejó de coincidir letra por letra con
-- el del índice.
