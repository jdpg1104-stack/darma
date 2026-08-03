-- ============================================================================
-- Darma · 0105_1 · B05 · Perfil, karma y niveles
--
-- Todo lo de aquí es ADITIVO: ni una migración anterior se toca (ya están
-- aplicadas contra darma-dev). Cuatro cosas:
--
--   1. El índice que le falta al keyset del ledger.
--   2. La racha, en columna y mantenida por trigger (nunca calculada al leer).
--   3. `mi_resumen_karma()`  — el resumen del perfil propio en UNA consulta.
--   4. `mi_historial_karma()`— el historial paginado por keyset, bajo RLS.
--
-- ── POR QUÉ DOS FUNCIONES NUEVAS Y NO DOS `select` ─────────────────────────
-- 0001 revocó el privilegio de COLUMNA de `select` sobre `profiles` y lo
-- devolvió solo sobre las públicas. `karma_spendable`, `crystals`,
-- `listen_credits`, `listens_given`, `posts_published`, `daily_karma_earned`,
-- `banned_until` y `shadow_banned` quedaron fuera —y no solo para los demás:
-- tampoco sobre la propia fila—. Verificado contra Postgres: un
-- `select karma_spendable from profiles where id = auth.uid()` devuelve
-- `42501 permission denied for column`.
--
-- Las columnas de racha que añade esta migración heredan ese régimen por
-- omisión: al no concederse, nadie las lee con un `select`. Es deliberado. La
-- racha es un dato de COMPORTAMIENTO (qué días te conectas y ayudas); expuesta
-- en el perfil ajeno permitiría correlacionar dos cuentas anónimas de la misma
-- persona por su patrón de actividad, que es exactamente el riesgo por el que
-- `last_seen_at` no se muestra al minuto.
--
-- La consecuencia de diseño para B05: el perfil PROPIO necesita dos lecturas
-- (las columnas públicas de `profiles` + una RPC para lo privado) y el AJENO
-- una sola. Que el tipo `PerfilAjeno` no tenga los campos privados deja de ser
-- una precaución de estilo y pasa a reflejar lo que la base permite de verdad.
-- ============================================================================

-- ── 1. Índice del keyset del ledger ─────────────────────────────────────────
-- El de 0001 es `(user_id, created_at desc)` SIN `id`. Sirve para ordenar, pero
-- el desempate del cursor —dos eventos en el mismo instante, que es lo normal
-- cuando un trigger otorga karma y crédito en la misma transacción— obligaba a
-- filtrar filas ya leídas fuera del índice. Con `id` dentro, la comparación de
-- tupla entera es un salto al punto exacto donde acabó la página anterior.
create index if not exists idx_karma_events_user_keyset
  on public.karma_events (user_id, created_at desc, id desc);

comment on index public.idx_karma_events_user_keyset is
  'Historial de karma, keyset descendente. Predicado literal: where user_id = :uid and (created_at, id) < (:cursor_created, :cursor_id) order by created_at desc, id desc limit :limite. NUNCA OFFSET: el historial de alguien con tres años de uso son decenas de miles de filas y OFFSET 20000 las lee todas para tirarlas.';

-- ── 2. Racha, en columna ────────────────────────────────────────────────────
-- La alternativa era `count(distinct date(created_at))` sobre el ledger en cada
-- carga del perfil. Funciona con 30 eventos y muere con 30 000: es un recorrido
-- del historial COMPLETO de la persona, cada vez que abre su propia pantalla.
-- Un contador mantenido por trigger cuesta un UPDATE al día como mucho (ver el
-- `where` del trigger) y se lee con un index scan por PK.
alter table public.profiles
  add column if not exists streak_days integer not null default 0
      check (streak_days >= 0);

alter table public.profiles
  add column if not exists streak_last_date date;

comment on column public.profiles.streak_days is
  'Días consecutivos con al menos un evento de karma POSITIVO. Lo mantiene trg_karma_events_racha; no se concede update a authenticated, igual que el resto del karma.';
comment on column public.profiles.streak_last_date is
  'Último día natural con karma positivo. Solo lo escribe el trigger de la racha.';

-- NO se conceden `select` ni `update` sobre estas dos columnas a `anon` ni a
-- `authenticated`. Sin `grant` explícito no hay acceso, porque 0001 ya revocó
-- el privilegio de tabla y concedió una lista cerrada de columnas: una columna
-- nueva NO entra sola en esa lista. La racha propia sale por
-- `mi_resumen_karma()`; la ajena no sale por ningún sitio.

create or replace function public.karma_events_racha() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Solo la reputación POSITIVA sostiene la racha. Si una penalización contara,
  -- un día en el que a alguien le tumban un comentario por spam le "mantendría
  -- la racha viva", que es lo contrario de lo que la racha mide.
  if new.delta_reputation > 0 then
    update public.profiles
       set streak_days = case
             -- Ayer → sigue la cadena. Cualquier otra cosa (hueco de un día o
             -- más, o primera vez) → arranca de nuevo en 1.
             when streak_last_date = current_date - 1 then streak_days + 1
             else 1
           end,
           streak_last_date = current_date
     where id = new.user_id
       -- Dos eventos el mismo día no incrementan dos veces. El guard está en el
       -- WHERE y no en un IF para que además NO se escriba la fila: en un día
       -- activo son doce comentarios validados y once UPDATE que no cambian
       -- nada, cada uno con su tupla muerta y su lock de fila.
       and streak_last_date is distinct from current_date;
  end if;

  return null;
end;
$$;

-- Misma regla que impuso 0003 §3: una función `returns trigger` no debe quedar
-- publicada como endpoint RPC. El bucle de 0003 ya se ejecutó, así que esta
-- función —creada después— tiene que revocarse ella misma.
revoke all on function public.karma_events_racha() from public, anon, authenticated;

drop trigger if exists trg_karma_events_racha on public.karma_events;
create trigger trg_karma_events_racha
  after insert on public.karma_events
  for each row execute function public.karma_events_racha();

-- ── 3. Resumen del karma propio · UNA consulta ──────────────────────────────
-- Junta en una sola llamada lo que si no serían tres: reputación y tope diario
-- (columnas de `profiles`), racha (columnas nuevas, sin privilegio de select) y
-- el desglose de 30 días (agregación sobre el ledger, que PostgREST no sabe
-- expresar sin una función).
--
-- SECURITY DEFINER porque `streak_days` no tiene privilegio de columna para
-- `authenticated` — el mismo motivo por el que existe `mi_perfil_privado()`.
-- Como toda función definer de este esquema, el filtro `p.id = auth.uid()` ES
-- la puerta: no acepta ningún parámetro con el que apuntar a otra persona, así
-- que no hay forma de pedirle el resumen de nadie más.
--
-- La agregación está ACOTADA POR DISEÑO, no por suerte: un usuario, un mes.
-- Usa idx_karma_events_user y toca como mucho los eventos de 30 días de una
-- persona, con el tope diario de 120 puntos limitando cuántos pueden ser.
create or replace function public.mi_resumen_karma()
returns table (
  reputacion         integer,
  ganado_hoy         integer,
  streak_days        integer,
  streak_last_date   date,
  desglose_30d       jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.karma_reputation,
    -- Espejo de mi_perfil_privado(): si la ventana diaria es de otro día, lo
    -- ganado hoy es 0 aunque la columna aún no se haya reseteado (el reset lo
    -- hace award_karma en la siguiente concesión, no un cron).
    case when p.daily_karma_date = current_date then p.daily_karma_earned else 0 end,
    p.streak_days,
    p.streak_last_date,
    coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'total', d.total, 'veces', d.veces))
        from (
          select e.kind,
                 sum(e.delta_reputation)::integer as total,
                 count(*)::integer               as veces
            from public.karma_events e
           where e.user_id = p.id
             and e.created_at >= now() - interval '30 days'
           group by e.kind
        ) d
    ), '[]'::jsonb)
  from public.profiles p
 where p.id = (select auth.uid());
$$;

-- Revocar ANTES de conceder. `grant ... to authenticated` no quita el EXECUTE
-- que PUBLIC tiene por defecto, y ese descuido es justo el que 0003 §2 tuvo que
-- venir a arreglar en mi_perfil_privado(): la función quedaba publicada en
-- /rest/v1/rpc/ para cualquiera sin sesión.
revoke all on function public.mi_resumen_karma() from public, anon, authenticated;
grant execute on function public.mi_resumen_karma() to authenticated;

-- ── 4. Historial del ledger · keyset, y bajo RLS ────────────────────────────
-- SECURITY INVOKER (el defecto) A PROPÓSITO, al revés que las otras dos. Aquí
-- no hace falta definer —`authenticated` sí tiene select sobre karma_events— y
-- renunciar a él conserva la política `karma_events_read_own` como SEGUNDA
-- barrera: si algún día alguien borrase el `where user_id = auth.uid()` de
-- dentro, RLS seguiría devolviendo solo el ledger propio. Con definer, ese
-- mismo despiste publicaría el ledger de toda la red.
--
-- La función no recibe `user_id`. No es que lo ignore: es que no existe el
-- parámetro con el que pedir el historial de otra persona.
create or replace function public.mi_historial_karma(
  p_limite         integer     default 20,
  p_cursor_created timestamptz default null,
  p_cursor_id      bigint      default null
)
returns table (
  id               bigint,
  kind             text,
  delta_reputation integer,
  delta_spendable  integer,
  ref_type         text,
  ref_id           uuid,
  created_at       timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.id, e.kind, e.delta_reputation, e.delta_spendable,
         e.ref_type, e.ref_id, e.created_at
    from public.karma_events e
   where e.user_id = (select auth.uid())
     -- Comparación de TUPLA sobre el mismo par que ordena y que indexa. Con dos
     -- predicados sueltos (`created_at <= X and id < Y`) se perderían los
     -- eventos de un instante anterior con id mayor.
     and (p_cursor_created is null
          or (e.created_at, e.id) < (p_cursor_created, coalesce(p_cursor_id, 9223372036854775807)))
   order by e.created_at desc, e.id desc
   -- El tope de 50 se valida con zod en la ruta Y se vuelve a imponer aquí: la
   -- función es un endpoint de PostgREST, así que se puede llamar sin pasar por
   -- la ruta de Next. Un `limite=100000` desde un curl sería un volcado del
   -- ledger entero de la persona en una sola respuesta.
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

revoke all on function public.mi_historial_karma(integer, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.mi_historial_karma(integer, timestamptz, bigint) to authenticated;
