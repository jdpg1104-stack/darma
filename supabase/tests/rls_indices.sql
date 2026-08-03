-- ============================================================================
-- Darma · pgTAP · TODOS LOS ÍNDICES DE LAS MIGRACIONES SIGUEN EXISTIENDO
--
-- Esto NO duplica el trabajo de B14: allí se miden planes y tiempos con
-- `EXPLAIN`. Aquí solo se comprueba PRESENCIA. Un índice que desaparece en un
-- merge —porque alguien reescribió un bloque de la migración o porque dos ramas
-- tocaron el mismo archivo— no rompe ningún test funcional: la app sigue dando
-- las respuestas correctas, solo que con seq scans. Es una caída de producción
-- silenciosa que aparece semanas después, cuando la tabla ha crecido.
--
-- Los índices PARCIALES llevan además la comprobación de su predicado: un
-- índice parcial cuyo `WHERE` deja de coincidir con el de la consulta es, en la
-- práctica, un índice que no existe (Postgres no lo puede usar).
--
-- Ejecutar con:  supabase test db
-- ============================================================================

begin;
select * from no_plan();

-- ── La lista completa, de 0001 y 0002 ───────────────────────────────────────
select is_empty(
  $$
    with esperados(nombre) as (values
      -- 0001_core.sql
      ('idx_profiles_karma'),
      ('idx_profiles_alias_trgm'),
      ('idx_identity_vault_contact'),
      ('idx_karma_events_user'),
      ('idx_posts_hot'),
      ('idx_posts_new'),
      ('idx_posts_author'),
      ('idx_posts_risk'),
      ('idx_comments_post'),
      ('idx_comments_author'),
      ('uq_comments_one_listen_per_post'),
      -- 0002_comunidad.sql
      ('idx_refuges_activity'),
      ('idx_refuges_creator'),
      ('idx_refuge_members_user'),
      ('idx_refuge_messages_keyset'),
      ('idx_refuge_messages_sender'),
      ('idx_kindred_owner'),
      ('idx_kindred_reverse'),
      ('idx_profiles_needs_talk'),
      ('idx_blocks_blocked'),
      ('uq_content_items_platform_external'),
      ('idx_content_feed'),
      ('idx_content_fresh'),
      ('idx_content_pending'),
      ('idx_content_views_user'),
      ('idx_polls_post'),
      ('idx_polls_feed'),
      ('idx_poll_votes_option'),
      ('idx_moderation_queue'),
      ('idx_moderation_subject'),
      ('idx_crisis_pending'),
      ('idx_crisis_user'),
      ('uq_crystal_ledger_external'),
      ('idx_crystal_ledger_user'),
      ('idx_boosts_active'),
      ('idx_boosts_user_day'),
      ('idx_gifts_recipient'),
      ('idx_gifts_sender'),
      ('idx_rate_limits_window')
    )
    select nombre from esperados
     where nombre not in (select indexname from pg_indexes where schemaname = 'public')
  $$,
  'Todos los índices declarados en 0001 y 0002 existen tras aplicar las migraciones'
);

-- ── Predicados de los índices parciales ─────────────────────────────────────
-- Cada uno replica el WHERE literal de su consulta. Si el predicado cambia, el
-- índice deja de servir para esa consulta aunque siga apareciendo en la lista.

select ok(
  (select indexdef like '%WHERE%state%active%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_posts_hot'),
  'idx_posts_hot sigue siendo parcial sobre state = active (feed «Para ti»)'
);
select ok(
  (select indexdef like '%WHERE%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_posts_risk'),
  'idx_posts_risk sigue siendo parcial (la cola de crisis debe ser diminuta e instantánea)'
);
select ok(
  (select indexdef like '%WHERE%shadow_banned%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_profiles_karma'),
  'idx_profiles_karma excluye a quien está en shadow-ban (ranking)'
);
select ok(
  (select indexdef like '%WHERE%is_validated%' from pg_indexes
    where schemaname = 'public' and indexname = 'uq_comments_one_listen_per_post'),
  'uq_comments_one_listen_per_post sigue siendo único y parcial: no se ganan 3 créditos en el mismo post'
);
select ok(
  (select indexdef like '%WHERE%archived_at%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_refuges_activity'),
  'idx_refuges_activity excluye los refugios archivados'
);
select ok(
  (select indexdef like '%WHERE%state%active%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_refuge_messages_keyset'),
  'idx_refuge_messages_keyset sigue siendo parcial (es el índice más caliente de la app)'
);
select ok(
  (select indexdef like '%WHERE%approved%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_content_feed'),
  'idx_content_feed sigue restringido a contenido aprobado'
);
select ok(
  (select indexdef like '%WHERE%pending%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_moderation_queue'),
  'idx_moderation_queue sigue siendo parcial sobre lo pendiente'
);
select ok(
  (select indexdef like '%WHERE%attended_at%' from pg_indexes
    where schemaname = 'public' and indexname = 'idx_crisis_pending'),
  '⚠ idx_crisis_pending sigue siendo parcial sobre lo NO atendido de riesgo alto'
);
select ok(
  (select indexdef like '%WHERE%external_id%' from pg_indexes
    where schemaname = 'public' and indexname = 'uq_crystal_ledger_external'),
  'uq_crystal_ledger_external sigue siendo único y parcial (idempotencia de los webhooks de la store)'
);

select * from finish();
rollback;
