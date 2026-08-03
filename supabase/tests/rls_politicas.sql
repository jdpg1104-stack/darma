-- ============================================================================
-- Darma · pgTAP · RLS ACTIVA Y POLÍTICAS ESPERADAS
--
-- Dos cosas que la suite de integración no puede ver desde fuera:
--
--  1. Que RLS esté ACTIVA en cada tabla. Sin RLS, una política no se evalúa
--     siquiera — y desde el cliente el síntoma sería «todo funciona», que es
--     exactamente el peor síntoma posible.
--  2. Que las tablas que deben tener CERO políticas sigan teniendo cero. Añadir
--     una política a `identity_vault`, `moderation_flags`, `crisis_events` o
--     `rate_limits` es un cambio de una línea que abre la tabla entera.
--
-- Ejecutar con:  supabase test db
-- ============================================================================

begin;
select * from no_plan();

-- ── RLS activa en TODAS las tablas del esquema público ──────────────────────
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  $$,
  'Toda tabla de public tiene row level security ACTIVA'
);

-- ── Las cuatro tablas que deben tener CERO políticas ────────────────────────
-- Con RLS activa, cero políticas significa DENEGADO. No hay que acordarse de
-- cerrar nada: hay que acordarse de abrir lo justo.
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'identity_vault'),
  0::bigint,
  '⚠ identity_vault sigue sin NINGUNA política (el pilar del anonimato)'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'moderation_flags'),
  0::bigint,
  'moderation_flags sigue sin políticas'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'crisis_events'),
  0::bigint,
  'crisis_events sigue sin políticas'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'rate_limits'),
  0::bigint,
  'rate_limits sigue sin políticas'
);

-- ── Ni boosts ni gifts tienen política de INSERT ────────────────────────────
-- El cobro y el registro tienen que ocurrir en la misma transacción, y eso solo
-- puede hacerlo el servidor.
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename in ('boosts', 'gifts') and cmd = 'INSERT'
  $$,
  'boosts y gifts no tienen política de INSERT'
);

-- ── content_views no tiene política de UPDATE (REGRESIÓN R2/R3) ─────────────
-- El avance de reproducción lo escribe la RPC de latidos de B07, que es la
-- única que puede comprobar que el tiempo declarado es plausible.
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'content_views' and cmd = 'UPDATE'
  $$,
  'R2 · content_views no tiene política de UPDATE'
);

-- La política de INSERT existe y exige nacer a cero: sin esa condición, el
-- agujero que se cerró en los privilegios de UPDATE volvería por la vía del
-- INSERT, que es la mitad que casi siempre se olvida.
select isnt_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'content_views' and cmd = 'INSERT'
  $$,
  'content_views tiene política de INSERT'
);
select ok(
  (
    select bool_and(with_check like '%completed%' and with_check like '%watched_seconds%')
      from pg_policies
     where schemaname = 'public' and tablename = 'content_views' and cmd = 'INSERT'
  ),
  'R3 · la política de INSERT de content_views acota completed y watched_seconds'
);

-- ── refuge_messages no tiene política de DELETE ─────────────────────────────
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'refuge_messages' and cmd = 'DELETE'
  $$,
  'refuge_messages no tiene política de DELETE'
);

-- ── content_items: solo lectura de lo aprobado, sin escritura de cliente ────
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'content_items' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  'content_items no tiene ninguna política de escritura (solo ingesta por service_role)'
);
select ok(
  (
    select bool_and(qual like '%approved%')
      from pg_policies
     where schemaname = 'public' and tablename = 'content_items' and cmd = 'SELECT'
  ),
  'content_items solo deja leer lo aprobado'
);

-- ── posts_read contempla el shadow-ban ──────────────────────────────────────
-- Deliberadamente deja al AUTOR ver sus propios posts aunque esté silenciado:
-- quien está en shadow-ban no debe notarlo.
select ok(
  (
    select bool_or(qual like '%shadow_banned%')
      from pg_policies
     where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT'
  ),
  'posts_read filtra por shadow_banned'
);

-- ── Los refugios se leen a través de is_refuge_member() ─────────────────────
select ok(
  (
    select bool_and(qual like '%is_refuge_member%')
      from pg_policies
     where schemaname = 'public' and tablename in ('refuges', 'refuge_members', 'refuge_messages')
       and cmd = 'SELECT'
  ),
  'las lecturas de refugios pasan por is_refuge_member()'
);

-- ── karma_events y karma_weights: lectura sí, escritura ninguna ─────────────
select is_empty(
  $$
    select policyname from pg_policies
     where schemaname = 'public' and tablename in ('karma_events', 'karma_weights')
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  'karma_events y karma_weights no tienen políticas de escritura'
);

select * from finish();
rollback;
