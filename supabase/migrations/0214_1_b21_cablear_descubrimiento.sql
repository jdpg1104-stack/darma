-- ============================================================================
-- Darma · 0214_1 · B21 · Cablear el descubrimiento: cupo diario persistente
--
-- Con esta migración el orquestador (lib/ingest/ejecutar.ts) pasa a leer las
-- fuentes de YouTube por la Data API (`playlistItems.list`, 1 unidad) además
-- del feed Atom. Dos piezas:
--
--   1. `ingest_youtube_quota` + sus dos funciones — el cupo diario PERSISTENTE
--      de unidades de la Data API. El contador por corrida de
--      lib/ingest/cuota.ts corta antes de agotar, pero vive en memoria: no
--      sobrevive a un reinicio ni a dos instancias solapadas (el hueco quedó
--      anotado a propósito en PEDIDOS.md, «cupo diario persistente»). Mismo
--      patrón que `ingest_model_budget` en 0108: una fila por día, todo el
--      trabajo en un solo statement con lock de fila.
--
--   2. Re-afirmación IDEMPOTENTE del CHECK de `ingest_log.decision` con
--      `rejected_language` y `rejected_channel`. Los añadió 0212 y esta
--      migración NO amplía la lista — se re-afirma porque el cableado que llega
--      con este bloque ESCRIBE esos valores en cada corrida: si una base se
--      quedara sin 0212 (el hueco que PEDIDOS.md describe como «los rechazos
--      por idioma se registran con causas que mienten»), cada rechazo por
--      idioma fallaría el insert del log en silencio y la idempotencia de
--      segundo nivel repetiría las guardas —y su cuota— para siempre. Sobre una
--      base con 0212 aplicada, el resultado es byte a byte el mismo CHECK.
--
-- POR QUÉ RESERVAR/DEVOLVER Y NO «UNA UNIDAD POR LLAMADA»: un round-trip a
-- Postgres por cada unidad costaría más tiempo del que ahorra (ya razonado en
-- cuota.ts). El reparto es: la corrida RESERVA su presupuesto entero al empezar
-- (una llamada), decide en memoria llamada a llamada, y DEVUELVE el sobrante al
-- terminar (otra llamada). Si el proceso muere a mitad, el sobrante no se
-- devuelve y el día pierde cupo contable: fail-closed — el error nunca puede
-- llevar a gastar de más, solo de menos.
--
-- ADITIVA. No toca filas ni restringe nada que hoy sea válido.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ingest_youtube_quota — gasto diario de unidades de la Data API, POR CLAVE DE
-- PROYECTO. El tope lo pasa el llamador (TOPE_DIARIO_PERSISTENTE en cuota.ts:
-- 2.400 de las 10.000 unidades/día, porque la clave HOY es compartida con
-- DataLaps y Darma no debe poder dejarla a cero por su cuenta).
-- ----------------------------------------------------------------------------
create table public.ingest_youtube_quota (
  day   date primary key,
  units integer not null default 0 check (units >= 0)
);

comment on table public.ingest_youtube_quota is
  'Unidades de la YouTube Data API reservadas por día. Se puede truncar sin pérdida: solo reabre el cupo del día. El corte por corrida vive en lib/ingest/cuota.ts; esta tabla es el techo que sobrevive a reinicios e instancias solapadas.';

-- Reserva hasta p_unidades del cupo del día, sin pasar de p_tope. Devuelve las
-- CONCEDIDAS: min(pedidas, tope - gastadas), nunca negativo. Todo dentro de la
-- misma transacción: el `insert ... on conflict do update` toma el lock de la
-- fila del día, así que dos corridas solapadas se serializan aquí y no pueden
-- conceder el mismo resto dos veces (misma técnica que ingest_consume_model_budget).
create or replace function public.ingest_reservar_cuota_youtube(p_unidades integer, p_tope integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gastadas   integer;
  v_concedidas integer;
begin
  -- Entradas absurdas conceden 0, jamás «sin límite»: fail-closed, igual que
  -- enteroNoNegativo() en cuota.ts.
  if p_unidades is null or p_unidades <= 0 or p_tope is null or p_tope <= 0 then
    return 0;
  end if;

  insert into public.ingest_youtube_quota (day, units)
  values (current_date, 0)
  on conflict (day) do update
     set units = ingest_youtube_quota.units  -- no-op que toma el lock de fila
  returning units into v_gastadas;

  v_concedidas := greatest(0, least(p_unidades, p_tope - v_gastadas));
  if v_concedidas > 0 then
    update public.ingest_youtube_quota
       set units = units + v_concedidas
     where day = current_date;
  end if;

  return v_concedidas;
end;
$$;

comment on function public.ingest_reservar_cuota_youtube(integer, integer) is
  'Reserva unidades del cupo diario de la Data API. Concede min(pedidas, tope - gastadas). El sobrante se devuelve con ingest_devolver_cuota_youtube al final de la corrida.';

-- Devuelve al día unidades reservadas y no gastadas. `greatest(0, …)` porque
-- una corrida que cruza la medianoche devolvería contra un día que no reservó:
-- mejor un cupo del día nuevo intacto que uno negativo. Best-effort declarado.
create or replace function public.ingest_devolver_cuota_youtube(p_unidades integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_unidades is null or p_unidades <= 0 then
    return;
  end if;

  update public.ingest_youtube_quota
     set units = greatest(0, units - p_unidades)
   where day = current_date;
end;
$$;

comment on function public.ingest_devolver_cuota_youtube(integer) is
  'Devuelve al cupo del día lo reservado y no gastado. Si la corrida murió sin devolver, el día pierde cupo contable: el error solo puede gastar de menos, nunca de más.';

-- ----------------------------------------------------------------------------
-- RLS y privilegios: activada y SIN políticas + revoke, el mismo patrón
-- deliberado de las cuatro tablas de 0108. Solo service_role.
-- ----------------------------------------------------------------------------
alter table public.ingest_youtube_quota enable row level security;
revoke all on public.ingest_youtube_quota from anon, authenticated;

revoke all on function public.ingest_reservar_cuota_youtube(integer, integer) from public, anon, authenticated;
grant execute on function public.ingest_reservar_cuota_youtube(integer, integer) to service_role;

revoke all on function public.ingest_devolver_cuota_youtube(integer) from public, anon, authenticated;
grant execute on function public.ingest_devolver_cuota_youtube(integer) to service_role;

-- ----------------------------------------------------------------------------
-- Re-afirmación del CHECK de ingest_log.decision (ver punto 2 de la cabecera).
-- Idéntico al que dejó 0212: sobre una base al día es un no-op funcional; sobre
-- una base sin 0212, repara el hueco antes de que el cableado escriba en él.
-- ----------------------------------------------------------------------------
alter table public.ingest_log
  drop constraint if exists ingest_log_decision_check;

alter table public.ingest_log
  add constraint ingest_log_decision_check
  check (decision in (
    'inserted',
    'duplicate',
    'rejected_safety',
    'rejected_embed',
    'rejected_quality',
    'rejected_language',
    'rejected_channel',
    'error'
  ));

comment on constraint ingest_log_decision_check on public.ingest_log is
  'Motivos cerrados de decisión de ingesta. rejected_language y rejected_channel llegaron con B21 (0212; re-afirmado en 0214 al cablear el descubrimiento): ver la cabecera de 0212_1_b21_decision_ingesta.sql para por qué no se reutilizaron los existentes.';
