-- ============================================================================
-- Darma · B06 · Ranking y reconocimiento
--
-- NOMBRE DEL ARCHIVO: la ficha `HANDOFF/B06.md` pedía `0006_b06_ranking.sql`,
-- pero `0006_cerrar_shadow_banned.sql` ya existe y está aplicada. Se usa el
-- rango `0106x` que `HANDOFF/PARALELO.md` §3 reserva para B06. Anotado en
-- PEDIDOS.md para que se corrija la ficha.
--
-- ── LA RESTRICCIÓN QUE GOBIERNA TODO ESTE ARCHIVO ──────────────────────────
-- El ranking NO se agrega en tiempo de lectura. Agregar `comments` en cada
-- carga de /ranking es una tabla que crece sin techo recorrida entera por cada
-- visita: a 100 000 usuarios es el primer sitio donde la app se cae. Aquí hay
-- por tanto DOS tablas y no una:
--
--   · `listen_daily`      — rollup diario mantenido por TRIGGER. Techo de filas:
--                           usuarios_activos × días. Es lo que convierte «suma
--                           todos los comentarios validados del mes» en un
--                           range scan sobre un índice.
--   · `ranking_snapshots` — la FOTO. Una fila por (periodo, corte, persona) con
--                           el `rank` ya calculado. Leer el tablero es un index
--                           scan de :limite filas y nada más.
--
-- ── LA OTRA RESTRICCIÓN, QUE ES DE PRIVACIDAD ──────────────────────────────
-- `authenticated` NO puede leer `listens_given` de `profiles` (0001), y no se
-- le reconcede aquí. El ranking no necesita ese permiso: sirve su propia
-- métrica desde `ranking_snapshots.listens`, que es un número YA agregado por
-- periodo y ya recortado por el techo antifarmeo. Es exactamente el límite que
-- B05 dejó anotado (el perfil ajeno no puede mostrar contadores de escuchas) y
-- se resuelve con la foto precalculada, no reabriendo la columna.
--
-- ── LAS TRES REGLAS DE ESQUEMA QUE YA COSTARON SIETE FALLOS ────────────────
--  1. RLS decide FILAS; solo el privilegio de COLUMNA decide columnas. Las dos
--     tablas de aquí son de escritura exclusiva del constructor, así que el
--     INSERT/UPDATE/DELETE se revoca entero en vez de enumerarse: no hay ni una
--     columna que el cliente pueda escribir.
--  2. Ninguna política RLS de este archivo consulta otra tabla. La única que
--     existe es `using (true)` sobre la foto. El filtro de shadow-ban vive en la
--     CONSTRUCCIÓN, dentro de una función `security definer` — que además es lo
--     que exige la seguridad del producto (ver §5).
--  3. Nada de reconceder columnas privadas de `profiles`.
-- ============================================================================


-- ============================================================================
-- 1. listen_daily — el rollup diario
-- ============================================================================
create table if not exists public.listen_daily (
  user_id  uuid    not null references public.profiles(id) on delete cascade,
  day      date    not null,
  listens  integer not null default 0 check (listens >= 0),
  primary key (user_id, day)
);

comment on table public.listen_daily is
  'Escuchas validadas por persona y día natural de Europe/Madrid. Infraestructura del ranking: SIN políticas RLS a propósito — el ritmo diario de alguien («los martes escucha a las 3:00») es un dato de conducta, y en una red de apoyo emocional dice demasiado. Solo service_role.';

-- El índice va (day, user_id) y no al revés: la consulta del constructor filtra
-- por VENTANA de días y agrupa por persona, así que el día es el prefijo que
-- convierte la ventana en un range scan. La PK (user_id, day) cubre el camino
-- contrario, que es el del trigger.
create index if not exists idx_listen_daily_day on public.listen_daily (day, user_id);

comment on index public.idx_listen_daily_day is
  'Ventana del constructor del snapshot: where day >= :corte and day < :corte_fin group by user_id. Prefijo por día para que la ventana sea un range scan y no un recorrido de la tabla.';


-- ── El trigger que la mantiene ──────────────────────────────────────────────
-- La app NUNCA escribe aquí. Si el contador dependiera de que una ruta de Next
-- se acuerde de incrementarlo, bastaría con validar un comentario por otra vía
-- (moderación, un script, B11) para que el ranking dejara de cuadrar en
-- silencio. Va con el dato, como el resto de la autoridad de esta app.
--
-- TRAMPA #2 DE LA FICHA, y es la razón de que haya tres ramas y no una:
-- `uq_comments_one_listen_per_post` es un índice PARCIAL (`where is_validated`).
-- Solo garantiza una escucha validada por (post, autor) MIENTRAS lo esté. Si se
-- contaran todas las transiciones de `is_validated` sin mirar la dirección, una
-- retirada de validación por moderación (true → false) sumaría en vez de restar.
-- Solo suma `false → true`; `true → false` resta.
create or replace function public.listen_daily_sync() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_dia date;
begin
  if tg_op = 'INSERT' then
    -- Un comentario puede nacer ya validado (lo inserta el servidor tras pasar
    -- el clasificador). El cliente no puede: 0004 le revoca la columna.
    if new.is_validated then
      v_dia := (new.created_at at time zone 'Europe/Madrid')::date;
      insert into public.listen_daily (user_id, day, listens)
      values (new.author_id, v_dia, 1)
      on conflict (user_id, day) do update
        set listens = listen_daily.listens + 1;
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- Borrar el post arrastra sus comentarios en cascada. Sin esta rama, el
    -- rollup conservaría escuchas de conversaciones que ya no existen y el
    -- ranking premiaría contenido borrado.
    if old.is_validated then
      v_dia := (old.created_at at time zone 'Europe/Madrid')::date;
      update public.listen_daily
         set listens = greatest(0, listens - 1)
       where user_id = old.author_id and day = v_dia;
    end if;
    return null;
  end if;

  -- UPDATE. El día se toma SIEMPRE de created_at, nunca de now(): validar un
  -- comentario de ayer tiene que sumar al día de ayer, o el techo antifarmeo
  -- diario se puede saltar acumulando comentarios y validándolos de golpe.
  v_dia := (new.created_at at time zone 'Europe/Madrid')::date;

  if new.is_validated and not old.is_validated then
    insert into public.listen_daily (user_id, day, listens)
    values (new.author_id, v_dia, 1)
    on conflict (user_id, day) do update
      set listens = listen_daily.listens + 1;

  elsif old.is_validated and not new.is_validated then
    update public.listen_daily
       set listens = greatest(0, listens - 1)
     where user_id = new.author_id and day = v_dia;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_listen_daily_sync on public.comments;
create trigger trg_listen_daily_sync
  after insert or delete or update of is_validated on public.comments
  for each row execute function public.listen_daily_sync();


-- ── Relleno inicial ─────────────────────────────────────────────────────────
-- `on conflict do nothing` y no `do update`: hace que reaplicar la migración
-- sea inocuo en vez de duplicar todo el histórico. La tabla nace vacía, así que
-- en la primera pasada el conflicto no se da nunca.
insert into public.listen_daily (user_id, day, listens)
select c.author_id,
       (c.created_at at time zone 'Europe/Madrid')::date,
       count(*)::int
  from public.comments c
 where c.is_validated
 group by 1, 2
on conflict (user_id, day) do nothing;


-- ============================================================================
-- 2. ranking_snapshots — la foto
-- ============================================================================
create table if not exists public.ranking_snapshots (
  period       text    not null check (period in ('semana', 'mes', 'historico')),
  period_start date    not null,
  user_id      uuid    not null references public.profiles(id) on delete cascade,
  rank         integer not null check (rank > 0),
  listens      integer not null,
  -- null = no estaba en el corte anterior. Es «entra nuevo», no «bajó a cero».
  prev_rank    integer,
  built_at     timestamptz not null default now(),
  primary key (period, period_start, user_id)
);

comment on table public.ranking_snapshots is
  'Foto precalculada del tablero. Se construye una vez por hora con service_role y ya viene filtrada de shadow-baneados, por eso su política de lectura es using(true): a estas alturas no queda nada que ocultar.';

-- ── DESVIACIÓN RESPECTO A LA FICHA, y es un arreglo de corrección ───────────
-- B06.md propone `idx_ranking_board (period, period_start, rank)` con el keyset
-- `where rank > :cursor_rank`. Con `dense_rank()` los EMPATES comparten rank, y
-- ese predicado se los come: si la página 1 termina en mitad de un grupo de tres
-- personas con rank 15, `rank > 15` salta las dos restantes y desaparecen del
-- tablero sin que nada lo indique. El keyset tiene que ser sobre una tupla
-- ÚNICA, así que se pagina por (rank, user_id) —el mismo par que desempata
-- `dense_rank()`— y el índice lo cubre entero.
create index if not exists idx_ranking_board
  on public.ranking_snapshots (period, period_start, rank, user_id);

comment on index public.idx_ranking_board is
  'Keyset del tablero: where period = :p and period_start = :ps and (rank, user_id) > (:cursor_rank, :cursor_user) order by rank, user_id limit :limite. La tupla lleva user_id porque dense_rank() empata y un keyset sobre una clave no única pierde filas. Nunca OFFSET.';


-- ============================================================================
-- 3. RLS y privilegios
-- ============================================================================
alter table public.listen_daily      enable row level security;
alter table public.ranking_snapshots enable row level security;

-- listen_daily: NINGUNA política. Con RLS activo eso es denegado para `anon` y
-- `authenticated`, y además se les quita el privilegio de tabla: dos barreras
-- independientes, porque una política que alguien añada mañana «para depurar»
-- no debe bastar para abrir un perfilado de conducta.
revoke all on public.listen_daily from anon, authenticated;

-- ranking_snapshots: lectura para cualquiera con sesión, escritura para nadie.
-- No se enumeran columnas de escritura (regla 1 del esquema) porque no hay
-- ninguna que el cliente pueda escribir: la tabla entera es de solo lectura
-- para él. El SELECT sí se enumera, para que una columna futura no se conceda
-- sola el día que alguien añada, por ejemplo, un `country`.
revoke all on public.ranking_snapshots from anon, authenticated;
grant select (period, period_start, user_id, rank, listens, prev_rank, built_at)
  on public.ranking_snapshots to authenticated;

drop policy if exists ranking_snapshots_read on public.ranking_snapshots;
create policy ranking_snapshots_read on public.ranking_snapshots
  for select to authenticated using (true);


-- ============================================================================
-- 4. El constructor
-- ============================================================================
-- Corre con service_role, una vez por hora. Hace en UNA sentencia lo que sería
-- un N+1 monumental desde Node: agrega la ventana, aplica el techo, excluye a
-- quien no debe salir, ordena, numera y escribe.
--
-- ── POR QUÉ SE PAGINA LA ESCRITURA Y NO SE TRUNCA ──────────────────────────
-- Una función de Vercel muere a los 60 s. Si el constructor no cabe, la salida
-- fácil es escribir «los primeros N» y dar la foto por buena: eso produce un
-- tablero que se corta en un punto arbitrario y que además CAMBIA de longitud
-- según la carga del servidor. Aquí se escribe por lotes ordenados por
-- `user_id` y se devuelve el último escrito; el disparo siguiente continúa
-- desde ahí. La foto se completa aunque haga falta más de una pasada.
--
-- `dense_rank()` se calcula SIEMPRE sobre el conjunto completo, en todos los
-- lotes: el lote solo decide qué se escribe, nunca cómo se numera. Por eso
-- reconstruir el mismo corte dos veces da exactamente las mismas filas
-- (idempotencia) y por eso un corte a medias no tiene rangos «provisionales».
--
-- El techo antifarmeo llega por parámetro (`p_listens_dia_max`) y no escrito a
-- mano: su valor sale de DAILY_KARMA_CAP / KARMA_WEIGHTS.comment_validated.
-- reputation en lib/karma.ts. Tecleado aquí, un cambio del tope diario dejaría
-- el ranking premiando lo que el karma ya no paga.
create or replace function public.construir_ranking_snapshot(
  p_periodo         text,
  p_corte           date,
  p_corte_fin       date,
  p_corte_anterior  date,
  p_listens_dia_max integer,
  p_desde_usuario   uuid    default null,
  p_max_filas       integer default 20000
) returns table (filas integer, ultimo_usuario uuid, completado boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_filas  integer;
  v_ultimo uuid;
begin
  if p_periodo is null or p_periodo not in ('semana', 'mes', 'historico') then
    raise exception 'periodo de ranking desconocido';
  end if;
  if p_corte is null then
    raise exception 'corte de ranking ausente';
  end if;
  -- El techo tiene que llegar, y tiene que ser sensato. Un 0 dejaría a todo el
  -- mundo a cero escuchas y publicaría un tablero vacío como si fuera real.
  if p_listens_dia_max is null or p_listens_dia_max < 1 then
    raise exception 'techo diario de escuchas invalido';
  end if;
  if p_max_filas is null or p_max_filas < 1 or p_max_filas > 200000 then
    raise exception 'tamano de lote invalido';
  end if;

  with agregado as (
    select ld.user_id,
           sum(least(ld.listens, p_listens_dia_max))::int as listens
      from public.listen_daily ld
      join public.profiles p on p.id = ld.user_id
     where ld.day >= p_corte
       and (p_corte_fin is null or ld.day < p_corte_fin)
       -- El shadow-ban se filtra AQUÍ, en la construcción, jamás en la lectura.
       -- Si se filtrara al leer, el troll vería su propio hueco en la
       -- numeración y sabría que está silenciado — que es exactamente lo que el
       -- shadow-ban existe para evitar.
       and not p.shadow_banned
       and (p.banned_until is null or p.banned_until < now())
     group by ld.user_id
    having sum(least(ld.listens, p_listens_dia_max)) > 0
  ),
  clasificado as (
    -- ⚠️ CORREGIDO EN `0106_3_b06_ranking_empates.sql`: con `a.user_id` dentro
    -- de la ventana no hay empates NUNCA. Se deja aquí tal y como se aplicó.
    select a.user_id, a.listens,
           dense_rank() over (order by a.listens desc, a.user_id)::int as rank
      from agregado a
  ),
  lote as (
    select c.user_id, c.listens, c.rank
      from clasificado c
     where p_desde_usuario is null or c.user_id > p_desde_usuario
     order by c.user_id
     limit p_max_filas
  ),
  escrito as (
    insert into public.ranking_snapshots
      (period, period_start, user_id, rank, listens, prev_rank)
    select p_periodo, p_corte, l.user_id, l.rank, l.listens, prev.rank
      from lote l
      left join public.ranking_snapshots prev
        on prev.period       = p_periodo
       and prev.period_start = p_corte_anterior
       and prev.user_id      = l.user_id
    on conflict (period, period_start, user_id) do update
      set rank      = excluded.rank,
          listens   = excluded.listens,
          prev_rank = excluded.prev_rank,
          built_at  = now()
    -- El alias no es cosmético: sin él, `escrito` expone una columna llamada
    -- `user_id` que choca con la de `listen_daily` en el resto de la sentencia.
    returning ranking_snapshots.user_id as escrito_user_id
  )
  -- ⚠️ CORREGIDO EN `0106_2_b06_ranking_max_uuid.sql`: Postgres 17 no tiene
  -- `max(uuid)` (llega en la 18) y esta línea falla con 42883. Se deja aquí tal
  -- y como se aplicó.
  select count(*)::int, max(e.escrito_user_id) into v_filas, v_ultimo from escrito e;

  -- Lote incompleto = ya no queda nadie después: la foto está cerrada.
  if v_filas < p_max_filas then
    -- Limpieza de filas que sobran. Sin esto, quien fue silenciado DESPUÉS de
    -- entrar en la foto se quedaría dentro para siempre (el `insert` nunca lo
    -- volvería a tocar), y una validación retirada por moderación dejaría un
    -- puesto ganado con escuchas que ya no existen.
    delete from public.ranking_snapshots rs
     where rs.period = p_periodo
       and rs.period_start = p_corte
       and not exists (
         select 1
           from public.listen_daily ld
           join public.profiles p on p.id = ld.user_id
          where ld.user_id = rs.user_id
            and ld.day >= p_corte
            and (p_corte_fin is null or ld.day < p_corte_fin)
            and not p.shadow_banned
            and (p.banned_until is null or p.banned_until < now())
          group by ld.user_id
         having sum(least(ld.listens, p_listens_dia_max)) > 0
       );

    return query select v_filas, v_ultimo, true;
  else
    return query select v_filas, v_ultimo, false;
  end if;
end;
$$;

revoke all on function public.construir_ranking_snapshot(text, date, date, date, integer, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.construir_ranking_snapshot(text, date, date, date, integer, uuid, integer)
  to service_role;


-- ============================================================================
-- 5. Las dos lecturas — `security invoker`, a propósito
-- ============================================================================
-- Son `invoker` y no `definer` porque no tienen nada que saltarse: la política
-- de `ranking_snapshots` ya deja leer la foto entera y las columnas de
-- `profiles` que tocan (id, alias, avatar_seed, level) son justo las que 0001
-- concede a `authenticated`. Una función `definer` aquí sería una vía para leer
-- lo que RLS no deja, escrita sin necesitarla.
--
-- Que sean funciones y no un `select` de PostgREST es por control del PLAN: el
-- keyset, el orden y el `limit` quedan fijados en el servidor y no dependen de
-- que quien llame construya bien la consulta.
create or replace function public.ranking_tablero(
  p_periodo     text,
  p_corte       date,
  p_cursor_rank integer default null,
  p_cursor_user uuid    default null,
  p_limite      integer default 20
) returns table (
  rank        integer,
  listens     integer,
  prev_rank   integer,
  built_at    timestamptz,
  user_id     uuid,
  alias       text,
  avatar_seed text,
  level       text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select rs.rank, rs.listens, rs.prev_rank, rs.built_at,
         p.id, p.alias, p.avatar_seed, p.level
    from public.ranking_snapshots rs
    join public.profiles p on p.id = rs.user_id
   where rs.period = p_periodo
     and rs.period_start = p_corte
     -- Primera página: (rank, user_id) > (0, uuid mínimo) incluye a todo el
     -- mundo. Un cursor ausente no es un caso especial, es el cursor cero.
     and (rs.rank, rs.user_id) >
         (coalesce(p_cursor_rank, 0), coalesce(p_cursor_user, '00000000-0000-0000-0000-000000000000'::uuid))
   order by rs.rank, rs.user_id
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

revoke all on function public.ranking_tablero(text, date, integer, uuid, integer) from public, anon;
grant execute on function public.ranking_tablero(text, date, integer, uuid, integer)
  to authenticated, service_role;

-- Tu fila, aunque estés en el puesto 40 000. Lectura por PK: nunca se pagina
-- hasta ti. Con `p_usuario` a null resuelve `auth.uid()`, que es el camino de
-- /api/ranking/yo; con un uuid explícito sirve a `obtenerPosicionDe()`, que
-- consumen B05 (perfil) y B13 (push «has entrado al podio»). No filtra nada:
-- la foto ya es pública para cualquiera con sesión.
create or replace function public.ranking_fila(
  p_periodo text,
  p_corte   date,
  p_usuario uuid default null
) returns table (
  rank        integer,
  listens     integer,
  prev_rank   integer,
  built_at    timestamptz,
  user_id     uuid,
  alias       text,
  avatar_seed text,
  level       text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select rs.rank, rs.listens, rs.prev_rank, rs.built_at,
         p.id, p.alias, p.avatar_seed, p.level
    from public.ranking_snapshots rs
    join public.profiles p on p.id = rs.user_id
   where rs.period = p_periodo
     and rs.period_start = p_corte
     and rs.user_id = coalesce(p_usuario, (select auth.uid()));
$$;

revoke all on function public.ranking_fila(text, date, uuid) from public, anon;
grant execute on function public.ranking_fila(text, date, uuid) to authenticated, service_role;


-- ============================================================================
-- 6. La función de trigger no debe ser invocable por la API (patrón de 0003)
-- ============================================================================
-- PostgREST publica como RPC toda función del esquema `public`. Postgres
-- rechaza llamar a una `returns trigger` fuera de un trigger, así que no hay
-- riesgo práctico, pero es SECURITY DEFINER y aparecería en la superficie
-- pública de la API como si fuera legítima.
revoke all on function public.listen_daily_sync() from public, anon, authenticated;
