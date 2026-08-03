-- ============================================================================
-- B00 · integración · el registro y el arrendamiento de los despachadores.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- El plan Hobby de Vercel permite DOS crons y hay ocho trabajos que ejecutar.
-- La salida es un despachador: una ruta que corre la lista del día en orden,
-- con presupuesto por trabajo, y que aísla los fallos. Un despachador sin
-- registro es peor que no tenerlo: cuando alguien pregunte «¿se ejecutó el
-- borrado RGPD de esta persona el martes?» la respuesta no puede ser «el log de
-- Vercel se retiene 24 h». Por eso el resultado de CADA trabajo de CADA disparo
-- se persiste aquí.
--
-- SOLO SE AÑADE. No se toca ninguna migración anterior, ninguna política de
-- otro bloque, ninguna columna existente (CONTRATOS §12.2).
--
-- ── LA REGLA QUE MANDA EN `cron_runs.detalle` ──────────────────────────────
-- CONTEOS, NUNCA IDENTIDADES. Ni un uuid de persona, ni un alias, ni un id de
-- solicitud de privacidad, ni un fragmento del texto de nadie. «Se borraron 3
-- cuentas» es auditable; «se borró a 7f3a…» es una lista de quién se fue, que
-- es exactamente lo que `retired_aliases` y `privacy_requests` existen para NO
-- publicar. El rastro por persona ya vive en `privacy_requests.completed_at`,
-- que está bajo RLS sin políticas; este registro es el operativo, no el legal.
-- ============================================================================

-- ============================================================================
-- cron_runs — una fila por (disparo, trabajo). Append-only en la práctica: el
-- único DELETE que la toca es la purga de retención de abajo.
-- ============================================================================
create table if not exists public.cron_runs (
  id          bigint generated always as identity primary key,

  -- Qué despachador lo lanzó: 'diario', 'frecuente' o el nombre de una ruta
  -- suelta invocada a mano. Sin esto no se puede distinguir «el trabajo no
  -- corrió» de «el despachador entero no se disparó».
  despacho    text not null check (char_length(despacho) between 1 and 64),

  -- Identificador estable del trabajo ('rgpd-borrados', 'ranking-snapshot'…).
  -- Es CONTRATO: la consulta de auditoría agrupa por él.
  trabajo     text not null check (char_length(trabajo) between 1 and 64),

  -- 'ok'         → terminó y no quedaba nada pendiente.
  -- 'parcial'    → se agotó su presupuesto; dejó cursor y el disparo siguiente
  --                continúa. NO es un fallo.
  -- 'error'      → lanzó. Los trabajos siguientes SÍ se ejecutaron.
  -- 'sin_tiempo' → no llegó a arrancar porque el presupuesto de la función ya
  --                no daba para su mínimo. Se registra igual: un trabajo que no
  --                corre en silencio es la avería que este archivo existe para
  --                hacer visible.
  estado      text not null check (estado in ('ok', 'parcial', 'error', 'sin_tiempo')),

  iniciado_en timestamptz not null,
  ms          integer not null check (ms >= 0),

  -- Conteos agregados. Ver la regla de la cabecera.
  detalle     jsonb not null default '{}'::jsonb,

  creado_en   timestamptz not null default now()
);

comment on table public.cron_runs is
  'Registro operativo de los despachadores de cron: una fila por (disparo, trabajo) con su estado y sus conteos. RLS activa y CERO políticas: solo service_role. Nunca contiene identidades ni texto de personas.';

comment on column public.cron_runs.estado is
  'ok | parcial (queda trabajo, reanudable) | error (aislado, no bloqueó a los demás) | sin_tiempo (no arrancó: el presupuesto de la función no daba).';

-- «¿Qué corrió anoche?» — keyset descendente, igual que idx_admin_audit_keyset.
create index if not exists idx_cron_runs_keyset
  on public.cron_runs (creado_en desc, id desc);

-- «¿Cuándo fue la última vez que corrió el borrado RGPD, y con qué resultado?»
-- Es LA consulta de la auditoría de plazos legales y va por trabajo, no por
-- fecha global.
create index if not exists idx_cron_runs_trabajo
  on public.cron_runs (trabajo, creado_en desc);

-- «¿Qué se está quedando sin correr?» Parcial: ocupa lo que ocupan los fallos y
-- no crece con las ejecuciones normales, que son la inmensa mayoría.
create index if not exists idx_cron_runs_averias
  on public.cron_runs (creado_en desc)
  where estado in ('error', 'sin_tiempo');

alter table public.cron_runs enable row level security;
-- Sin políticas A PROPÓSITO, mismo patrón que admin_audit_log (0191) y
-- privacy_requests (0201): solo service_role. Qué mantenimiento corre y cuándo
-- es información de operación, no de producto.
revoke all on public.cron_runs from anon, authenticated;


-- ============================================================================
-- cron_leases — el arrendamiento que impide dos despachadores a la vez.
--
-- POR QUÉ HACE FALTA aunque todos los trabajos sean idempotentes: idempotente
-- no es lo mismo que concurrente. Dos pasadas simultáneas de `purgar_retencion`
-- compiten por los mismos `ctid`, dos `construirSnapshot` del mismo corte se
-- pisan el upsert, y dos reprocesos de moderación gastan el presupuesto del
-- clasificador por duplicado. Vercel reintenta un cron que devolvió 5xx o que
-- tardó demasiado, así que el solape no es hipotético.
--
-- POR QUÉ UN ARRENDAMIENTO CON CADUCIDAD Y NO UN `pg_advisory_lock`: el lock de
-- sesión de Postgres se libera cuando la conexión muere, y aquí no hay conexión
-- propia — se habla por PostgREST sobre un pool. Un arrendamiento con
-- `expira_en` se suelta SOLO aunque la función muera de golpe a los 60 s, que es
-- justo el caso que un lock mal soltado convertiría en «el cron no vuelve a
-- correr nunca y nadie se entera».
-- ============================================================================
create table if not exists public.cron_leases (
  nombre     text primary key check (char_length(nombre) between 1 and 64),
  expira_en  timestamptz not null,
  tomado_en  timestamptz not null default now()
);

comment on table public.cron_leases is
  'Arrendamiento con caducidad por despachador. Se suelta solo: si la función muere, el lease vence y el disparo siguiente entra.';

alter table public.cron_leases enable row level security;
-- Sin políticas a propósito.
revoke all on public.cron_leases from anon, authenticated;


-- ============================================================================
-- cron_tomar_lease — toma el arrendamiento SI está libre o vencido.
--
-- Es un solo `insert … on conflict do update … where` con `returning`: la
-- comprobación y la toma son la MISMA sentencia, así que dos disparos
-- simultáneos no pueden ganar los dos por mucho que lleguen a la vez. El mismo
-- patrón que `confirmar_borrado()` en 0201.
-- ============================================================================
create or replace function public.cron_tomar_lease(
  p_nombre    text,
  p_segundos  integer default 60
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_seg integer := greatest(5, least(coalesce(p_segundos, 60), 900));
  v_ok  boolean;
begin
  insert into public.cron_leases (nombre, expira_en, tomado_en)
  values (p_nombre, now() + make_interval(secs => v_seg), now())
  on conflict (nombre) do update
     set expira_en = excluded.expira_en,
         tomado_en = excluded.tomado_en
   where public.cron_leases.expira_en <= now()
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.cron_tomar_lease(text, integer) from public, anon, authenticated;
grant execute on function public.cron_tomar_lease(text, integer) to service_role;


-- ============================================================================
-- cron_soltar_lease — devuelve el arrendamiento al terminar.
--
-- Es una OPTIMIZACIÓN, no la garantía: la garantía es la caducidad. Soltarlo
-- solo evita esperar a que venza cuando el despacho termina antes de tiempo.
-- ============================================================================
create or replace function public.cron_soltar_lease(p_nombre text)
returns void
language sql
security definer
set search_path = pg_catalog, public, extensions
as $$
  update public.cron_leases set expira_en = now() where nombre = p_nombre;
$$;

revoke all on function public.cron_soltar_lease(text) from public, anon, authenticated;
grant execute on function public.cron_soltar_lease(text) to service_role;


-- ============================================================================
-- purgar_cron_runs — el registro también tiene retención.
--
-- Mismo patrón por lotes que `purgar_retencion()` en 0201: `where ctid in
-- (select ctid … limit N)`. Un `delete` sin `limit` sobre una tabla que crece
-- con cada disparo bloquea la tabla justo mientras el despachador la escribe.
--
-- 90 días: cubre el trimestre de auditoría y deja fuera el histórico eterno.
-- El rastro LEGAL de un borrado no vive aquí (vive en `privacy_requests`), así
-- que purgar esto no borra ninguna prueba de cumplimiento.
-- ============================================================================
create or replace function public.purgar_cron_runs(
  p_dias  integer default 90,
  p_lote  integer default 2000
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_dias integer := greatest(7, least(coalesce(p_dias, 90), 3650));
  v_lote integer := greatest(1, least(coalesce(p_lote, 2000), 10000));
  v_n    integer;
begin
  delete from public.cron_runs
   where ctid in (
     select c.ctid from public.cron_runs c
      where c.creado_en < now() - make_interval(days => v_dias)
      limit v_lote
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purgar_cron_runs(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_cron_runs(integer, integer) to service_role;
