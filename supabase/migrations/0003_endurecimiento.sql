-- ============================================================================
-- Darma · 0003 · Endurecimiento posterior a la primera aplicación real
--
-- Estos cuatro fallos no se vieron leyendo el SQL: los destapó el linter de
-- Supabase la primera vez que el esquema existió de verdad en Postgres. Ninguno
-- es explotable HOY; los cuatro lo serían tras un cambio perfectamente razonable
-- de alguien que no conociera el detalle. Esa es justo la clase de deuda que no
-- conviene dejar viva en una app donde la gente escribe lo que no le cuenta a
-- nadie.
--
-- No se modifica 0001 ni 0002: ya están aplicadas. Solo se añade.
-- ============================================================================

-- ── 1. search_path fijado en las dos funciones que se quedaron sin él ───────
-- Todas las funciones de 0002, 0101 y 0108 llevan `set search_path`; estas dos
-- de 0001 se escaparon. Sin él, quien pueda crear objetos en un esquema que
-- aparezca antes en el search_path de la sesión puede colar su propia
-- `greatest()` o su propio operador y hacer que la función ejecute su código.
-- Es el ataque que el resto del esquema se molesta en cerrar; dejar dos puertas
-- abiertas de diez anula la disciplina entera.
create or replace function public.compute_hot_score(
  p_upvotes integer, p_replies integer, p_created timestamptz
) returns double precision
language sql
immutable
set search_path = pg_catalog, public
as $$
  select sign(1.0 * p_upvotes + 13.5 * p_replies)
         * log(10, greatest(abs(1.0 * p_upvotes + 13.5 * p_replies), 1))
       + (extract(epoch from p_created) - 1767225600) / 45000.0;
$$;

create or replace function public.posts_refresh_hot() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.hot_score := public.compute_hot_score(new.upvote_count, new.reply_count, new.created_at);
  new.updated_at := now();
  return new;
end;
$$;

-- ── 2. mi_perfil_privado() estaba alcanzable por `anon` ─────────────────────
-- `grant execute ... to authenticated` no revoca el EXECUTE que PUBLIC tiene por
-- defecto, así que la función quedó publicada en /rest/v1/rpc/ para cualquiera
-- sin sesión. No filtra —su `where` es `auth.uid()`, que sin sesión es NULL y
-- devuelve cero filas—, pero es una función SECURITY DEFINER que devuelve
-- saldos, y su seguridad descansaba en un detalle de SQL en vez de en un
-- permiso. Un `where` mal editado mañana la convierte en una fuga.
revoke all on function public.mi_perfil_privado() from public, anon;
grant execute on function public.mi_perfil_privado() to authenticated;

-- ── 3. Las funciones de trigger no deben ser invocables por la API ──────────
-- Postgres rechaza llamar a una función `returns trigger` fuera de un trigger,
-- así que hoy no hay riesgo práctico. Pero PostgREST las publica como endpoints
-- RPC y varias son SECURITY DEFINER: aparecen en el esquema público de la API
-- como si fueran superficie legítima. Se revoca en bloque y por consulta al
-- catálogo, no por lista de nombres — una lista solo protege lo que alguien se
-- acordó de escribir, y la función que se cree mañana no estará en ella.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end;
$$;

-- ── 4. `authenticated` conservaba INSERT sobre las columnas de saldo ────────
-- Hoy es inocuo porque `profiles` no tiene política de INSERT (por eso existe
-- crear_perfil()). Pero eso significa que la protección de los saldos depende de
-- la AUSENCIA de una política, no de un permiso. El día que alguien añada un
-- `create policy ... for insert on profiles` —una migración de lo más razonable—
-- se podría nacer con cristales y karma gastable, y nadie lo relacionaría con
-- aquel INSERT que nunca se revocó.
revoke insert on public.profiles from anon, authenticated;

-- ── 5. Índices de las FK por las que sí se recorre en cascada ───────────────
-- `poll_votes.user_id` y `post_votes.user_id` están cubiertos por la PK para la
-- pregunta "¿ya voté esto?", así que el linter los marca por otra razón: al
-- borrar un perfil (RGPD, bloque B20), la cascada busca por user_id y sin índice
-- eso es un recorrido completo de las dos tablas más grandes de la app. Un
-- borrado de datos personales tiene plazo legal; no puede depender de un seq
-- scan sobre decenas de millones de filas.
create index if not exists idx_post_votes_user on public.post_votes (user_id);
create index if not exists idx_poll_votes_user on public.poll_votes (user_id);

-- pg_trgm vive en `public` (aviso extension_in_public del linter). NO se mueve
-- aquí a propósito: reubicar una extensión de la que ya cuelga un índice GIN
-- (idx_profiles_alias_trgm) exige recrear el índice, y es una operación que
-- merece hacerse sola y verificada, no de rebote en una migración que va de
-- otra cosa. Anotado en HANDOFF/PEDIDOS.md.
