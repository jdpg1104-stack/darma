-- ============================================================================
-- Darma · captura de la línea base de EXPLAIN ANALYZE
--
--   psql "$DATABASE_URL" -f scripts/load/explain.sql > /tmp/darma-explain.txt
--
-- Ejecutar SIEMPRE después de scripts/seed/sembrar.ts, que termina con ANALYZE.
-- Sin estadísticas frescas el planificador razona sobre una tabla vacía y todos
-- los planes de aquí abajo son ficción — la causa número uno de mediciones
-- falsamente buenas.
--
-- Los resultados se pegan en scripts/load/EXPLAIN.md, que es el entregable.
--
-- CÓMO LEER CADA PLAN, en este orden:
--   1. ¿Aparece `Seq Scan` sobre posts / comments / refuge_messages? Si sí, eso
--      es un HALLAZGO, no un dato: falta un índice o el predicado de la
--      consulta no coincide con el del índice parcial.
--   2. ¿El `Index Scan` usa el índice esperado, o cae en uno "parecido"?
--   3. ¿`rows` estimadas frente a `rows` reales? Una desviación de más de un
--      orden de magnitud significa estadísticas malas: ANALYZE otra vez.
--   4. `Buffers: shared hit` (memoria) frente a `read` (disco). Un plan rápido
--      con muchos `read` es un plan rápido HOY, con la caché caliente.
-- ============================================================================

\timing on
\pset pager off

-- Los cursores no se inventan: se leen de la propia base sembrada. Un cursor
-- escrito a mano puede caer fuera del rango real y medir una consulta que no
-- devuelve nada (que, por supuesto, va rapidísima).
select hot_score as c1_score, id as c1_id
  from public.posts
 where state = 'active'
 order by hot_score desc, id desc
 offset 20 limit 1
\gset

-- Página ~50 del feed: 49 páginas de 20 filas = fila 980. Se usa OFFSET AQUÍ, y
-- solo aquí, para PREPARAR la medición. Servir el feed con OFFSET es justo lo
-- que este archivo existe para desaconsejar.
select hot_score as c50_score, id as c50_id
  from public.posts
 where state = 'active'
 order by hot_score desc, id desc
 offset 980 limit 1
\gset

select created_at as cnew_ts, id as cnew_id
  from public.posts
 where state = 'active'
 order by created_at desc, id desc
 offset 980 limit 1
\gset

-- Hilo GRANDE: el caso caro. Con el hilo medio (3 comentarios) cualquier plan
-- parece bueno.
select id as post_grande, author_id as autor_prolifico
  from public.posts
 where state = 'active'
 order by reply_count desc
 limit 1
\gset

select id as refugio_activo
  from public.refuges
 where archived_at is null
 order by message_count desc
 limit 1
\gset

\echo '\n=============================================================='
\echo '1 · FEED «Para ti» — PÁGINA 1  (esperado: idx_posts_hot)'
\echo 'Presupuesto: < 50 ms (CONTRATOS.md §11)'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, author_id, kind, body, topic, upvote_count, reply_count, hot_score, created_at
  from public.posts
 where state = 'active'
   and (hot_score, id) < (:'c1_score'::double precision, :'c1_id'::uuid)
 order by hot_score desc, id desc
 limit 20;

\echo '\n=============================================================='
\echo '2 · FEED «Para ti» — PÁGINA 50 POR KEYSET'
\echo 'LA PRUEBA: este plan debe costar LO MISMO que el nº 1.'
\echo 'Si crece con la profundidad, hay un OFFSET escondido.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, author_id, kind, body, topic, upvote_count, reply_count, hot_score, created_at
  from public.posts
 where state = 'active'
   and (hot_score, id) < (:'c50_score'::double precision, :'c50_id'::uuid)
 order by hot_score desc, id desc
 limit 20;

\echo '\n=============================================================='
\echo '3 · CONTRASTE — LA MISMA PÁGINA CON offset 10000'
\echo 'ESTE NÚMERO ES EL ARGUMENTO. Postgres lee y DESCARTA 10 000'
\echo 'filas antes de devolver 20. Compárese con el nº 2.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, author_id, kind, body, topic, upvote_count, reply_count, hot_score, created_at
  from public.posts
 where state = 'active'
 order by hot_score desc, id desc
 offset 10000 limit 20;

\echo '\n=============================================================='
\echo '4 · FEED «Nuevos» — keyset  (esperado: idx_posts_new)'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, author_id, kind, body, topic, created_at
  from public.posts
 where state = 'active'
   and (created_at, id) < (:'cnew_ts'::timestamptz, :'cnew_id'::uuid)
 order by created_at desc, id desc
 limit 20;

\echo '\n=============================================================='
\echo '5 · HILO — post + comentarios activos  (esperado: idx_comments_post)'
\echo 'Se mide sobre el hilo MÁS GRANDE de la base, no sobre uno medio.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select c.id, c.author_id, c.body, c.is_validated, c.is_helpful, c.upvote_count, c.created_at
  from public.comments c
 where c.post_id = :'post_grande'::uuid
   and c.state = 'active'
 order by c.created_at
 limit 20;

\echo '\n=============================================================='
\echo '6 · PERFIL — posts de un autor  (esperado: idx_posts_author)'
\echo 'Sobre un autor del 1 % prolífico: es el caso que duele.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, kind, body, topic, upvote_count, reply_count, created_at
  from public.posts
 where author_id = :'autor_prolifico'::uuid
 order by created_at desc
 limit 20;

\echo '\n=============================================================='
\echo '7 · COLA DE MODERACIÓN  (esperado: idx_moderation_queue, parcial)'
\echo 'El índice parcial debe hacer que su tamaño sea el del BACKLOG,'
\echo 'no el del histórico.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, ref_type, ref_id, subject_id, signal, severity, created_at
  from public.moderation_flags
 where state = 'pending'
 order by severity desc, created_at
 limit 50;

\echo '\n=============================================================='
\echo '8 · COLA DE CRISIS  (esperado: idx_crisis_pending, parcial)'
\echo 'LA CONSULTA QUE MÁS IMPORTA DE TODA LA APLICACIÓN.'
\echo 'Debe devolver en microsegundos por muchos años de histórico.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, user_id, ref_type, ref_id, risk, created_at
  from public.crisis_events
 where attended_at is null
   and risk in ('high', 'critical')
 order by created_at
 limit 50;

\echo '\n=============================================================='
\echo '9 · BANDEJA DE REFUGIOS  (esperado: idx_refuges_activity, parcial)'
\echo '=============================================================='
explain (analyze, buffers, format text)
select r.id, r.kind, r.title, r.topic, r.member_count, r.message_count, r.last_message_at
  from public.refuges r
 where r.archived_at is null
 order by r.last_message_at desc nulls last, r.id desc
 limit 20;

\echo '\n=============================================================='
\echo '10 · HILO DE MENSAJES  (esperado: idx_refuge_messages_keyset)'
\echo 'El índice más caliente de la aplicación.'
\echo '=============================================================='
explain (analyze, buffers, format text)
select id, sender_id, ciphertext, nonce, enc_version, kind, created_at
  from public.refuge_messages
 where refuge_id = :'refugio_activo'::uuid
   and state = 'active'
 order by id desc
 limit 50;

\echo '\n=============================================================='
\echo 'CONTEXTO — tamaños y estadísticas'
\echo 'Si reltuples no se parece al recuento real, falta ANALYZE y todo'
\echo 'lo de arriba es ficción.'
\echo '=============================================================='
select relname as tabla,
       reltuples::bigint as filas_estimadas,
       pg_size_pretty(pg_total_relation_size(oid)) as tamano_total
  from pg_class
 where relname in ('posts', 'comments', 'profiles', 'refuge_messages',
                   'refuges', 'moderation_flags', 'crisis_events')
   and relkind = 'r'
 order by pg_total_relation_size(oid) desc;

select indexrelname as indice,
       pg_size_pretty(pg_relation_size(indexrelid)) as tamano,
       idx_scan as veces_usado
  from pg_stat_user_indexes
 where schemaname = 'public'
 order by pg_relation_size(indexrelid) desc
 limit 20;

\echo '\n=============================================================='
\echo 'DISTRIBUCIÓN — comprobar que la siembra NO es uniforme'
\echo 'Si el 1 % de autores no concentra ~30 % de los posts, la'
\echo 'siembra está mal y los planes de arriba son demasiado amables.'
\echo '=============================================================='
with por_autor as (
  select author_id, count(*) as n
    from public.posts
   group by author_id
), ordenados as (
  select n, row_number() over (order by n desc) as puesto, count(*) over () as autores
    from por_autor
)
select
  round(100.0 * sum(n) filter (where puesto <= autores * 0.01) / sum(n), 1) as pct_posts_del_1pct_autores,
  round(100.0 * sum(n) filter (where puesto <= autores * 0.10) / sum(n), 1) as pct_posts_del_10pct_autores,
  max(n) as posts_del_autor_mas_prolifico
from ordenados;

select state, count(*), round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
  from public.posts group by state order by 2 desc;

select risk, count(*), round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
  from public.posts group by risk order by 2 desc;
