-- ============================================================================
-- El crédito de escucha se gana por PERSONA, no por publicación
--
-- ── EL AGUJERO ─────────────────────────────────────────────────────────────
-- `uq_comments_one_listen_per_post (post_id, author_id) where is_validated`
-- impide ganar dos créditos comentando DOS VECES EL MISMO POST. No impide nada
-- más. Comentar tres posts distintos de la MISMA persona daba tres créditos, y
-- tres créditos son una publicación.
--
-- Con dos cuentas coordinadas el ciclo era: A publica → B comenta (+10 karma,
-- +1 crédito) → A marca «me ayudó» (+15). Repetir con un post nuevo de A. Cada
-- vuelta daba +25 de reputación y un crédito, y ninguna regla lo tocaba.
--
-- La app promete, con estas palabras, «escuchas a 3 personas». Hasta ahora eso
-- se implementaba como «3 publicaciones», que no es lo mismo en cuanto alguien
-- se lo propone. Esta migración hace que la implementación diga lo que dice el
-- producto.
--
-- ── LA REGLA NUEVA ─────────────────────────────────────────────────────────
-- Escuchar a alguien a quien YA escuchaste en los últimos 30 días sigue siendo
-- bienvenido —se registra, cuenta como escucha dada y paga karma— pero NO suma
-- crédito de reciprocidad. Para desbloquear tu voz hacen falta tres PERSONAS
-- distintas.
--
-- ── POR QUÉ UNA VENTANA Y NO «UNA VEZ EN LA VIDA» ──────────────────────────
-- Acompañar dos veces a la misma persona con meses de diferencia es exactamente
-- lo que esta red quiere que pase; prohibirlo para siempre castigaría el mejor
-- comportamiento posible. 30 días es largo para que coordinar dos cuentas deje
-- de ser rentable —una pareja produce 1 crédito al mes, no 1 por post— y corto
-- para que la relación real no se penalice.
--
-- ── POR QUÉ EL KARMA NO SE TOCA ────────────────────────────────────────────
-- Deliberado. El karma ya tiene su propio techo dentro de `award_karma()`: 120
-- al día con lock de fila. Ese farmeo está ACOTADO por diseño. Lo que no tenía
-- techo era el crédito, porque abre publicaciones sin límite. Además, quitar
-- karma a una escucha repetida castigaría a quien de verdad vuelve a acompañar
-- a la misma persona, que es lo contrario de lo que se busca.
--
-- ── POR QUÉ AQUÍ Y NO EN LA RUTA ───────────────────────────────────────────
-- ARCHITECTURE §0: una regla de economía que vive en un `if` de TypeScript es
-- una sugerencia, porque cualquier ruta con `service_role` la esquiva. El gate
-- 3:1 ya vive en Postgres; su condición de entrada también debe.
-- ============================================================================

-- La ventana. Constante en SQL para que no haya dos verdades: si algún día se
-- cambia, se cambia aquí y `lib/karma.ts` lo verifica con el guard de economía.
create or replace function public.ventana_credito_repetido() returns interval
language sql immutable
as $$ select interval '30 days' $$;

comment on function public.ventana_credito_repetido() is
  'Cuánto tiempo debe pasar para que escuchar a la MISMA persona vuelva a dar crédito de reciprocidad. Ver 0213_1_b21_credito_por_persona.sql.';

-- Sostiene la consulta de «¿ya escuché a esta persona hace poco?». Sin él, cada
-- validación de comentario haría un recorrido por todos los comentarios del
-- usuario. Parcial por `is_validated`: lo no validado no cuenta para nada.
create index if not exists idx_comments_credito_repetido
  on public.comments (author_id, created_at desc)
  where is_validated;

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

    update public.posts
       set reply_count = reply_count + 1
     where id = new.post_id;
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
