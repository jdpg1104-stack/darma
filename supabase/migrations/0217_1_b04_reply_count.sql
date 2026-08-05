-- ============================================================================
-- B04 · `posts.reply_count` sube pero nunca baja
--
-- ── EL FALLO ────────────────────────────────────────────────────────────────
-- `comments_on_validated()` sumaba 1 al validar un comentario, y no había NADA
-- que restara. El trigger que lo sumaba es `after update of is_validated,
-- is_helpful`: no se dispara siquiera cuando cambia `state`. Así que:
--
--   · retirar un comentario (`state = 'removed'`, que es lo que hace
--     `DELETE /api/comments/[id]`) dejaba el contador alto para siempre;
--   · ocultarlo por moderación (`state = 'hidden'`) tampoco restaba, aunque
--     `idx_comments_post` —el índice con el que se lee el hilo— filtra por
--     `state = 'active'`: el post decía «7 respuestas» y se veían 5.
--
-- Y no se queda en un número feo. `trg_posts_hot` recalcula `hot_score` en cada
-- update de `reply_count`, y en `compute_hot_score()` una respuesta pesa 13,5
-- veces más que un voto. Un hilo cuyos comentarios se retiran —el hilo que
-- moderación acaba de limpiar— conserva su empuje en el feed y sigue subiendo
-- por unas respuestas que ya no existen. El contador inflado premiaba
-- exactamente al contenido que se había decidido quitar.
--
-- ── POR QUÉ NO BASTABA CON AÑADIR UN TRIGGER QUE RESTE ─────────────────────
-- Un `after update of state` que reste al retirar deja fuera el caso simétrico:
-- un comentario que se oculta ANTES de validarse y se valida después. Ahí no
-- hay cambio de `state`, así que el trigger nuevo no vería nada, y el viejo
-- sumaría 1 por un comentario que nadie puede leer.
--
-- El contador depende de DOS campos, así que quien lo lleva tiene que mirar los
-- dos. `comments_sync_reply_count()` no suma ni resta según el evento: calcula
-- si la fila CONTABA antes, si CUENTA ahora, y aplica la diferencia. Cualquier
-- transición futura entre los tres estados del enum queda cubierta sin volver
-- aquí, y el `+1` desaparece de `comments_on_validated()` — dos sitios que
-- escriben el mismo contador es la forma de que vuelva a descuadrarse.
--
-- CUENTA = `is_validated` **y** `state = 'active'`. Es la misma condición con
-- la que el hilo se lee, que es lo que hace que el número y la lista coincidan.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ─────────────────────────────
-- No devuelve el karma ni el crédito de reciprocidad que pagó ese comentario.
-- La escucha ocurrió: alguien acompañó a otra persona, y que después el texto
-- se retire no la deshace. Quitarlo convertiría la moderación en un castigo
-- retroactivo sobre quien escuchó, y `award_karma()` no tiene inverso. El
-- `unique(post_id, author_id) where is_validated` sigue impidiendo cobrar dos
-- veces por el mismo post.
--
-- ── EL BACKFILL ────────────────────────────────────────────────────────────
-- Los contadores de hoy ya están inflados; sin recontar, la corrección solo
-- valdría para lo que pase a partir de ahora. Se recalculan todos contra la
-- verdad y `trg_posts_hot` reajusta `hot_score` de paso, que es justo lo que
-- hay que arreglar.
-- ============================================================================

-- ── 1. El contador sale de `comments_on_validated()` ───────────────────────
-- Cuerpo idéntico al de 0213 salvo el bloque que sumaba. Se reescribe entero
-- porque `create or replace function` no admite parches parciales.
create or replace function public.comments_on_validated() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_autor_escuchado uuid;
  v_repetida        boolean;
begin
  if new.is_validated and not coalesce(old.is_validated, false) then

    select p.author_id into v_autor_escuchado
      from public.posts p
     where p.id = new.post_id;

    -- ¿Ya gané un crédito escuchando a ESTA MISMA persona dentro de la ventana?
    -- Se excluye el comentario actual (`c2.id <> new.id`) porque el UPDATE que
    -- dispara este trigger ya lo dejó con `is_validated = true`.
    select exists (
      select 1
        from public.comments c2
        join public.posts p2 on p2.id = c2.post_id
       where c2.author_id = new.author_id
         and c2.is_validated
         and c2.id <> new.id
         and p2.author_id = v_autor_escuchado
         and c2.created_at > now() - public.ventana_credito_repetido()
    ) into v_repetida;

    -- `listens_given` sube SIEMPRE: es el recuento honesto de cuántas veces
    -- alguien ha acompañado a otra persona, y esa cifra no debe mentir porque
    -- la reciprocidad no pague. Lo que se condiciona es el CRÉDITO.
    update public.profiles
       set listen_credits = listen_credits + case when v_repetida then 0 else 1 end,
           listens_given  = listens_given + 1
     where id = new.author_id;

    -- El karma se paga igual: ver la cabecera. Tiene su propio techo diario.
    perform public.award_karma(
      new.author_id, 'comment_validated', 'comment', new.id,
      'comment_validated:' || new.id::text
    );

    -- El `reply_count` YA NO SE TOCA AQUI. Sumar en el momento de validar era
    -- correcto solo si un comentario validado no dejaba de contar nunca, y si
    -- deja: al retirarlo o al ocultarlo. El contador lo lleva ahora
    -- `comments_sync_reply_count()`, que mira los DOS campos de los que
    -- depende. Ver la cabecera de esta migracion.
  end if;

  -- "Me ayudó": +15 a quien escuchó, +2 a quien cierra el ciclo reconociéndolo.
  if new.is_helpful and not coalesce(old.is_helpful, false) then
    perform public.award_karma(
      new.author_id, 'marked_helpful', 'comment', new.id,
      'marked_helpful:' || new.id::text
    );
  end if;

  return new;
end;
$$;

-- ── 2. Quien lleva el contador, mirando los dos campos ─────────────────────
create or replace function public.comments_sync_reply_count() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes  integer;
  v_ahora  integer;
begin
  -- En un INSERT no hay `old`, y tocarlo aunque sea dentro de un `case` que no
  -- se va a cumplir es un error en tiempo de ejecución («record old is not
  -- assigned yet»). Se separa con un `if` para no depender de en qué orden
  -- evalúa PL/pgSQL las ramas: un comentario nace con `is_validated = false`,
  -- así que lo normal es que tampoco cuente ahora y no se toque nada.
  if tg_op = 'INSERT' then
    v_antes := 0;
  else
    v_antes := case when old.is_validated and old.state = 'active' then 1 else 0 end;
  end if;

  v_ahora := case when new.is_validated and new.state = 'active' then 1 else 0 end;

  if v_ahora <> v_antes then
    -- `greatest(0, …)` por si alguna fila arrastra un descuadre anterior a esta
    -- migración: un contador en cero es un dato pobre, uno negativo es un dato
    -- roto que además rompe `compute_hot_score()`.
    update public.posts
       set reply_count = greatest(0, reply_count + (v_ahora - v_antes))
     where id = new.post_id;
  end if;

  return new;
end;
$$;

comment on function public.comments_sync_reply_count() is
  'Unico escritor de posts.reply_count. Cuenta los comentarios con is_validated y state = active, que es la misma condicion con la que se lee el hilo (idx_comments_post). Calcula la diferencia entre antes y ahora en vez de sumar o restar segun el evento, para que cualquier transicion entre los tres estados de entry_state quede cubierta.';

-- `state` va en la lista de columnas vigiladas: es la que faltaba y por la que
-- retirar un comentario no restaba nada.
drop trigger if exists trg_comments_reply_count on public.comments;
create trigger trg_comments_reply_count
  after insert or update of is_validated, state on public.comments
  for each row execute function public.comments_sync_reply_count();

-- ── 3. Recontar lo que ya está descuadrado ─────────────────────────────────
update public.posts p
   set reply_count = c.total
  from (
    select p2.id,
           (select count(*)
              from public.comments c2
             where c2.post_id = p2.id
               and c2.is_validated
               and c2.state = 'active')::integer as total
      from public.posts p2
  ) c
 where p.id = c.id
   and p.reply_count is distinct from c.total;
