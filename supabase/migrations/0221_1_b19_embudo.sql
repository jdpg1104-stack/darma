-- ============================================================================
-- B19 · 0221_1 · El rollup del embudo: vuelta al día siguiente y pilar 1
--
-- ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
-- El hallazgo del crítico: el dueño no puede ver si el embudo funciona — nada
-- mide la activación de verdad ni el éxito del pilar 1 (Ánimo). Y las dos
-- cosas que faltan NO se pueden derivar de `admin_metrics_daily`:
--
--   1. «¿Volvió al día siguiente?» El rollup de 0191 guarda `act_vuelta_d7`
--      (last_seen_at ≥ registro + 7 días), pero su cron solo recalcula HOY y
--      dos días atrás — y el trabajo de la app (lib/cron/trabajos/tablero.ts)
--      solo HOY, porque dos métricas de 0191 (`usuarios_activos`,
--      `usuarios_en_tope`) leen `daily_karma_earned`, que se reinicia a diario
--      y se PISA con ceros al recalcular hacia atrás. Consecuencia: una cohorte
--      evaluada como mucho 48 h después de nacer nunca puede tener una vuelta
--      en D7 — el escalón está congelado en 0. Anotado como pedido; aquí no se
--      toca 0191.
--
--   2. El pilar 1: vídeos completados por día y personas distintas que
--      completaron. `content_views` es la tabla más grande de la app (personas
--      × ítems, ver 0002) y el panel tiene PROHIBIDA la agregación en vivo
--      sobre tablas que crecen sin límite (`_lib/dashboard.ts`).
--
-- La salida es el MISMO patrón que 0191: una tabla de rollup con una fila por
-- día, una función que la calcula acotando SIEMPRE por rango sobre un índice,
-- una función de lectura de ventana, y pg_cron si existe. SIN NINGÚN TRACKING
-- NUEVO: todo sale de datos que ya se escriben hoy, y la salida son agregados
-- por día — ni una fila por persona.
--
-- ── POR QUÉ UNA TABLA APARTE Y NO CLAVES NUEVAS EN admin_metrics_daily ─────
-- `admin_rollup_dia()` (0191) hace upsert con `metricas = excluded.metricas`:
-- REEMPLAZA el jsonb entero. Cualquier clave que otra función mezclara ahí se
-- borraría en el minuto 7 de cada hora para hoy y los dos días anteriores. Una
-- tabla propia no compite con nadie.
--
-- ── POR QUÉ ESTE ROLLUP SÍ PUEDE RECALCULAR HACIA ATRÁS ────────────────────
-- Ninguna de sus métricas lee estado «de hoy»: `completed_at`, `created_at` y
-- los eventos de D1 son historia inmutable, y `last_seen_at` solo crece — al
-- recalcular, la cota superior de la vuelta mejora, nunca se corrompe. Por eso
-- el cron recorre 9 días (hoy y 8 atrás): la ventana D1 de una cohorte se
-- cierra 48 h después de nacer, y la cota tiene una semana para asentarse.
--
-- ADITIVA. No modifica ni una línea de 0001–0216. Como sus vecinas, esta
-- migración SOLO SE ESCRIBE: no se aplica a ninguna base en esta sesión.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- §1 · La tabla de rollup del embudo — RLS activa y CERO políticas
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_embudo_daily (
  dia          date primary key,
  metricas     jsonb not null,
  calculado_en timestamptz not null default now()
);

comment on table public.admin_embudo_daily is
  'Una fila por día con el embudo de activación (vuelta D1) y el pilar 1 (vídeos completados). El panel lee de aquí y nunca de content_views. Mismo patrón que admin_metrics_daily: RLS activa y CERO políticas — solo service_role.';

alter table public.admin_embudo_daily enable row level security;
-- Sin políticas a propósito: los agregados de una red de apoyo emocional no
-- son públicos ni siquiera en forma de conteo. Igual que admin_metrics_daily.

revoke all on public.admin_embudo_daily from anon, authenticated;
grant select, insert, update on public.admin_embudo_daily to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §2 · El índice que el rollup necesita para NO hacer Seq Scan
-- ════════════════════════════════════════════════════════════════════════════

-- select count(*), count(distinct user_id)
--   from content_views where completed_at >= x and completed_at < y
--
-- `idx_content_views_user` (0002) es por (user_id, created_at) y no sirve para
-- cortar por fecha GLOBAL de completado. Parcial por `completed_at is not null`
-- (el rango lo implica) para no pagar el índice en cada vista empezada y no
-- terminada; el INCLUDE convierte el count(distinct) en un Index Only Scan.
create index if not exists idx_content_views_completadas_dia
  on public.content_views (completed_at) include (user_id)
  where completed_at is not null;

comment on index public.idx_content_views_completadas_dia is
  'Consumidor único: admin_rollup_embudo_dia() (0221), que cuenta completados y personas distintas por día. Corta siempre por completed_at >= x and < y.';


-- ════════════════════════════════════════════════════════════════════════════
-- §3 · admin_rollup_embudo_dia() — las métricas del embudo en una pasada
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── QUÉ SIGNIFICA CADA CLAVE, Y QUÉ NO ─────────────────────────────────────
--
--   act_registrados          Personas cuyo perfil nació ese día. Se guarda
--                            también aquí (además de en 0191) para que esta
--                            tabla se lea sola: la tasa de vuelta D1 no debe
--                            depender de que el OTRO rollup haya corrido.
--
--   act_vuelta_d1_actividad  De esa cohorte, quienes dejaron actividad MEDIBLE
--                            en su segundo día de vida (registro +24 h..+48 h):
--                            una vista de contenido o un evento de karma.
--                            SUBESTIMA: quien vuelve y solo lee no deja rastro.
--                            No hay tabla de sesiones y no se añade tracking
--                            nuevo; el límite se documenta en la UI.
--
--   act_vuelta_d1_cota       Cota superior: last_seen_at ≥ registro + 1 día,
--                            es decir «fue visto en algún momento después de
--                            su primer día». Cuenta también a quien volvió el
--                            día 5. La vuelta real vive entre las dos cifras.
--
--   videos_completados       Completados del día (eventos, no personas): cada
--                            fila de content_views con completed_at ese día.
--                            La PK (content_id, user_id) de 0002 garantiza un
--                            completado por persona y vídeo — no hay farmeo
--                            que infle esto.
--
--   personas_completaron     Personas DISTINTAS que completaron algo ese día.
--                            Distinto por día: sumar días sobrecuenta a quien
--                            completó dos días distintos (misma cota superior
--                            consciente que compradores_unicos en 0191).
--
-- Los exists de D1 se apoyan en índices que ya existen: idx_content_views_user
-- (0002) e idx_karma_events_user (0001), ambos (user_id, created_at desc). La
-- cohorte sale de idx_profiles_rollup_dia (0191). Nada escanea una tabla.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_rollup_embudo_dia(p_dia date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- `timezone('UTC', ts)` interpreta la marca ingenua como UTC y devuelve
  -- timestamptz. Mismo motivo que en 0191: sin esto el corte del día
  -- dependería del TimeZone de la sesión.
  v_ini timestamptz := timezone('UTC', p_dia::timestamp);
  v_fin timestamptz := timezone('UTC', (p_dia + 1)::timestamp);
  v_m   jsonb;
begin
  with
  cohorte as (
    select pr.id, pr.created_at, pr.last_seen_at
      from public.profiles pr
     where pr.created_at >= v_ini and pr.created_at < v_fin
  ),
  d1 as (
    select
      count(*)::bigint as registrados,
      count(*) filter (
        where c.last_seen_at >= c.created_at + interval '1 day'
      )::bigint as cota,
      count(*) filter (where
        exists (
          select 1 from public.content_views cv
           where cv.user_id = c.id
             and cv.created_at >= c.created_at + interval '1 day'
             and cv.created_at <  c.created_at + interval '2 days'
        )
        or exists (
          select 1 from public.karma_events ke
           where ke.user_id = c.id
             and ke.created_at >= c.created_at + interval '1 day'
             and ke.created_at <  c.created_at + interval '2 days'
        )
      )::bigint as actividad
      from cohorte c
  ),
  pilar1 as (
    select count(*)::bigint                  as completados,
           count(distinct cv.user_id)::bigint as personas
      from public.content_views cv
     where cv.completed_at >= v_ini and cv.completed_at < v_fin
  )
  select jsonb_build_object(
    'act_registrados',         (select registrados from d1),
    'act_vuelta_d1_actividad', (select actividad   from d1),
    'act_vuelta_d1_cota',      (select cota        from d1),
    'videos_completados',      (select completados from pilar1),
    'personas_completaron',    (select personas    from pilar1)
  ) into v_m;

  insert into public.admin_embudo_daily (dia, metricas, calculado_en)
  values (p_dia, v_m, now())
  on conflict (dia) do update
    set metricas     = excluded.metricas,
        calculado_en = now();
end $$;

comment on function public.admin_rollup_embudo_dia(date) is
  'Rollup del embudo (vuelta D1) y del pilar 1 (vídeos completados) de UN día. A diferencia de admin_rollup_dia (0191), es seguro recalcular días pasados: ninguna métrica lee estado «de hoy». Acota siempre por rango sobre índice.';

revoke all on function public.admin_rollup_embudo_dia(date) from public, anon, authenticated;
grant execute on function public.admin_rollup_embudo_dia(date) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §4 · Lectura de la ventana — misma forma que admin_metricas_ventana (0191)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_embudo_ventana(
  p_desde date,
  p_hasta date
) returns table (dia date, metricas jsonb, calculado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.dia, d.metricas, d.calculado_en
    from public.admin_embudo_daily d
   where d.dia >= p_desde and d.dia <= p_hasta
   order by d.dia;
$$;

revoke all on function public.admin_embudo_ventana(date, date) from public, anon, authenticated;
grant execute on function public.admin_embudo_ventana(date, date) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- §5 · Programación con pg_cron, si existe
--
-- Minuto 29, lejos del minuto 7 del rollup de 0191: dos rollups a la vez
-- compiten por el mismo I/O sin ninguna necesidad.
--
-- Se recorren HOY y los OCHO días anteriores (ver la cabecera). Si no hay
-- pg_cron, este rollup necesita que el despachador de la app lo dispare
-- (pedido anotado para lib/cron): mientras tanto, los días sin fila se pintan
-- como 0 en el panel y la página lo dice.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('darma_admin_rollup_embudo')
      where exists (select 1 from cron.job where jobname = 'darma_admin_rollup_embudo');

    perform cron.schedule(
      'darma_admin_rollup_embudo',
      '29 * * * *',
      $cron$
        select public.admin_rollup_embudo_dia(d::date)
          from generate_series(
                 (now() at time zone 'utc')::date - 8,
                 (now() at time zone 'utc')::date,
                 interval '1 day') g(d);
      $cron$
    );
  else
    raise notice 'pg_cron no está instalado: admin_rollup_embudo_dia() queda a la espera del despachador de la app (pedido a lib/cron).';
  end if;
end $$;
