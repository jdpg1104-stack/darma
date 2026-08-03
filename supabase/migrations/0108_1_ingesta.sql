-- ============================================================================
-- Darma · 0108_1 · B08 · Estado del proceso de ingesta de contenido curado
--
-- `content_items` ya existe (0002, sección 3) y NO tiene ni tendrá política de
-- escritura: nadie sube contenido desde el cliente. Lo que falta —y lo que
-- añade esta migración— es el ESTADO DEL PROCESO que la llena:
--
--   · ingest_sources       — el catálogo de orígenes, para poder pausar una
--                            fuente en producción sin desplegar.
--   · ingest_log           — qué se vio y qué se decidió, incluido lo que NO
--                            entró. Es la idempotencia de segundo nivel.
--   · ingest_state         — un par clave/valor para cursores que no cuelgan de
--                            una fuente (el barrido de reverificación).
--   · ingest_model_budget  — tope DURO de llamadas al modelo de moderación por
--                            día, atómico y compartido entre invocaciones.
--
-- Las cuatro tablas: RLS activada y CERO políticas, más `revoke all` a
-- anon/authenticated. Mismo patrón deliberado que identity_vault (0001) y
-- moderation_flags (0002): son infraestructura del servidor. Solo service_role.
--
-- ADITIVA. No toca ni una línea de 0001 ni de 0002.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ingest_sources — el catálogo de orígenes.
--
-- POR QUÉ EN TABLA Y NO EN UNA CONSTANTE DE TYPESCRIPT: cuando una fuente
-- empieza a devolver basura a las 3 de la mañana, `update ingest_sources set
-- enabled = false` la corta en un segundo. Una constante en el código exige un
-- despliegue, y un despliegue a las 3 de la mañana es cuando se rompen cosas.
-- La semilla vive en lib/ingest/fuentes.ts y se aplica con upsert por `key`,
-- que NO pisa `enabled`: lo que un humano apagó a mano sigue apagado.
-- ----------------------------------------------------------------------------
create table public.ingest_sources (
  key            text primary key,          -- 'yt:who', 'rss:nimh'
  kind           text not null check (kind in ('youtube_playlist','youtube_channel','rss')),
  handle         text not null,             -- id de playlist/canal o url del feed
  -- Mismo CHECK que content_items.language: si aquí cupiera 'es-419', el
  -- heredarlo rompería el insert del ítem al otro lado del pipeline.
  language       text not null check (language ~ '^[a-z]{2}$'),
  topic          text,
  enabled        boolean not null default true,

  -- Reanudación. Para los feeds (Atom de YouTube y RSS) es el `published_at`
  -- ISO-8601 del ítem más nuevo ya ingerido: monótono creciente, así que un
  -- corte por presupuesto no repite nada y lo nuevo del día siguiente sigue
  -- entrando por ser estrictamente mayor.
  cursor         text,

  last_run_at    timestamptz,
  last_ok_at     timestamptz,
  consecutive_failures smallint not null default 0,
  -- Backoff: hasta cuándo NO se debe volver a llamar a esta fuente. Lo calcula
  -- siguienteEspera() en TypeScript (exponencial CON jitter) y se persiste aquí
  -- para que sobreviva al final de la invocación serverless — un backoff en
  -- memoria de proceso no existe: la siguiente ejecución es otra máquina.
  cooldown_until timestamptz,
  -- Por qué se deshabilitó (404, feed inválido…). Sin secretos ni URLs con clave.
  disabled_reason text,

  created_at     timestamptz not null default now()
);

comment on table public.ingest_sources is
  'Catálogo de orígenes de la ingesta. Decenas de filas, no millones: la PK basta y NO necesita más índices. La consulta real es "enabled and (cooldown_until is null or cooldown_until <= now()) order by coalesce(last_run_at, ''epoch'') limit N", que sobre esta cardinalidad es un seq scan trivial y correcto.';

comment on column public.ingest_sources.cursor is
  'published_at ISO-8601 del ítem más nuevo ya ingerido. Monótono creciente: la reanudación no repite y lo nuevo sigue entrando.';

-- ----------------------------------------------------------------------------
-- ingest_log — auditoría e idempotencia de segundo nivel.
--
-- content_items solo guarda lo que ENTRÓ. Sin esta tabla, un vídeo rechazado
-- por el filtro de seguridad se volvería a descargar, a clasificar y a PAGAR al
-- modelo de moderación en cada ejecución del cron, para siempre.
-- `uq_ingest_log_seen` convierte esa comprobación en una sonda por índice único.
-- ----------------------------------------------------------------------------
create table public.ingest_log (
  id          bigint generated always as identity primary key,
  source_key  text not null references public.ingest_sources(key) on delete cascade,
  platform    text not null,
  external_id text not null,
  decision    text not null check (decision in ('inserted','duplicate','rejected_safety','rejected_embed','rejected_quality','error')),
  -- Motivo legible por un humano de operaciones. NUNCA la respuesta del
  -- upstream ni una URL con clave en la query: solo un identificador de motivo.
  reason      text,
  created_at  timestamptz not null default now()
);

comment on table public.ingest_log is
  'Qué se vio y qué se decidió, incluido lo rechazado. Sobrevive al rechazo; content_items no. Se purga a 90 días desde la ruta de reverificación.';

create unique index uq_ingest_log_seen on public.ingest_log (platform, external_id);
comment on index public.uq_ingest_log_seen is
  'Idempotencia de segundo nivel: "¿ya decidí sobre este candidato?" es una sonda por índice único, no un scan. Evita re-analizar —y re-pagar— lo ya rechazado.';

create index idx_ingest_log_recent on public.ingest_log (created_at desc);
comment on index public.idx_ingest_log_recent is
  'Panel de operación ("últimas decisiones") y purga por antigüedad: where created_at < now() - interval ''90 days''.';

-- ----------------------------------------------------------------------------
-- ingest_state — cursores que no pertenecen a ninguna fuente.
--
-- El barrido de reverificación pagina por keyset sobre content_items.id y su
-- cursor no cuelga de un origen concreto. Meterlo en ingest_sources habría
-- obligado a una fila falsa que violara el CHECK de `kind`.
-- ----------------------------------------------------------------------------
create table public.ingest_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

comment on table public.ingest_state is
  'Cursores del proceso que no cuelgan de una fuente. Hoy: ''reverify:cursor'' (uuid del último content_item reverificado).';

-- ----------------------------------------------------------------------------
-- ingest_model_budget — tope duro de llamadas al modelo, POR DÍA.
--
-- El tope por ejecución vive en TypeScript, pero solo limita una invocación.
-- Vercel puede solapar dos ejecuciones del mismo cron si una tarda más que su
-- intervalo, y hay tres crons distintos. El único techo de verdad es un
-- contador compartido y transaccional, igual que rate_limits en 0002.
-- ----------------------------------------------------------------------------
create table public.ingest_model_budget (
  day   date primary key,
  calls integer not null default 0
);

comment on table public.ingest_model_budget is
  'Gasto diario en el proveedor de moderación. Se puede truncar sin pérdida: solo reabre el cupo del día.';

-- Consume UNA llamada si queda cupo. Todo (leer, decidir, incrementar) ocurre
-- en un solo statement: `insert ... on conflict do update` toma el lock de la
-- fila, así que dos ejecuciones solapadas no pueden leer el mismo contador y
-- escribir el mismo valor. Un SELECT seguido de UPDATE sí tendría esa carrera y
-- el tope se podría duplicar exactamente cuando más carga hay.
create or replace function public.ingest_consume_model_budget(p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_calls integer;
begin
  if p_max <= 0 then
    return false;
  end if;

  insert into public.ingest_model_budget (day, calls)
  values (current_date, 1)
  on conflict (day) do update
     set calls = ingest_model_budget.calls + 1
  returning ingest_model_budget.calls into v_calls;

  -- true = había cupo. La llamada que hace exactamente p_max todavía pasa.
  return v_calls <= p_max;
end;
$$;

revoke all on function public.ingest_consume_model_budget(integer) from public, anon, authenticated;
grant execute on function public.ingest_consume_model_budget(integer) to service_role;

-- ============================================================================
-- RLS — activada y SIN NINGUNA POLÍTICA. En Postgres eso es denegado total para
-- anon y authenticated; service_role la salta por definición. Los revokes son
-- el cinturón además del tirante: si algún día alguien añadiera una política
-- por error, sin privilegio de tabla seguiría sin poder tocar nada.
-- ============================================================================
alter table public.ingest_sources      enable row level security;
alter table public.ingest_log          enable row level security;
alter table public.ingest_state        enable row level security;
alter table public.ingest_model_budget enable row level security;

revoke all on public.ingest_sources      from anon, authenticated;
revoke all on public.ingest_log          from anon, authenticated;
revoke all on public.ingest_state        from anon, authenticated;
revoke all on public.ingest_model_budget from anon, authenticated;
