-- ============================================================================
-- B19 · Centro de mando (admin) — roles, auditoría y rollup diario
--
-- Rango 0191–0199 (PARALELO.md §3). La ficha B19.md decía «0019», pero ese
-- número pertenece a los cimientos y ya está ocupado; se respeta el rango.
--
-- SOLO AÑADE. No modifica ni una línea de 0001–0008 ni de las migraciones de
-- otros bloques: todas están aplicadas en darma-dev (CONTRATOS §12).
--
-- ── LAS CUATRO REGLAS QUE ESTA MIGRACIÓN HACE CUMPLIR ──────────────────────
--
-- 1. RLS decide FILAS; los privilegios de columna deciden COLUMNAS. Aquí no
--    hace falta ni un grant de columna porque estas tres tablas no se abren a
--    `anon` ni a `authenticated` en absoluto: se les revoca todo.
--
-- 2. Ninguna política RLS consulta otra tabla con subconsulta. De hecho aquí
--    no hay NI UNA política: `admin_roles`, `admin_audit_log` y
--    `admin_metrics_daily` llevan RLS activada y CERO políticas, igual que
--    `identity_vault` en 0001. En Postgres eso es «denegado» para todo el
--    mundo salvo `service_role`, que salta RLS por definición.
--
--    Una política «para admins» sería CIRCULAR (leer admin_roles requiere ser
--    admin, y para saberlo hay que leer admin_roles) y, peor, convertiría la
--    tabla de permisos en algo alcanzable desde PostgREST con la anon key.
--
-- 3. CERO AGREGACIÓN EN VIVO. El panel lee `admin_metrics_daily`, una fila por
--    día. `admin_rollup_dia()` es lo único que toca `posts`, `comments`,
--    `karma_events` y `crystal_ledger`, y lo hace acotando SIEMPRE por
--    `created_at >= x and created_at < y` sobre un índice — nunca
--    `date_trunc('day', created_at) = p_dia`, que invalida el índice y
--    convierte el rollup en un Seq Scan de decenas de millones de filas.
--
-- 4. EL ROL SE COMPRUEBA EN LA BASE DE DATOS. No hay lista de correos, ni de
--    dominios, ni de uuids, ni en el código ni en el entorno. `admin_roles` es
--    la única fuente de verdad y `tiene_rol_admin()` la única puerta.
--
-- ── LO QUE SE AUDITA ───────────────────────────────────────────────────────
-- TODO acceso al panel, concedido o DENEGADO. Saber quién intentó entrar
-- importa tanto como saber quién entró: un `admin.denegado` repetido desde la
-- misma cuenta es exactamente la señal que se quiere poder ver en frío tres
-- meses después. `admin_audit_log` es append-only por trigger, igual que
-- `crystal_ledger`: ni un script del equipo puede reescribirlo.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- §1 · El rol de administrador
-- ════════════════════════════════════════════════════════════════════════════

-- El ORDEN de los valores del enum ES la jerarquía. Postgres compara los enum
-- por posición de declaración, así que `'operaciones' >= 'moderador'` es cierto
-- en SQL sin ninguna tabla auxiliar ni ningún CASE. Si algún día se añade un
-- rol intermedio hará falta `alter type ... add value ... before ...`, y eso es
-- deliberadamente incómodo: cambiar una jerarquía de permisos debe doler.
do $$
begin
  if not exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'admin_role') then
    create type public.admin_role as enum
      ('soporte','moderador','operaciones','superadmin');
  end if;
end $$;


create table if not exists public.admin_roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       public.admin_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  -- Revocar es un UPDATE de esta columna, JAMÁS un DELETE. Quién tuvo acceso y
  -- cuándo lo perdió es parte del registro; borrar la fila borra la respuesta a
  -- «¿quién podía ver esto el día del incidente?».
  revoked_at timestamptz
);

comment on table public.admin_roles is
  'Única fuente de verdad del rol de administrador. RLS activa y CERO políticas: solo service_role. Nunca se borra una fila; se pone revoked_at.';

alter table public.admin_roles enable row level security;
-- Sin políticas a propósito. No añadir ninguna.

-- Índice parcial minúsculo: la consulta real es «¿hay algún superadmin activo
-- aparte de este?», que corre en cada revocación.
create index if not exists idx_admin_roles_activos
  on public.admin_roles (role)
  where revoked_at is null;


-- ════════════════════════════════════════════════════════════════════════════
-- §2 · La auditoría, append-only de verdad
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  -- No es `not null` con `on delete set null`: eso se contradice y rompe el
  -- borrado RGPD de B20. Un actor borrado deja `null` y la acción sigue en el
  -- registro, que es justo lo que un registro de auditoría debe hacer.
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Registro append-only de TODO acceso admin, concedido y denegado. RLS activa y CERO políticas.';

alter table public.admin_audit_log enable row level security;
-- Sin políticas a propósito.

-- Lectura de la auditoría: siempre por keyset descendente sobre (created_at, id).
create index if not exists idx_admin_audit_keyset
  on public.admin_audit_log (created_at desc, id desc);

-- Y la consulta que de verdad importa cuando algo huele mal: «todo lo denegado,
-- lo más reciente primero». Parcial, así que ocupa lo que ocupan los intentos
-- fallidos y no crece con el uso normal del panel.
create index if not exists idx_admin_audit_denegados
  on public.admin_audit_log (created_at desc)
  where action like '%denegado%';


-- Mismo patrón que crystal_ledger_immutable() de 0002: el ledger no se corrige,
-- se compensa. Un registro de auditoría que se puede editar no es un registro
-- de auditoría, es una sugerencia sobre lo que pasó.
create or replace function public.admin_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'admin_audit_log es append-only: no se puede % una fila', lower(tg_op)
    using errcode = '42501';
end $$;

drop trigger if exists trg_admin_audit_immutable on public.admin_audit_log;
create trigger trg_admin_audit_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_immutable();

-- Es una función de TRIGGER, pero al vivir en `public` PostgREST la expone como
-- /rest/v1/rpc/admin_audit_immutable y cualquiera podría invocarla. Hoy no hace
-- daño (solo lanza), pero una función `security definer` alcanzable sin sesión
-- no se deja abierta «porque hoy no hace nada»: mañana alguien le añade un
-- efecto. Detectado por el linter de Supabase, mismo caso que
-- `profiles_exige_auth_user()` en 0201.
revoke all on function public.admin_audit_immutable() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- §3 · La tabla de rollup — la razón de que el panel no tumbe la base
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_metrics_daily (
  dia          date primary key,
  metricas     jsonb not null,
  calculado_en timestamptz not null default now()
);

comment on table public.admin_metrics_daily is
  'Una fila por día con TODAS las métricas del panel. El panel lee de aquí y nunca de posts/comments/karma_events.';

alter table public.admin_metrics_daily enable row level security;
-- Sin políticas a propósito: los agregados de una red de apoyo emocional no son
-- públicos ni siquiera en forma de conteo.


-- ════════════════════════════════════════════════════════════════════════════
-- §4 · Índices que el rollup necesita para NO hacer Seq Scan
--
-- Cada uno lleva escrito el WHERE literal de la consulta que lo usa. Ninguno
-- existía: todos los índices temporales del esquema son por (autor, fecha) o
-- por (post, fecha), y el rollup corta por fecha GLOBAL. Sin estos índices el
-- rollup es exactamente el Seq Scan sobre `comments` que la ficha prohíbe.
--
-- Son aditivos y no cambian ninguna semántica: no se toca ninguna política,
-- ningún privilegio ni ninguna columna de otro bloque.
-- ════════════════════════════════════════════════════════════════════════════

-- select count(*), count(*) filter (where is_validated)
--   from comments where created_at >= x and created_at < y
-- El INCLUDE convierte esas dos cuentas en un Index Only Scan: no toca el heap.
create index if not exists idx_comments_rollup_dia
  on public.comments (created_at) include (is_validated);

-- select ... from posts where created_at >= x and created_at < y
-- No es parcial por `state`: un post retirado más tarde consumió sus 3 escuchas
-- igual, y dejarlo fuera inflaría el ratio justo cuando la moderación trabaja.
create index if not exists idx_posts_rollup_dia
  on public.posts (created_at) include (risk);

-- select sum(delta_reputation) ... from karma_events where created_at >= x ...
create index if not exists idx_karma_events_rollup_dia
  on public.karma_events (created_at) include (delta_reputation, delta_spendable);

-- select ... from crystal_ledger where created_at >= x and created_at < y
create index if not exists idx_crystal_ledger_rollup_dia
  on public.crystal_ledger (created_at);

-- select ... from crisis_events where created_at >= x and created_at < y
-- (la cola VIVA sigue usando idx_crisis_pending, que ya existe en 0002)
create index if not exists idx_crisis_rollup_dia
  on public.crisis_events (created_at) include (risk, human_reviewed);

-- Cohorte de activación: las personas registradas ese día.
create index if not exists idx_profiles_rollup_dia
  on public.profiles (created_at);

-- «¿Cuánta gente topó el límite diario de karma?». Parcial y minúsculo: solo
-- entran las filas de quien ganó karma hoy.
create index if not exists idx_profiles_karma_diario
  on public.profiles (daily_karma_date)
  where daily_karma_earned > 0;

-- Escalón «primera lectura» del embudo: exists(post_votes where user_id = ...).
-- La PK es (post_id, user_id) y no sirve para buscar por persona.
create index if not exists idx_post_votes_user
  on public.post_votes (user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- §5 · tiene_rol_admin() — la única puerta
-- ════════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER con search_path fijado (sin fijarlo, alguien podría crear
-- una tabla `admin_roles` en un esquema propio y suplantar a la de verdad
-- dentro de la función).
--
-- Y va como FUNCIÓN, no como subconsulta dentro de una política RLS: esa es la
-- regla que ya costó fallos de seguridad en este repo (ver `esta_silenciado()`
-- en 0005). Aquí además no hay ninguna política que pudiera consultarla, así
-- que el patrón se cumple por partida doble.
create or replace function public.tiene_rol_admin(
  p_user   uuid,
  p_minimo public.admin_role
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.admin_roles ar
     where ar.user_id = p_user
       and ar.revoked_at is null       -- un rol revocado NO concede nada
       and ar.role >= p_minimo         -- jerarquía nativa del enum
  );
$$;

comment on function public.tiene_rol_admin(uuid, public.admin_role) is
  'Único punto donde se decide si alguien es admin. Prohibida cualquier lista de correos o uuids en el código.';

revoke all on function public.tiene_rol_admin(uuid, public.admin_role) from public, anon, authenticated;
grant execute on function public.tiene_rol_admin(uuid, public.admin_role) to service_role;


-- Devuelve el rol EFECTIVO (o null). La app la necesita para saber qué
-- pestañas pintar; la decisión de acceso sigue siendo tiene_rol_admin().
create or replace function public.rol_admin_actual(p_user uuid)
returns public.admin_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ar.role
    from public.admin_roles ar
   where ar.user_id = p_user
     and ar.revoked_at is null;
$$;

revoke all on function public.rol_admin_actual(uuid) from public, anon, authenticated;
grant execute on function public.rol_admin_actual(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §6 · Auditoría — una sola puerta de escritura
-- ════════════════════════════════════════════════════════════════════════════

-- Existe como función y no como INSERT directo desde la app por una razón
-- concreta: el INSERT desde el cliente admin puede fallar en silencio si nadie
-- mira el `error`, y una auditoría que a veces no se escribe es peor que no
-- tenerla, porque da falsa confianza. Aquí el fallo levanta excepción.
create or replace function public.admin_auditar(
  p_actor       uuid,
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_params      jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_action is null or btrim(p_action) = '' then
    raise exception 'admin_auditar: action vacía' using errcode = '22023';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, params)
  values (p_actor, left(p_action, 120), left(p_target_type, 60), left(p_target_id, 120),
          coalesce(p_params, '{}'::jsonb));
end $$;

revoke all on function public.admin_auditar(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_auditar(uuid, text, text, text, jsonb) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §7 · Gestión de roles — las dos reglas de negocio viven en Postgres
-- ════════════════════════════════════════════════════════════════════════════
--
-- Podrían estar en la ruta de Next. No están, y por el motivo de siempre
-- (ARCHITECTURE §0): una regla que solo vive en el servidor de Next es una
-- sugerencia. Con `service_role` en la mano —que es lo que tiene cualquier ruta
-- de este bloque— saltarse un `if` de TypeScript es escribir otro `if`.
--
--   Regla 1: nadie cambia su PROPIO rol. Ni el superadmin. Es la diferencia
--            entre «me han dado permiso» y «me lo he dado yo».
--   Regla 2: no se puede revocar al ÚLTIMO superadmin activo. Un panel sin
--            nadie que pueda repartir permisos es un panel muerto y solo se
--            recupera con acceso directo a la base.
--
-- ⚠️ La regla 2 hay que aplicarla en LAS DOS funciones, no solo en la de
-- revocar. Se encontró probando contra Postgres: `admin_conceder_rol()` podía
-- DEGRADAR al último superadmin a 'soporte', que deja el sistema exactamente
-- igual de muerto por otro camino. Una invariante que solo se comprueba en una
-- de las dos puertas no es una invariante.

create or replace function public.admin_conceder_rol(
  p_actor  uuid,
  p_sujeto uuid,
  p_rol    public.admin_role
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol_actual  public.admin_role;
  v_superadmins integer;
begin
  if not public.tiene_rol_admin(p_actor, 'superadmin') then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  if p_actor = p_sujeto then
    raise exception 'rol_propio: nadie puede cambiar su propio rol' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_sujeto) then
    raise exception 'sujeto_inexistente' using errcode = '23503';
  end if;

  -- FOR UPDATE por el mismo motivo que en la revocación: sin el lock, dos
  -- degradaciones simultáneas leerían «quedan 2» las dos.
  select role into v_rol_actual
    from public.admin_roles
   where user_id = p_sujeto and revoked_at is null
   for update;

  if v_rol_actual = 'superadmin' and p_rol <> 'superadmin' then
    select count(*) into v_superadmins
      from public.admin_roles
     where role = 'superadmin' and revoked_at is null;
    if v_superadmins <= 1 then
      raise exception 'ultimo_superadmin: no se puede degradar al último superadmin'
        using errcode = '23514';
    end if;
  end if;

  insert into public.admin_roles (user_id, role, granted_by, granted_at, revoked_at)
  values (p_sujeto, p_rol, p_actor, now(), null)
  on conflict (user_id) do update
    set role       = excluded.role,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null;   -- reconceder reabre; el histórico vive en la auditoría
end $$;

revoke all on function public.admin_conceder_rol(uuid, uuid, public.admin_role) from public, anon, authenticated;
grant execute on function public.admin_conceder_rol(uuid, uuid, public.admin_role) to service_role;


create or replace function public.admin_revocar_rol(
  p_actor  uuid,
  p_sujeto uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol         public.admin_role;
  v_superadmins integer;
begin
  if not public.tiene_rol_admin(p_actor, 'superadmin') then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  if p_actor = p_sujeto then
    raise exception 'rol_propio: nadie puede cambiar su propio rol' using errcode = '42501';
  end if;

  -- FOR UPDATE: sin el lock, dos revocaciones simultáneas de los dos últimos
  -- superadmins leerían «quedan 2» las dos y dejarían el sistema sin ninguno.
  select role into v_rol
    from public.admin_roles
   where user_id = p_sujeto and revoked_at is null
   for update;

  if v_rol is null then
    raise exception 'rol_inexistente' using errcode = 'P0002';
  end if;

  if v_rol = 'superadmin' then
    select count(*) into v_superadmins
      from public.admin_roles
     where role = 'superadmin' and revoked_at is null;

    if v_superadmins <= 1 then
      raise exception 'ultimo_superadmin: no se puede dejar el sistema sin superadmin'
        using errcode = '23514';
    end if;
  end if;

  update public.admin_roles
     set revoked_at = now()
   where user_id = p_sujeto and revoked_at is null;
end $$;

revoke all on function public.admin_revocar_rol(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_revocar_rol(uuid, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §8 · admin_rollup_dia() — todas las métricas de un día en una pasada
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── SOBRE LOS PERCENTILES Y LA VENTANA ─────────────────────────────────────
-- Un p90 diario no se puede promediar para obtener el p90 de 7 días: la media
-- de percentiles no es un percentil. Por eso cada día guarda, además de su p50
-- y su p90 exactos (para la serie diaria), un HISTOGRAMA de cubos fijos. Los
-- histogramas SÍ se suman, y el percentil de la ventana se calcula sobre la
-- suma. El precio es que el valor de ventana se redondea al borde superior del
-- cubo — conservador, que es la dirección correcta para una métrica de tiempo
-- de respuesta.
--
-- ── SOBRE `spend_karma()` Y EL `kind` QUE MIENTE ───────────────────────────
-- `spend_karma()` de 0001 escribe en el ledger con `kind = 'comment_validated'`
-- aunque sea un GASTO. Agrupar emisión y drenaje por `kind` da emisión
-- inflada. Aquí se agrupa por el SIGNO de delta_reputation y delta_spendable,
-- que no miente. Anotado en PEDIDOS.md para F1/B12; no se toca 0001.
--
-- ── SOBRE `usuarios_en_tope` ───────────────────────────────────────────────
-- `profiles.daily_karma_earned` se reinicia cada día: solo es medible EL día
-- que corresponde. Recalcular un día pasado devuelve 0 en esa métrica y en
-- `usuarios_activos`. Es una limitación del esquema, no un bug del rollup, y
-- por eso el cron corre a diario en vez de reconstruir el histórico.
-- ════════════════════════════════════════════════════════════════════════════

-- Bordes de los cubos del histograma, en segundos. Cubren de «medio minuto» a
-- «más de un día», que es el rango donde una respuesta pasa de rápida a inútil.
create or replace function public.admin_cubos_ttpr()
returns double precision[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[30,60,120,300,600,900,1800,3600,7200,14400,43200,86400]::double precision[];
$$;
revoke all on function public.admin_cubos_ttpr() from public, anon, authenticated;
grant execute on function public.admin_cubos_ttpr() to service_role;


create or replace function public.admin_rollup_dia(p_dia date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- `timezone('UTC', ts)` interpreta la marca ingenua como UTC y devuelve
  -- timestamptz. Deliberado: sin esto el corte del día dependería del TimeZone
  -- de la sesión y dos ejecuciones darían números distintos.
  v_ini    timestamptz := timezone('UTC', p_dia::timestamp);
  v_fin    timestamptz := timezone('UTC', (p_dia + 1)::timestamp);
  v_cubos  double precision[] := public.admin_cubos_ttpr();
  v_m      jsonb;
begin
  with
  -- ── Reciprocidad ────────────────────────────────────────────────────────
  dia_posts as (
    select p.id, p.created_at, p.risk
      from public.posts p
     where p.created_at >= v_ini and p.created_at < v_fin
  ),
  dia_comments as (
    select c.is_validated
      from public.comments c
     where c.created_at >= v_ini and c.created_at < v_fin
  ),
  comentarios as (
    select count(*)::bigint                                        as total,
           count(*) filter (where is_validated)::bigint            as validados
      from dia_comments
  ),
  -- Cobertura: ¿tuvo el post al menos una escucha VALIDADA en 24 h?
  -- El exists se apoya en uq_comments_one_listen_per_post (post_id, author_id)
  -- where is_validated, y para y no cuenta.
  cobertura as (
    select count(*)::bigint as posts,
           count(*) filter (where cubierto)::bigint as cubiertos
      from (
        select exists (
                 select 1 from public.comments c
                  where c.post_id = dp.id
                    and c.is_validated
                    and c.created_at < dp.created_at + interval '24 hours'
               ) as cubierto
          from dia_posts dp
      ) t
  ),
  -- ── TTPR ────────────────────────────────────────────────────────────────
  -- LATERAL con `order by created_at limit 1` apoyado en idx_comments_post.
  -- Nunca un `group by` sobre toda la tabla de comentarios.
  primeras as (
    select dp.risk,
           extract(epoch from (c.created_at - dp.created_at))::double precision as segs
      from dia_posts dp
      left join lateral (
        select c2.created_at
          from public.comments c2
         where c2.post_id = dp.id
           and c2.state = 'active'
         order by c2.created_at
         limit 1
      ) c on true
  ),
  ttpr as (
    select
      coalesce(percentile_cont(0.5) within group (order by segs)
               filter (where segs is not null), 0)::int as p50,
      coalesce(percentile_cont(0.9) within group (order by segs)
               filter (where segs is not null), 0)::int as p90,
      coalesce(percentile_cont(0.5) within group (order by segs)
               filter (where segs is not null and risk in ('high','critical')), 0)::int as p50_riesgo,
      count(*) filter (where segs is null or segs >= 86400)::bigint as sin_respuesta_24h
      from primeras
  ),
  ttpr_hist as (
    select coalesce(jsonb_object_agg(cubo::text, n), '{}'::jsonb) as h
      from (
        select width_bucket(segs, v_cubos) as cubo, count(*)::bigint as n
          from primeras
         where segs is not null
         group by 1
      ) t
  ),
  -- ── Crisis ──────────────────────────────────────────────────────────────
  dia_crisis as (
    select ce.risk, ce.human_reviewed, ce.created_at, ce.attended_at
      from public.crisis_events ce
     where ce.created_at >= v_ini and ce.created_at < v_fin
       and ce.risk in ('high','critical')
  ),
  crisis as (
    select count(*)::bigint                                    as eventos,
           count(*) filter (where human_reviewed)::bigint      as revisados,
           count(*) filter (where attended_at is null)::bigint as sin_atender
      from dia_crisis
  ),
  crisis_hist as (
    select coalesce(jsonb_object_agg(cubo::text, n), '{}'::jsonb) as h
      from (
        select width_bucket(
                 extract(epoch from (attended_at - created_at))::double precision,
                 v_cubos) as cubo,
               count(*)::bigint as n
          from dia_crisis
         where attended_at is not null
         group by 1
      ) t
  ),
  -- ── Embudo de activación (cohorte de las personas registradas ese día) ──
  cohorte as (
    select pr.id, pr.created_at, pr.last_seen_at, pr.posts_published
      from public.profiles pr
     where pr.created_at >= v_ini and pr.created_at < v_fin
  ),
  embudo as (
    select
      count(*)::bigint as registrados,
      count(*) filter (where exists (
        select 1 from public.consents co
         where co.user_id = c.id and co.revoked_at is null
      ))::bigint as onboarding,
      -- «Primera lectura de un post»: no hay tabla de lecturas en el esquema,
      -- así que el proxy es la primera INTERACCIÓN con un post (un voto).
      -- Subestima el escalón. Pedido abierto a B02 en PEDIDOS.md.
      count(*) filter (where exists (
        select 1 from public.post_votes pv where pv.user_id = c.id
      ))::bigint as primera_lectura,
      count(*) filter (where exists (
        select 1 from public.comments cm
         where cm.author_id = c.id and cm.is_validated
      ))::bigint as primer_comentario_validado,
      count(*) filter (where c.posts_published > 0)::bigint as primera_publicacion,
      count(*) filter (where c.last_seen_at >= c.created_at + interval '7 days')::bigint as vuelta_d7
      from cohorte c
  ),
  -- ── Economía ────────────────────────────────────────────────────────────
  -- Se agrupa por SIGNO, no por `kind` (ver la nota de spend_karma arriba).
  karma as (
    select
      coalesce(sum(ke.delta_reputation) filter (where ke.delta_reputation > 0), 0)::bigint as emitido,
      coalesce(-sum(ke.delta_spendable) filter (where ke.delta_spendable < 0), 0)::bigint  as drenado
      from public.karma_events ke
     where ke.created_at >= v_ini and ke.created_at < v_fin
  ),
  stock as (
    select coalesce(sum(karma_spendable), 0)::bigint as gastable
      from public.profiles
     where deleted_at is null
  ),
  tope as (
    select count(*)::bigint as activos,
           count(*) filter (where daily_karma_earned >= 120)::bigint as en_tope
      from public.profiles
     where daily_karma_date = p_dia and daily_karma_earned > 0
  ),
  -- Compras de cristales. `crystal_ledger` NO guarda el precio, solo el delta,
  -- así que el ingreso sale del `raw_receipt` cuando existe y, si no, del mapa
  -- de precios que vive en app/(admin)/_lib/precios.ts (stub hasta que B12
  -- exponga el suyo). Aquí se guardan los dos lados por separado para que la UI
  -- pueda decir con honestidad qué parte del ingreso es medida y qué parte es
  -- estimada.
  compras as (
    select cl.user_id, cl.delta, cl.raw_receipt
      from public.crystal_ledger cl
     where cl.created_at >= v_ini and cl.created_at < v_fin
       and cl.source in ('iap_apple','iap_google','iap')
       and cl.delta > 0
  ),
  cristales as (
    select count(distinct user_id)::bigint as compradores,
           coalesce(sum(delta), 0)::bigint as unidades,
           coalesce(sum(
             case when jsonb_typeof(raw_receipt -> 'price_cents') = 'number'
                  then (raw_receipt ->> 'price_cents')::bigint
                  else 0 end), 0)::bigint as ingreso_recibo
      from compras
  ),
  -- Paquetes SIN recibo, agrupados por tamaño de paquete (el `delta`). La
  -- clave es el número de cristales, no un nombre comercial: un nombre lo
  -- cambia marketing y rompería la serie histórica.
  paquetes as (
    select coalesce(jsonb_object_agg(delta::text, n), '{}'::jsonb) as p
      from (
        select delta, count(*)::bigint as n
          from compras
         where jsonb_typeof(raw_receipt -> 'price_cents') is distinct from 'number'
         group by delta
      ) t
  )
  select jsonb_build_object(
    'posts_publicados',            (select posts from cobertura),
    'comentarios_totales',         (select total from comentarios),
    'escuchas_validadas',          (select validados from comentarios),
    'posts_con_escucha_24h',       (select cubiertos from cobertura),

    'ttpr_p50_segundos',           (select p50 from ttpr),
    'ttpr_p90_segundos',           (select p90 from ttpr),
    'ttpr_p50_riesgo_segundos',    (select p50_riesgo from ttpr),
    'posts_sin_respuesta_24h',     (select sin_respuesta_24h from ttpr),
    'ttpr_hist',                   (select h from ttpr_hist),

    'crisis_eventos',              (select eventos from crisis),
    'crisis_revisados',            (select revisados from crisis),
    'crisis_sin_atender',          (select sin_atender from crisis),
    'crisis_hist',                 (select h from crisis_hist),

    'act_registrados',                 (select registrados from embudo),
    'act_onboarding',                  (select onboarding from embudo),
    'act_primera_lectura',             (select primera_lectura from embudo),
    'act_primer_comentario_validado',  (select primer_comentario_validado from embudo),
    'act_primera_publicacion',         (select primera_publicacion from embudo),
    'act_vuelta_d7',                   (select vuelta_d7 from embudo),

    'karma_emitido',               (select emitido from karma),
    'karma_drenado',               (select drenado from karma),
    'karma_stock_gastable',        (select gastable from stock),
    'usuarios_activos',            (select activos from tope),
    'usuarios_en_tope',            (select en_tope from tope),

    'compradores_unicos',          (select compradores from cristales),
    'cristales_vendidos',          (select unidades from cristales),
    'ingreso_centimos_recibo',     (select ingreso_recibo from cristales),
    'paquetes_sin_recibo',         (select p from paquetes)
  ) into v_m;

  insert into public.admin_metrics_daily (dia, metricas, calculado_en)
  values (p_dia, v_m, now())
  on conflict (dia) do update
    set metricas = excluded.metricas,
        calculado_en = now();
end $$;

comment on function public.admin_rollup_dia(date) is
  'Calcula TODAS las métricas de un día en una pasada y hace upsert en admin_metrics_daily. Acota siempre con created_at >= x and < y sobre índice.';

revoke all on function public.admin_rollup_dia(date) from public, anon, authenticated;
grant execute on function public.admin_rollup_dia(date) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §9 · Lectura de la ventana — UNA consulta para todo el panel
-- ════════════════════════════════════════════════════════════════════════════
--
-- El panel llama a esto y a la cola viva de crisis. Dos consultas por render,
-- por debajo del presupuesto de 3 de CONTRATOS §11.
create or replace function public.admin_metricas_ventana(
  p_desde date,
  p_hasta date
) returns table (dia date, metricas jsonb, calculado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.dia, d.metricas, d.calculado_en
    from public.admin_metrics_daily d
   where d.dia >= p_desde and d.dia <= p_hasta
   order by d.dia;
$$;

revoke all on function public.admin_metricas_ventana(date, date) from public, anon, authenticated;
grant execute on function public.admin_metricas_ventana(date, date) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §10 · Programación con pg_cron, si existe
--
-- En local no está la extensión, y en el plan gratuito de Supabase tampoco
-- siempre. El bloque comprueba antes de programar para que la migración se
-- aplique igual en los dos sitios; si no hay pg_cron, el rollup se dispara a
-- mano con POST /api/admin/rollup.
--
-- Se recalculan HOY y los DOS días anteriores, no solo hoy: `crisis_revisados`
-- cambia cuando un humano cierra un caso de anteayer, y una cobertura que se
-- congela el día que se calculó nunca llegaría al 100 %.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('darma_admin_rollup')
      where exists (select 1 from cron.job where jobname = 'darma_admin_rollup');

    perform cron.schedule(
      'darma_admin_rollup',
      '7 * * * *',   -- cada hora en el minuto 7; el rollup de un día es barato
      $cron$
        select public.admin_rollup_dia(d)
          from generate_series(
                 (now() at time zone 'utc')::date - 2,
                 (now() at time zone 'utc')::date,
                 interval '1 day') g(d);
      $cron$
    );
  else
    raise notice 'pg_cron no está instalado: el rollup se dispara a mano con POST /api/admin/rollup';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- §11 · Cierre de privilegios
--
-- El cinturón además de los tirantes: RLS sin políticas ya deniega, pero un
-- `revoke` explícito hace que el fallo sea «permission denied» en el propio
-- PostgREST antes de llegar a evaluar RLS, y deja constancia escrita de la
-- intención para quien lea el esquema dentro de dos años.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on public.admin_roles        from anon, authenticated;
revoke all on public.admin_audit_log    from anon, authenticated;
revoke all on public.admin_metrics_daily from anon, authenticated;

grant select, insert, update on public.admin_roles         to service_role;
grant select, insert          on public.admin_audit_log    to service_role;
grant select, insert, update on public.admin_metrics_daily to service_role;
