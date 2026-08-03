-- ============================================================================
-- Darma · B06 · `max(uuid)` no existe en Postgres 17
--
-- SÍNTOMA: la primera llamada real a `construir_ranking_snapshot()` murió con
--   ERROR 42883: function max(uuid) does not exist
-- El constructor no llegó a escribir ni una fila. No se vio leyendo el SQL:
-- `max()` está definido para casi todo tipo con orden total, y `uuid` lo tiene.
-- Resulta que el agregado para `uuid` se añadió en PostgreSQL 18, y `darma-dev`
-- corre 17.6.
--
-- ARREGLO: comparar sobre la forma canónica en TEXTO. Da exactamente el mismo
-- orden, y esto no es una casualidad afortunada sino una propiedad del formato:
-- un `uuid` se compara byte a byte y su texto es el hexadecimal en minúsculas
-- de esos mismos bytes, con los guiones siempre en las mismas posiciones. El
-- orden lexicográfico del texto y el orden binario del uuid coinciden.
--
-- Que coincidan es lo único que importa aquí: este valor sale de la función
-- como `ultimo_usuario`, vuelve en el siguiente disparo como `p_desde_usuario`
-- y tiene que cuadrar con el `order by c.user_id` del lote y con el `>` del
-- keyset de continuación. Si el orden fuera otro, el constructor se saltaría
-- personas al reanudar y nadie lo notaría: la foto simplemente saldría
-- incompleta.
--
-- No se modifica `0106_1`: ya está aplicada. Solo se reemplaza la función.
-- ============================================================================

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
       and not p.shadow_banned
       and (p.banned_until is null or p.banned_until < now())
     group by ld.user_id
    having sum(least(ld.listens, p_listens_dia_max)) > 0
  ),
  clasificado as (
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
    returning ranking_snapshots.user_id as escrito_user_id
  )
  select count(*)::int, max(e.escrito_user_id::text)::uuid into v_filas, v_ultimo from escrito e;

  if v_filas < p_max_filas then
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
