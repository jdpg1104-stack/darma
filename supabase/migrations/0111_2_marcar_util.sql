-- ============================================================================
-- Darma · B04 · «Me ayudó»: traslado de la marca en UNA transacción
--
-- Solo puede haber un comentario marcado por post, y la decisión de producto es
-- que la marca se TRASLADA (no se rechaza el segundo intento con un «ya has
-- marcado otro»): quien está mal cambia de opinión sobre qué le ayudó, y
-- obligarle a deshacer para rehacer es fricción en el peor momento.
--
-- Trasladar son DOS escrituras —quitar la anterior, poner la nueva— y PostgREST
-- no tiene transacciones entre peticiones: dos UPDATE sueltos dejan una ventana
-- en la que el post se queda sin ninguna marca (o con dos, si el segundo falla
-- al revés). De ahí esta función: las dos escrituras y la lectura del karma
-- realmente pagado ocurren en la misma transacción, o no ocurre ninguna.
--
-- ── POR QUÉ `security definer` Y CONCEDIDA SOLO A service_role ─────────────
-- `authenticated` tiene `grant update (body, state)` sobre `comments`:
-- `is_helpful` está fuera a propósito, porque es una declaración sobre el
-- trabajo de OTRA persona y paga +15. La función es la única vía, y se concede
-- solo a `service_role` para que la llamada pase por la ruta del servidor, que
-- es donde vive el rate limit. La autorización NO descansa en eso: la función
-- comprueba ella misma que `p_actor` es el autor del post, así que aunque
-- alguien consiguiera invocarla no podría marcar en un hilo ajeno.
--
-- Devuelve un ESTADO en vez de lanzar excepciones para los casos esperados. Un
-- `raise` obligaría a la ruta a leer el texto del error de plpgsql para
-- distinguir «no existe» de «no eres el autor», y ese texto es justo lo que
-- `lib/auth/errores.ts` se molesta en no dejar salir.
-- ============================================================================

create or replace function public.marcar_comentario_util(
  p_comment uuid,
  p_actor   uuid
)
returns table (estado text, karma_otorgado integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post        uuid;
  v_post_author uuid;
  v_comentarista uuid;
begin
  select c.post_id, c.author_id, p.author_id
    into v_post, v_comentarista, v_post_author
    from public.comments c
    join public.posts p on p.id = c.post_id
   where c.id = p_comment
     and c.state = 'active';

  if not found then
    return query select 'no_encontrado'::text, 0;
    return;
  end if;

  -- La autoría del post se comprueba AQUÍ y no solo en la ruta: una regla que
  -- vive únicamente en el servidor de Next es una sugerencia (ARCHITECTURE §0).
  if v_post_author is distinct from p_actor then
    return query select 'sin_permiso'::text, 0;
    return;
  end if;

  -- Marcarse a uno mismo sería fabricarse +15. Hoy es inalcanzable porque nadie
  -- puede comentar su propio post, pero esa comprobación vive en la ruta y esta
  -- función no debe depender de ella.
  if v_comentarista = p_actor then
    return query select 'sin_permiso'::text, 0;
    return;
  end if;

  -- Quitar la marca anterior NO paga ni cobra nada: `comments_on_validated()`
  -- solo actúa en el flanco false → true.
  update public.comments
     set is_helpful = false
   where post_id = v_post
     and is_helpful
     and id <> p_comment;

  -- El `and not is_helpful` hace la operación idempotente: repetir la llamada
  -- no vuelve a disparar el trigger (que además es idempotente por su
  -- `idempotency_key`, pero dos cinturones no sobran donde se paga karma).
  update public.comments
     set is_helpful = true
   where id = p_comment
     and not is_helpful;

  -- Lo REALMENTE pagado, no los 15 de la tabla de pesos: `award_karma` recorta
  -- al llegar al tope diario de 120 y puede haber pagado menos, o cero.
  return query
    select 'ok'::text,
           coalesce((
             select ke.delta_reputation
               from public.karma_events ke
              where ke.idempotency_key = 'marked_helpful:' || p_comment::text
              limit 1
           ), 0);
end;
$$;

revoke all on function public.marcar_comentario_util(uuid, uuid) from public, anon, authenticated;
grant execute on function public.marcar_comentario_util(uuid, uuid) to service_role;
