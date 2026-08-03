-- ============================================================================
-- Darma · 0107_1 · B07 · Sesiones de reproducción y acreditación del +1
--
-- ── QUÉ PROBLEMA CIERRA ────────────────────────────────────────────────────
-- `content_views.completed` es lo que dispara `content_views_sync()` y, con él,
-- el `award_karma(..., 'content_completed')` de 0001. Mientras el cliente pudo
-- escribir esa columna, el +1 era declarativo: un `PATCH` a PostgREST con la
-- anon key marcaba `completed = true` sin ver un fotograma, y repetido sobre
-- 120 contenidos DISTINTOS agotaba el tope diario entero. La clave primaria
-- `(content_id, user_id)` solo impide repetir el MISMO vídeo; no impide barrer
-- el catálogo.
--
-- 0002 (corregido) + 0004 ya dejaron a `authenticated` sin ninguna vía de
-- escritura: INSERT limitado a `(content_id, user_id)`, política con
-- `completed = false and watched_seconds = 0`, y CERO políticas de UPDATE.
-- Esta migración NO vuelve a revocar nada (sería ruido): aporta la mitad que
-- faltaba, la que permite que el +1 se siga concediendo pero solo a quien de
-- verdad ha visto el vídeo.
--
-- ── EL MODELO ──────────────────────────────────────────────────────────────
-- El tiempo de reproducción lo acumula el SERVIDOR a partir de latidos, y cada
-- latido acredita `min(now() - last_beat_at, 7 s)`. El tope por llamada es la
-- pieza esencial: sin él, un cliente que se guarda los latidos y los manda
-- todos de golpe acreditaría minutos en un segundo. Y el acumulado se topa
-- además con `duration_seconds`, de modo que ninguna secuencia de latidos —por
-- larga que sea— puede acreditar más segundos de los que el vídeo dura.
--
-- El cliente NUNCA envía instantes: los envía el reloj de quien puede mentir.
-- Todos los tiempos salen de `now()` dentro de estas funciones.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- content_sessions — la prueba de que el vídeo se reprodujo de verdad.
-- ----------------------------------------------------------------------------
create table if not exists public.content_sessions (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null references public.content_items(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,

  -- Reloj del SERVIDOR.
  opened_at    timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  beats        smallint not null default 0 check (beats >= 0),

  -- Segundos acreditados, acumulados a partir del delta REAL entre latidos,
  -- topado por el intervalo esperado y por la duración del contenido.
  credited_seconds integer not null default 0 check (credited_seconds >= 0),

  closed_at    timestamptz
);

-- Parcial sobre las sesiones ABIERTAS: es la única pregunta que se hace sobre
-- esta tabla ("¿tiene esta persona una sesión viva para este vídeo?"), y el
-- barrido de las de más de 6 h es lo que lo mantiene diminuto frente al
-- histórico.
create index if not exists idx_content_sessions_open
  on public.content_sessions (user_id, content_id) where closed_at is null;

-- Para el barrido: encontrar las abandonadas sin recorrer la tabla entera.
create index if not exists idx_content_sessions_abandonadas
  on public.content_sessions (last_beat_at) where closed_at is null;

comment on table public.content_sessions is
  'B07 · Sesión de reproducción de un vídeo de /animo. RLS activa y CERO políticas a propósito: si el cliente pudiera leerla sabría exactamente cuántos segundos le faltan para cobrar el +1, que es justo el dato que convierte el anti-farmeo en un puzzle resoluble.';

-- RLS activa sin ninguna política = denegado para anon y authenticated. Los
-- privilegios se revocan igualmente: la defensa no descansa en un solo
-- mecanismo (misma disciplina que 0004).
alter table public.content_sessions enable row level security;
revoke all on public.content_sessions from anon, authenticated;

-- ============================================================================
-- FUNCIONES
--
-- Las tres primeras reciben `p_user` explícito en vez de leer `auth.uid()`.
-- No es un descuido: son `security definer` ejecutables SOLO por `service_role`,
-- y bajo esa identidad `auth.uid()` es NULL. El `p_user` sale siempre de
-- `requireSesion()` en el servidor de Next, nunca del cuerpo de la petición
-- (CONTRATOS §6). Como `service_role` es la única que puede invocarlas, poder
-- pasar un `p_user` arbitrario no añade superficie: quien tiene esa clave ya
-- puede escribir la tabla directamente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- abrir_sesion_contenido — empieza (o recupera) la sesión de reproducción.
--
-- REUTILIZA la sesión abierta si ya existe. Sin eso, un cliente en bucle crea
-- una fila por llamada y el índice parcial deja de ser pequeño; no es un
-- vector de farmeo (el +1 exige el 90 % de la duración dentro de UNA sesión),
-- pero sí de crecimiento sin límite.
-- ----------------------------------------------------------------------------
create or replace function public.abrir_sesion_contenido(
  p_user uuid,
  p_content uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sesion uuid;
begin
  -- Solo contenido aprobado. Lo pendiente y lo rechazado no existe para nadie.
  if not exists (
    select 1 from public.content_items ci
     where ci.id = p_content and ci.state = 'approved'
  ) then
    return null;
  end if;

  select cs.id into v_sesion
    from public.content_sessions cs
   where cs.user_id = p_user
     and cs.content_id = p_content
     and cs.closed_at is null
     and cs.last_beat_at > now() - interval '6 hours'
   order by cs.last_beat_at desc
   limit 1;

  if v_sesion is not null then
    return v_sesion;
  end if;

  -- La fila de content_views nace aquí, a cero, y dispara la rama INSERT de
  -- content_views_sync() (view_count + 1). Se hace desde el servidor y no desde
  -- el cliente para que "he abierto el vídeo" y "existe la fila" sean el mismo
  -- hecho, y no dos que se pueden desincronizar.
  insert into public.content_views (content_id, user_id)
  values (p_content, p_user)
  on conflict (content_id, user_id) do nothing;

  insert into public.content_sessions (content_id, user_id)
  values (p_content, p_user)
  returning id into v_sesion;

  return v_sesion;
end;
$$;

-- ----------------------------------------------------------------------------
-- latido_contenido — acredita el tiempo REAL transcurrido desde el latido
-- anterior, con dos topes.
--
-- UN SOLO `update ... returning`, sin `select` previo. Un select seguido de un
-- update sería una carrera: dos latidos simultáneos leerían el mismo valor y
-- escribirían el mismo total. El UPDATE toma el lock de la fila.
--
-- TOPE 1 · por llamada: `least(delta, 7)`. Un cliente que acumula latidos y los
--          descarga de golpe acredita ~0 s por latido (el delta real entre
--          ellos es ~0), y en el mejor de los casos 7 s. Nunca los 300 que
--          declare.
-- TOPE 2 · acumulado: `least(total, duration_seconds)`. Ninguna secuencia de
--          latidos puede acreditar más de lo que el vídeo dura, así que dejar
--          una pestaña abierta toda la noche no multiplica nada.
--
-- Devuelve `faltan` y nunca el bruto de la sesión más allá de lo acreditado:
-- `faltan` es la única cifra que la barra de progreso necesita.
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
  -- `duration_seconds` llega NULL en los vídeos que ingiere B07/B08 por feed
  -- Atom (no trae duración). 60 s es el mínimo razonable de un corto de
  -- bienestar: con NULL y sin este coalesce, el objetivo sería NULL y el +1
  -- se concedería al primer latido.
  select coalesce(ci.duration_seconds, 60) into v_duracion
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

-- ----------------------------------------------------------------------------
-- completar_contenido — la ÚNICA vía por la que `content_views.completed` pasa
-- a true, y por tanto la única por la que se paga el +1.
--
-- NO LANZA cuando la comprobación falla: devuelve `(false, motivo)`. Un 500 le
-- diría al farmeador exactamente qué comprobación no ha superado, que es la
-- información que necesita para ajustar el ataque. Un 200 con motivo estable es
-- además lo que la UI necesita para decir "hoy ya llegaste al máximo" sin que
-- parezca un error.
--
-- `karma` se deriva del ledger, no se supone: `award_karma()` RECORTA en el
-- tope diario (devuelve 0 y no escribe evento). Comprobar la existencia del
-- evento por su clave de idempotencia es la única forma honesta de distinguir
-- "+1 concedido" de "hoy ya no acumulas".
-- ----------------------------------------------------------------------------
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
  select coalesce(ci.duration_seconds, 60) into v_duracion
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

-- ----------------------------------------------------------------------------
-- barrer_sesiones_contenido — cierra las abandonadas. Se llama desde la ruta
-- del latido, acotada a 200 filas por llamada: sin esto el índice parcial
-- `idx_content_sessions_open` crece con cada pestaña que alguien cerró sin
-- terminar el vídeo, y deja de ser parcial en la práctica.
-- ----------------------------------------------------------------------------
create or replace function public.barrer_sesiones_contenido(
  p_max integer default 200
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cerradas integer;
begin
  with candidatas as (
    select cs.id
      from public.content_sessions cs
     where cs.closed_at is null
       and cs.last_beat_at < now() - interval '6 hours'
     order by cs.last_beat_at
     limit greatest(1, least(coalesce(p_max, 200), 1000))
     for update skip locked
  )
  update public.content_sessions cs
     set closed_at = now()
    from candidatas c
   where cs.id = c.id;

  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

-- ----------------------------------------------------------------------------
-- feed_animo — el keyset del feed vertical.
--
-- `security invoker` A PROPÓSITO (es la única de este archivo que no es
-- definer): así RLS sigue aplicándose dentro de la función —
-- `content_items_read_approved` y `content_views_read_own`— y la ruta puede
-- usar el cliente de CONTRATOS §6 en vez del admin. Existe como función y no
-- como consulta desde PostgREST porque el `not exists` sobre content_views no
-- se puede expresar en la sintaxis de PostgREST, y resolverlo en la app sería
-- un N+1 o un segundo viaje.
--
-- El cursor entra como (score, id) y el predicado es una comparación de TUPLA
-- sobre el mismo par que ordena el índice `idx_content_feed`. Cero OFFSET.
-- 'Infinity' + el uuid máximo son el cursor de la primera página: así el plan
-- es idéntico en la página 1 y en la 500.
-- ----------------------------------------------------------------------------
create or replace function public.feed_animo(
  p_idioma       text,
  p_cursor_score double precision default 'Infinity'::double precision,
  p_cursor_id    uuid default 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
  p_limite       integer default 10
) returns table (
  id                uuid,
  platform          text,
  external_id       text,
  title             text,
  source            text,
  language          text,
  duration_seconds  integer,
  thumbnail_url     text,
  topic             text,
  performance_score double precision
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ci.id, ci.platform, ci.external_id, ci.title, ci.source, ci.language,
         ci.duration_seconds, ci.thumbnail_url, ci.topic, ci.performance_score
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

-- ============================================================================
-- PERMISOS
--
-- `revoke ... from public` es obligatorio antes del grant: sin él la función
-- queda publicada en /rest/v1/rpc/ para cualquiera, incluido `anon` (misma
-- lección que el punto 2 de 0003).
-- ============================================================================
revoke all on function public.abrir_sesion_contenido(uuid, uuid) from public, anon, authenticated;
grant execute on function public.abrir_sesion_contenido(uuid, uuid) to service_role;

revoke all on function public.latido_contenido(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.latido_contenido(uuid, uuid, uuid) to service_role;

revoke all on function public.completar_contenido(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.completar_contenido(uuid, uuid, uuid) to service_role;

revoke all on function public.barrer_sesiones_contenido(integer) from public, anon, authenticated;
grant execute on function public.barrer_sesiones_contenido(integer) to service_role;

-- feed_animo SÍ la llama el cliente RLS: es security invoker y no puede
-- devolver nada que las políticas de lectura no dejasen ver de todos modos.
revoke all on function public.feed_animo(text, double precision, uuid, integer) from public, anon;
grant execute on function public.feed_animo(text, double precision, uuid, integer) to authenticated, service_role;
