-- ============================================================================
-- Darma · 0224_1 · B07/B21 · Fragmentos con marca de tiempo en `/animo`
--
-- ── QUÉ PROBLEMA CIERRA ────────────────────────────────────────────────────
-- `/animo` se diseñó como un feed vertical de piezas cortas —el formato que
-- levanta el ánimo a las tres de la mañana—, pero el catálogo REAL que pasó la
-- curación no tiene esa forma. Medido sobre `darma-dev` el 2026-08-08, con las
-- 26 piezas aprobadas:
--
--     duración media  55 min · 23 de 26 pasan de 30 min · la mayor, 87 min
--     piezas de menos de 3 min: UNA (un clip de 45 s de la OPS)
--
-- No es un descuido de la ingesta: es la consecuencia directa de la regla 2 del
-- criterio de admisión (`lib/ingest/fuentes.ts`), que prohíbe las
-- recopilaciones de clips ajenos —el formato habitual del «hopecore»— porque
-- son material de terceros resubido. Esa regla NO se toca aquí: sigue en pie y
-- sigue teniendo razón.
--
-- Lo que se abre es la otra salida: **el reproductor de YouTube acepta `start`
-- y `end`**. Curar el minuto 52 de una entrevista de 87 minutos es hopecore sin
-- resubir nada — el vídeo sigue siendo el del titular, en su reproductor, con
-- su publicidad y su recuento de visitas. Cambia lo que Darma ENCUADRA, no
-- dónde vive el material.
--
-- ── EL SEGUNDO PROBLEMA, QUE NO SE HABÍA VISTO ─────────────────────────────
-- El +1 de karma se concede al ver el 90 % de `duration_seconds`. Con una
-- entrevista de 87 minutos eso son 78 minutos seguidos: **hoy `/animo` es, en
-- la práctica, un feed que no paga karma a nadie**. No hay ningún test que lo
-- delate porque todos los que existen usan duraciones de laboratorio. El
-- fragmento arregla esto de paso, y por eso la duración efectiva se aplica
-- también a `latido_contenido()` y a `completar_contenido()` y no solo al
-- embed: si solo cambiara la URL, la barra de progreso pediría 78 minutos de
-- un fragmento de 40 segundos.
--
-- ── POR QUÉ DOS COLUMNAS Y NO UNA TABLA DE FRAGMENTOS ──────────────────────
-- Se descartó `content_clips (content_id, inicio, fin, …)` con varias filas por
-- vídeo. Permitiría tres fragmentos de la misma entrevista, que es tentador —y
-- es exactamente lo que convierte el feed en una recopilación—. Un ítem del
-- catálogo es UNA tarjeta: si de una charla merecen la pena dos momentos, son
-- dos decisiones de curación distintas y dos filas de `content_items`, cada una
-- con su auditoría y su `reviewed_by`. La forma de la tabla es la que impide el
-- atajo.
--
-- ── LOS LÍMITES, Y POR QUÉ ESTOS ───────────────────────────────────────────
--  · MÍNIMO 15 s. Por debajo, el objetivo del +1 (el 90 %) baja de 14 s y el
--    karma se vuelve regalable a golpe de scroll.
--  · MÁXIMO 180 s. Es el techo de «fragmento». Sin él, nada impide curar un
--    «fragmento» de 40 minutos y volver al punto de partida con más código.
--
-- Los dos son ESPEJO de `lib/video/acreditacion.ts`. Si cambias uno, cambia el
-- otro: hay una prueba que compara los dos caminos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · Las dos columnas
--
-- Nulas por defecto, y eso ES el estado normal: un ítem sin fragmento se
-- reproduce entero, como hasta hoy. Las 26 filas aprobadas que ya existen
-- quedan intactas y siguen pasando todos los CHECK.
-- ----------------------------------------------------------------------------
alter table public.content_items
  add column if not exists clip_start_seconds integer,
  add column if not exists clip_end_seconds   integer;

comment on column public.content_items.clip_start_seconds is
  'Segundo en el que empieza el fragmento curado, o NULL para reproducir el vídeo entero. Va SIEMPRE en pareja con clip_end_seconds.';
comment on column public.content_items.clip_end_seconds is
  'Segundo en el que termina el fragmento curado, o NULL. Ver 0224_1_b07_clips.sql.';

-- Uno sin el otro es un estado a medias que ningún consumidor sabría leer: el
-- embed pondría `start` sin `end` (reproduce hasta el final) y la acreditación
-- no sabría qué duración usar. La pareja se impone en el esquema, no en la ruta.
alter table public.content_items
  drop constraint if exists content_items_clip_pareja;
alter table public.content_items
  add constraint content_items_clip_pareja
  check ((clip_start_seconds is null) = (clip_end_seconds is null));

alter table public.content_items
  drop constraint if exists content_items_clip_rango;
alter table public.content_items
  add constraint content_items_clip_rango
  check (
    clip_start_seconds is null
    or (
      clip_start_seconds >= 0
      and clip_end_seconds > clip_start_seconds
      and clip_end_seconds - clip_start_seconds between 15 and 180
    )
  );

-- El fragmento no puede terminar después del vídeo. Solo se comprueba cuando la
-- duración consta: los ítems que llegan por feed Atom no la traen (anotado en
-- PEDIDOS.md), y rechazar el fragmento por eso impediría curar justo los ítems
-- que más lo necesitan.
alter table public.content_items
  drop constraint if exists content_items_clip_cabe;
alter table public.content_items
  add constraint content_items_clip_cabe
  check (
    clip_end_seconds is null
    or duration_seconds is null
    or clip_end_seconds <= duration_seconds
  );

-- ----------------------------------------------------------------------------
-- 2 · La duración que cuenta
--
-- Un solo sitio donde se responde «¿cuántos segundos hay que ver?», para que
-- las tres funciones que lo preguntan no puedan contestar distinto. El 60 de
-- respaldo es el que ya estaba en 0107_1: sin él, un ítem con `duration_seconds`
-- nulo daría objetivo nulo y el primer latido completaría el vídeo.
--
-- `immutable` y no `stable`: depende solo de sus argumentos.
-- ----------------------------------------------------------------------------
create or replace function public.duracion_util(
  p_duracion integer,
  p_inicio   integer,
  p_fin      integer
) returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    case when p_inicio is not null and p_fin is not null then p_fin - p_inicio end,
    p_duracion,
    60
  )
$$;

comment on function public.duracion_util(integer, integer, integer) is
  'Segundos que hay que ver de un content_item: la longitud del fragmento si lo hay, si no la duración del vídeo, si no 60. Espejo de duracionUtil() en lib/video/acreditacion.ts.';

-- Los privilegios por defecto de Supabase conceden EXECUTE a `anon` y a
-- `authenticated` sobre cada función nueva de `public`, y ese grant es DIRECTO:
-- `revoke ... from public` NO lo alcanza (comprobado el 2026-08-08 con
-- `has_function_privilege`). Por eso los roles se nombran uno a uno.
revoke all on function public.duracion_util(integer, integer, integer) from public, anon;
grant execute on function public.duracion_util(integer, integer, integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3 · El feed devuelve el fragmento
--
-- `drop` y no `create or replace`: cambia la lista de columnas del `returns
-- table`, y Postgres rechaza reemplazar una función cambiando su tipo de
-- retorno. Con `drop` hay que reponer los privilegios, y se reponen abajo.
-- ----------------------------------------------------------------------------
drop function if exists public.feed_animo(text, double precision, uuid, integer);

create function public.feed_animo(
  p_idioma       text,
  p_cursor_score double precision default 'Infinity'::double precision,
  p_cursor_id    uuid default 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
  p_limite       integer default 10
) returns table (
  id                 uuid,
  platform           text,
  external_id        text,
  title              text,
  source             text,
  language           text,
  duration_seconds   integer,
  thumbnail_url      text,
  topic              text,
  performance_score  double precision,
  clip_start_seconds integer,
  clip_end_seconds   integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ci.id, ci.platform, ci.external_id, ci.title, ci.source, ci.language,
         ci.duration_seconds, ci.thumbnail_url, ci.topic, ci.performance_score,
         ci.clip_start_seconds, ci.clip_end_seconds
    from public.content_items ci
   where ci.state = 'approved'
     and ci.language = p_idioma
     and (ci.performance_score, ci.id) < (p_cursor_score, p_cursor_id)
     -- Una sonda por la PK (content_id, user_id) por fila candidata, no un
     -- anti-join sobre content_views entera (la tabla más grande de la app).
     and not exists (
       select 1 from public.content_views cv
        where cv.content_id = ci.id
          and cv.user_id = (select auth.uid())
          and cv.completed
     )
   order by ci.performance_score desc, ci.id desc
   limit greatest(1, least(coalesce(p_limite, 10), 20));
$$;

revoke all on function public.feed_animo(text, double precision, uuid, integer) from public, anon;
grant execute on function public.feed_animo(text, double precision, uuid, integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4 · La acreditación cuenta sobre el fragmento
--
-- Las dos funciones conservan su firma y su tipo de retorno, así que `create or
-- replace` basta y los privilegios de 0107_1 siguen puestos. Lo único que
-- cambia en ambas es de dónde sale `v_duracion`.
--
-- Que el `select ... into` deje `v_duracion` NULL sigue significando «no existe
-- o no está aprobado»: el coalesce a 60 vive DENTRO de duracion_util() y solo
-- se aplica cuando hay fila.
-- ----------------------------------------------------------------------------
create or replace function public.latido_contenido(
  p_user uuid,
  p_content uuid,
  p_session uuid
) returns table (acreditados integer, faltan integer, listo boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duracion    integer;
  v_objetivo    integer;
  v_acreditados integer;
begin
  select public.duracion_util(ci.duration_seconds, ci.clip_start_seconds, ci.clip_end_seconds)
    into v_duracion
    from public.content_items ci
   where ci.id = p_content and ci.state = 'approved';

  if v_duracion is null then
    -- No existe, o no está aprobado. Se responde igual que a una sesión
    -- inválida: distinguir los dos casos sería un oráculo del catálogo.
    return query select 0, 0, false;
    return;
  end if;

  v_objetivo := ceil(0.9 * v_duracion)::integer;

  update public.content_sessions cs
     set credited_seconds = least(
           cs.credited_seconds
             + least(extract(epoch from (now() - cs.last_beat_at))::integer, 7),
           v_duracion
         ),
         last_beat_at = now(),
         beats = cs.beats + 1
   where cs.id = p_session
     and cs.user_id = p_user
     and cs.content_id = p_content
     and cs.closed_at is null
   returning cs.credited_seconds into v_acreditados;

  if v_acreditados is null then
    return query select 0, v_objetivo, false;
    return;
  end if;

  return query select
    v_acreditados,
    greatest(v_objetivo - v_acreditados, 0),
    v_acreditados >= v_objetivo;
end;
$$;

create or replace function public.completar_contenido(
  p_user uuid,
  p_content uuid,
  p_session uuid
) returns table (acreditado boolean, karma integer, motivo text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duracion    integer;
  v_objetivo    integer;
  v_acreditados integer;
  v_ya          boolean;
  v_idem        text;
  v_pagado      integer;
begin
  select public.duracion_util(ci.duration_seconds, ci.clip_start_seconds, ci.clip_end_seconds)
    into v_duracion
    from public.content_items ci
   where ci.id = p_content and ci.state = 'approved';

  if v_duracion is null then
    return query select false, 0, 'no_disponible'::text;
    return;
  end if;

  -- `for update` en la misma transacción que el insert: dos peticiones
  -- simultáneas de completado sobre la misma sesión se serializan aquí, así que
  -- no pueden pasar las dos la comprobación de tiempo y pagar dos veces.
  select cs.credited_seconds into v_acreditados
    from public.content_sessions cs
   where cs.id = p_session
     and cs.user_id = p_user
     and cs.content_id = p_content
     and cs.closed_at is null
   for update;

  if v_acreditados is null then
    -- Sesión inexistente, cerrada, de otro contenido o de OTRA PERSONA. Los
    -- cuatro casos comparten motivo a propósito: la respuesta no debe revelar
    -- si la sesión existe.
    return query select false, 0, 'sesion_invalida'::text;
    return;
  end if;

  v_objetivo := ceil(0.9 * v_duracion)::integer;

  if v_acreditados < v_objetivo then
    return query select false, 0, 'tiempo_insuficiente'::text;
    return;
  end if;

  select cv.completed into v_ya
    from public.content_views cv
   where cv.content_id = p_content and cv.user_id = p_user;

  if coalesce(v_ya, false) then
    -- Ya cobrado. Se cierra la sesión igualmente para que no quede abierta
    -- consumiendo el índice parcial.
    update public.content_sessions set closed_at = now() where id = p_session;
    return query select false, 0, 'ya_completado'::text;
    return;
  end if;

  -- Este UPDATE es el que dispara trg_content_views_sync → award_karma().
  -- El `where not content_views.completed` es redundante con la comprobación de
  -- arriba y está ahí por lo mismo que en 0004: la protección no debe descansar
  -- en un único mecanismo.
  insert into public.content_views (content_id, user_id, completed, watched_seconds, completed_at)
  values (p_content, p_user, true, v_acreditados, now())
  on conflict (content_id, user_id) do update
     set completed       = true,
         watched_seconds = greatest(content_views.watched_seconds, excluded.watched_seconds),
         completed_at    = now()
   where not content_views.completed;

  update public.content_sessions set closed_at = now() where id = p_session;

  -- Misma clave que construye content_views_sync(). Si el tope diario recortó,
  -- award_karma() salió por el `return 0` y este evento NO existe.
  v_idem := 'content_completed:' || p_content::text || ':' || p_user::text;

  select ke.delta_reputation into v_pagado
    from public.karma_events ke
   where ke.idempotency_key = v_idem;

  if coalesce(v_pagado, 0) > 0 then
    return query select true, v_pagado, null::text;
  else
    return query select true, 0, 'tope_diario'::text;
  end if;
end;
$$;
