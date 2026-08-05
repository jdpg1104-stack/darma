-- ============================================================================
-- Darma · pgTAP · LAS CINCO REGRESIONES
--
-- Cinco fallos REALES encontrados y cerrados en la auditoría del 2026-08-03.
-- Este archivo existe para una sola cosa: que no vuelvan. Cada bloque describe
-- el agujero tal y como era, para que quien lo lea dentro de dos años entienda
-- por qué la comprobación está aquí y no la borre por «obvia».
--
-- Los otros archivos pgTAP cubren la parte de catálogo (privilegios, políticas,
-- grants). Aquí van las comprobaciones de COMPORTAMIENTO, que necesitan
-- ejecutar código.
--
-- Ejecutar con:  supabase test db  (o `npm run db:test`). Desde el 2026-08-05
-- también lo corre CI, que es cuando se descubrió que este archivo llevaba
-- desde el 3 de agosto sin ejecutarse ni una vez.
--
-- ── POR QUÉ LOS CASOS DE COMPORTAMIENTO SON FUNCIONES Y NO `do $$` ─────────
-- Estaban escritos como `do $$ … perform ok(…) … $$`. En pgTAP el resultado de
-- una prueba es la FILA que devuelve `ok()`, y `perform` la descarta: esos once
-- casos se ejecutaban y no imprimían nada. Consecuencia, que es la que importa:
-- una afirmación que FALLARA dentro de un `do` no emitía «not ok», así que
-- pg_prove no la veía y la suite pasaba igual. Once comprobaciones decorativas
-- en el archivo que cubre el farmeo de karma y el ledger append-only.
--
-- El patrón correcto es una función `returns setof text` con `return next`, y
-- llamarla con `select * from …()`. Lo que delata al patrón viejo es un
-- «Tests out of sequence» de pg_prove: el contador interno de pgTAP avanza y la
-- salida no.
-- ============================================================================

begin;
select * from no_plan();

-- ════════════════════════════════════════════════════════════════════════════
-- R1 · `award_karma` sin `grant execute` a `service_role`
--
-- `revoke all on function ... from public, anon, authenticated` se lleva por
-- delante el EXECUTE que `service_role` heredaba de PUBLIC. `spend_crystals` y
-- `check_rate_limit` (0002) sí devolvían el grant explícitamente; `award_karma`
-- (0001) no. Consecuencia: el servidor no podía otorgar karma por RPC — la
-- economía quedaba muerta fuera de los triggers, y en silencio.
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  has_function_privilege('service_role', 'public.award_karma(uuid, text, text, uuid, text)', 'EXECUTE'),
  'R1 · service_role conserva EXECUTE sobre award_karma'
);

-- ════════════════════════════════════════════════════════════════════════════
-- R4 · el ledger etiquetaba los GASTOS como `comment_validated`
--
-- `karma_events.kind` tiene una FK a `karma_weights(kind)`. Sin una clase para
-- gastar, `spend_karma()` reutilizaba 'comment_validated' para satisfacerla: un
-- boost de −50 aparecía en el historial de la persona como «comentario
-- validado». La pantalla que quedaba mintiendo era justo la de transparencia
-- del karma, que es la que sostiene la confianza en toda la economía.
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select reputation from public.karma_weights where kind = 'karma_spend'),
  0,
  'R4 · existe la clase ''karma_spend'' con reputation = 0'
);
select is(
  (select counts_to_cap from public.karma_weights where kind = 'karma_spend'),
  false,
  'R4 · ''karma_spend'' no cuenta para el tope diario'
);
select ok(
  (
    select pg_get_functiondef(p.oid) like '%''karma_spend''%'
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spend_karma'
  ),
  'R4 · spend_karma() escribe el ledger con la clase ''karma_spend'', no con ''comment_validated'''
);
select ok(
  (
    select pg_get_functiondef(p.oid) not like '%''comment_validated''%'
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spend_karma'
  ),
  'R4 · spend_karma() ya NO menciona ''comment_validated'''
);

-- Comportamiento de extremo a extremo: un gasto real deja un apunte de la clase
-- correcta y con delta_spendable negativo.
create or replace function prueba_r4_gasto_real() returns setof text language plpgsql as $$
declare
  v_user uuid;
  v_kind text;
  v_delta integer;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'r4@darma.test') returning id into v_user;
  insert into public.profiles (id, alias, karma_spendable) values (v_user, 'regresion_r4', 100);

  perform public.spend_karma(v_user, 50, 'boost');

  select kind, delta_spendable into v_kind, v_delta
    from public.karma_events where user_id = v_user order by id desc limit 1;

  return next is(v_kind, 'karma_spend', 'R4 · el apunte del gasto lleva la clase karma_spend');
  return next is(v_delta, -50, 'R4 · el gasto queda como delta_spendable negativo');
end
$$;
select * from prueba_r4_gasto_real();

-- ════════════════════════════════════════════════════════════════════════════
-- R2 y R3 · farmeo de karma por `content_views`
--
-- R2: `grant update (watched_seconds, completed, completed_at)` a authenticated
--     era karma gratis. Un PATCH a PostgREST con `completed = true`, repetido
--     sobre 120 contenidos distintos, agotaba el tope diario ENTERO sin ver un
--     segundo de vídeo. La PK impide repetir el mismo contenido; no impide
--     barrer el catálogo.
-- R3: la otra mitad, la que casi siempre se olvida. Con el UPDATE cerrado pero
--     el INSERT libre, se farmea igual naciendo ya `completed = true`.
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  not has_column_privilege('authenticated', 'public.content_views', 'completed', 'UPDATE'),
  'R2 · content_views.completed no es escribible por authenticated'
);
select ok(
  not has_column_privilege('authenticated', 'public.content_views', 'completed_at', 'UPDATE'),
  'R2 · content_views.completed_at no es escribible por authenticated'
);
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'content_views' and cmd = 'UPDATE'
  $$,
  'R2 · no hay política de UPDATE sobre content_views'
);
select ok(
  (
    select bool_and(with_check like '%completed%')
      from pg_policies
     where schemaname = 'public' and tablename = 'content_views' and cmd = 'INSERT'
  ),
  'R3 · el with_check del INSERT de content_views impide nacer completado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- R5 · fuga de `karma_spendable` / `crystals` por falta de privilegio de columna
--
-- `profiles_read ... using (true)` deja ver todas las FILAS —correcto, los
-- perfiles son anónimos— pero RLS no sabe nada de COLUMNAS. Sin el recorte,
-- `GET /rest/v1/profiles?select=karma_spendable,crystals` devolvía el saldo de
-- cualquiera y rompía CONTRATOS §2, que los declara privados.
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'karma_spendable', 'SELECT'),
  'R5 · karma_spendable no es legible por authenticated'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'crystals', 'SELECT'),
  'R5 · crystals no es legible por authenticated'
);
select ok(
  has_function_privilege('authenticated', 'public.mi_perfil_privado()', 'EXECUTE'),
  'R5 · la puerta buena (mi_perfil_privado) sigue abierta'
);

-- ── El gate de reciprocidad sigue vivo (ataque nombrado nº 2) ───────────────
create or replace function prueba_gate_reciprocidad() returns setof text language plpgsql as $$
declare
  v_user uuid;
  v_ok   boolean := false;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'recip@darma.test') returning id into v_user;
  insert into public.profiles (id, alias) values (v_user, 'regresion_recip');

  -- El primero es gratis.
  insert into public.posts (author_id, body)
  values (v_user, 'Primer post de la prueba de reciprocidad, con longitud suficiente.');

  -- El segundo, sin créditos, tiene que morir en el trigger.
  begin
    insert into public.posts (author_id, body)
    values (v_user, 'Segundo post sin créditos: esto no debe llegar a escribirse nunca.');
  exception when check_violation then
    v_ok := true;
  end;

  return next ok(v_ok, 'reciprocidad · el segundo post sin créditos levanta check_violation');
  return next is(
    (select count(*) from public.posts where author_id = v_user),
    1::bigint,
    'reciprocidad · la fila rechazada no quedó escrita'
  );
end
$$;
select * from prueba_gate_reciprocidad();

-- ── El ledger de cristales es append-only DE VERDAD ────────────────────────
-- Los revokes blindan a anon/authenticated, pero service_role los saltaría: el
-- trigger hace que ni un script del propio equipo pueda reescribir el histórico.
create or replace function prueba_ledger_append_only() returns setof text language plpgsql as $$
declare
  v_user uuid;
  v_id   bigint;
  v_ok   boolean := false;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'ledger@darma.test') returning id into v_user;
  insert into public.profiles (id, alias) values (v_user, 'regresion_ledger');
  insert into public.crystal_ledger (user_id, delta, reason, source)
  values (v_user, 10, 'siembra', 'grant') returning id into v_id;

  begin
    update public.crystal_ledger set delta = 999 where id = v_id;
  exception when others then
    v_ok := true;
  end;

  return next ok(v_ok, 'crystal_ledger · el UPDATE lo bloquea el trigger, incluso como dueño');
end
$$;
select * from prueba_ledger_append_only();

-- ── `posts.reply_count` sube y TAMBIÉN baja ────────────────────────────────
-- Subía al validar un comentario y no bajaba nunca: ni al retirarlo
-- (`state = 'removed'`, que es lo que hace DELETE /api/comments/[id]) ni al
-- ocultarlo. Como `trg_posts_hot` recalcula `hot_score` con cada cambio del
-- contador, y una respuesta pesa 13,5 veces más que un voto, el hilo que
-- moderación acababa de limpiar conservaba su empuje en el feed por unas
-- respuestas que ya no existían.
--
-- Se prueba el CICLO ENTERO y no solo la resta: un trigger que restara de más
-- pasaría una prueba que solo mirase el final. Ver 0217_1_b04_reply_count.sql.
create or replace function prueba_reply_count() returns setof text language plpgsql as $$
declare
  v_autor      uuid;
  v_escucha    uuid;
  v_post       uuid;
  v_comentario uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rc_autor@darma.test') returning id into v_autor;
  insert into public.profiles (id, alias) values (v_autor, 'regresion_rc_autor');
  insert into auth.users (id, email) values (gen_random_uuid(), 'rc_escucha@darma.test') returning id into v_escucha;
  insert into public.profiles (id, alias) values (v_escucha, 'regresion_rc_escucha');

  -- El primer post es gratis: no hace falta sembrar créditos de reciprocidad.
  insert into public.posts (author_id, body)
  values (v_autor, 'Post de la prueba del contador de respuestas, con longitud suficiente.')
  returning id into v_post;

  insert into public.comments (post_id, author_id, body)
  values (v_post, v_escucha, 'Comentario de la prueba del contador, con la longitud minima que exige el check.')
  returning id into v_comentario;

  return next is(
    (select reply_count from public.posts where id = v_post), 0,
    'reply_count · un comentario SIN validar no cuenta'
  );

  update public.comments set is_validated = true where id = v_comentario;
  return next is(
    (select reply_count from public.posts where id = v_post), 1,
    'reply_count · validar suma 1'
  );

  update public.comments set state = 'hidden' where id = v_comentario;
  return next is(
    (select reply_count from public.posts where id = v_post), 0,
    'reply_count · ocultar resta (el hilo se lee con state = active)'
  );

  update public.comments set state = 'active' where id = v_comentario;
  return next is(
    (select reply_count from public.posts where id = v_post), 1,
    'reply_count · devolverlo a activo lo vuelve a contar'
  );

  update public.comments set state = 'removed' where id = v_comentario;
  return next is(
    (select reply_count from public.posts where id = v_post), 0,
    'reply_count · retirar resta: este era el fallo'
  );

  -- Nunca por debajo de cero: un contador negativo rompe compute_hot_score().
  update public.comments set state = 'removed' where id = v_comentario;
  return next ok(
    (select reply_count from public.posts where id = v_post) >= 0,
    'reply_count · no baja de cero'
  );
end
$$;
select * from prueba_reply_count();

select * from finish();
rollback;
