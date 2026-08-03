-- ============================================================================
-- Darma · B06 · Los empates tienen que empatar de verdad
--
-- CÓMO SE ENCONTRÓ: no leyendo el SQL, sino mirando el resultado de la primera
-- construcción real. Con 97 696 personas sembradas, la foto salió con
--
--     count(*) = 97 696   y   max(rank) = 97 696
--
-- es decir, CERO empates en toda la tabla. Con una métrica entera y acotada
-- —las escuchas de un periodo, con techo diario de 12— eso es imposible: hay
-- como mucho unas decenas de valores distintos y cien mil personas repartidas
-- entre ellos.
--
-- CAUSA: el SQL de la ficha B06 escribe
--
--     dense_rank() over (order by a.listens desc, a.user_id)
--
-- Con `user_id` DENTRO del `order by` de la ventana no hay dos filas
-- equivalentes jamás, así que `dense_rank()` se comporta exactamente igual que
-- `row_number()`. El efecto de producto es el que importa: dos personas que han
-- acompañado a la misma cantidad de gente reciben puestos distintos, y quién va
-- delante lo decide su uuid — un sorteo, presentado como mérito, en la única
-- pantalla de la app donde se compara a la gente entre sí.
--
-- ARREGLO: separar las dos cosas que el `order by` de la ficha mezclaba.
--   · el PUESTO depende solo de las escuchas   → `over (order by listens desc)`
--   · el ORDEN necesita ser estable entre ejecuciones y permitir avanzar el
--     keyset                                    → `user_id`, en el `order by`
--     del lote y en `idx_ranking_board`, que es donde le corresponde.
--
-- Tras el arreglo, medido sobre el mismo corte: el puesto 1 lo comparten 13 786
-- personas, todas con 36 escuchas. Y ESE es el número que explica por qué
-- `0106_1` ya paginaba por la tupla `(rank, user_id)` en vez de por `rank`
-- solo: con el keyset de la ficha (`where rank > :cursor_rank`), la página 1
-- cierra dentro del grupo del puesto 1 y las 13 766 personas restantes
-- desaparecen del tablero sin que nada lo indique. Medido en otro corte de
-- 100 003 personas: 2 142 personas perdidas justo después de la primera página.
--
-- No se modifica `0106_1` ni `0106_2`: ya están aplicadas. Solo se reemplaza la
-- función.
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
       -- numeración y sabría que está silenciado.
       and not p.shadow_banned
       and (p.banned_until is null or p.banned_until < now())
     group by ld.user_id
    having sum(least(ld.listens, p_listens_dia_max)) > 0
  ),
  clasificado as (
    -- EL ARREGLO. `user_id` fuera de la ventana: el puesto lo deciden las
    -- escuchas y solo las escuchas.
    select a.user_id, a.listens,
           dense_rank() over (order by a.listens desc)::int as rank
      from agregado a
  ),
  lote as (
    -- Y aquí sigue `user_id`, que es donde hace falta: fija un orden total y
    -- estable para que el lote sea reanudable.
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

  -- Lote incompleto = ya no queda nadie después: la foto está cerrada.
  if v_filas < p_max_filas then
    -- Limpieza de filas que sobran. Sin esto, quien fue silenciado DESPUÉS de
    -- entrar en la foto se quedaría dentro para siempre (el `insert` nunca lo
    -- volvería a tocar), y una validación retirada por moderación dejaría un
    -- puesto ganado con escuchas que ya no existen. Verificado contra Postgres:
    -- al silenciar a alguien que ya estaba en la foto y reconstruir, desaparece
    -- y la numeración que queda sigue siendo contigua.
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

-- ── Nota operativa medida durante la verificación ───────────────────────────
-- Un borrado de perfil CONCURRENTE (RGPD, B20) puede abortar una construcción
-- en curso con `23503 violates foreign key constraint`: entre que el agregado
-- lee `profiles` y el `insert` comprueba la FK, la fila puede haber
-- desaparecido. Ocurrió de verdad en `darma-dev` con otro bloque borrando
-- perfiles a la vez. No se blinda a propósito: la construcción es idempotente y
-- el cron vuelve a intentarlo a la hora siguiente, así que el coste real es una
-- foto una hora más vieja. Blindarlo exigiría un bucle de reintento por fila
-- —mucho más caro y con más superficie— para una carrera que en producción es
-- rarísima. Queda anotado por si alguien ve el 23503 en los logs y se preocupa.
