-- ============================================================================
-- Darma · pgTAP · FUNCIONES `SECURITY DEFINER` Y SUS GRANTS
--
-- Una función SECURITY DEFINER se ejecuta con los privilegios de su DUEÑO. Si
-- además es invocable por `authenticated`, es una puerta abierta con el uniforme
-- del portero puesto. Aquí se comprueba, contra el catálogo:
--
--  · que cada una tiene `search_path` fijado (sin él, alguien puede crear una
--    tabla que suplante a otra dentro de la función);
--  · quién puede ejecutarla y quién no;
--  · REGRESIÓN R1: que `service_role` SÍ puede ejecutar `award_karma`.
--
-- Ejecutar con:  supabase test db
-- ============================================================================

begin;
select * from no_plan();

-- ── search_path fijado en todas las SECURITY DEFINER ────────────────────────
select is_empty(
  $$
    select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and (p.proconfig is null or not exists (
             select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
           ))
  $$,
  'Toda función SECURITY DEFINER de public fija su search_path'
);

-- ── Economía y rate limiting: cerradas al cliente ───────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.award_karma(uuid, text, text, uuid, text)', 'EXECUTE'),
  'award_karma NO es ejecutable por authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.award_karma(uuid, text, text, uuid, text)', 'EXECUTE'),
  'award_karma NO es ejecutable por anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.spend_karma(uuid, integer, text)', 'EXECUTE'),
  'spend_karma NO es ejecutable por authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'public.spend_crystals(uuid, integer, text)', 'EXECUTE'),
  'spend_crystals NO es ejecutable por authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'public.check_rate_limit(text, integer, integer)', 'EXECUTE'),
  'check_rate_limit NO es ejecutable por authenticated'
);

-- ── REGRESIÓN R1 ────────────────────────────────────────────────────────────
-- `revoke all ... from public` se lleva por delante el EXECUTE que service_role
-- heredaba. Sin el grant explícito, el servidor no puede otorgar karma por RPC y
-- la economía queda muerta fuera de los triggers. `spend_crystals` y
-- `check_rate_limit` en 0002 sí lo llevaban; `award_karma` era la asimetría.
select ok(
  has_function_privilege('service_role', 'public.award_karma(uuid, text, text, uuid, text)', 'EXECUTE'),
  '⚠ R1 · service_role SÍ puede ejecutar award_karma (grant explícito presente)'
);
select ok(
  has_function_privilege('service_role', 'public.spend_karma(uuid, integer, text)', 'EXECUTE'),
  'R1 · service_role SÍ puede ejecutar spend_karma'
);
select ok(
  has_function_privilege('service_role', 'public.spend_crystals(uuid, integer, text)', 'EXECUTE'),
  'R1 · service_role SÍ puede ejecutar spend_crystals'
);
select ok(
  has_function_privilege('service_role', 'public.check_rate_limit(text, integer, integer)', 'EXECUTE'),
  'R1 · service_role SÍ puede ejecutar check_rate_limit'
);

-- ── Helpers de RLS ──────────────────────────────────────────────────────────
-- SÍ se conceden a `authenticated`, y es OBLIGATORIO: una expresión de política
-- se evalúa con los privilegios de quien consulta, así que sin este grant TODA
-- consulta a refuges fallaría con «permission denied for function».
--
-- Lo que las hace seguras no es un revoke: es que su firma NO acepta un uuid de
-- tercero (sacan la identidad de auth.uid() por dentro), de modo que la única
-- respuesta obtenible es sobre uno mismo. Eso es lo que se comprueba aquí.
select ok(
  has_function_privilege('authenticated', 'public.is_refuge_member(uuid)', 'EXECUTE'),
  'is_refuge_member SÍ es ejecutable por authenticated (lo exigen las políticas)'
);
select ok(
  not has_function_privilege('anon', 'public.is_refuge_member(uuid)', 'EXECUTE'),
  'is_refuge_member NO es ejecutable sin sesión'
);
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_refuge_member' and p.pronargs = 1),
  1,
  'is_refuge_member toma UN solo argumento: no admite preguntar por un tercero'
);
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_blocked_with' and p.pronargs = 1),
  1,
  'is_blocked_with toma UN solo argumento: solo habla de la relación propia'
);
select ok(
  has_function_privilege('authenticated', 'public.refuge_has_block(uuid, uuid)', 'EXECUTE'),
  'refuge_has_block es ejecutable por authenticated (lo exige refuge_members_join)'
);

-- ── mi_perfil_privado: la única puerta al saldo propio (R5) ─────────────────
select ok(
  has_function_privilege('authenticated', 'public.mi_perfil_privado()', 'EXECUTE'),
  'R5 · mi_perfil_privado() SÍ es ejecutable: es la única vía al saldo propio'
);
select ok(
  not has_function_privilege('anon', 'public.mi_perfil_privado()', 'EXECUTE'),
  'mi_perfil_privado() NO es ejecutable sin sesión'
);

select * from finish();
rollback;
