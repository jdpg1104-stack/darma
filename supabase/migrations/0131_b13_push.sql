-- ============================================================================
-- Darma · 0131 · B13 · Suscripciones push, preferencias y estado de reparto
--
-- Rango de migración reservado a B13 en HANDOFF/PARALELO.md §3 (`0131`–`0139`).
-- La ficha B13 lo llamaba `0013_b13_push.sql`, pero ese hueco pertenece a los
-- cimientos y ya está ocupado; anotado en PEDIDOS.md.
--
-- No se modifica NINGUNA migración anterior. Solo se añade.
--
-- ── LO QUE ESTA MIGRACIÓN PROTEGE ──────────────────────────────────────────
-- `push_subscriptions` guarda las CLAVES DE CIFRADO del navegador (`p256dh`,
-- `auth`) más el endpoint del servicio de push. Ese trío es, en la práctica, la
-- capacidad de hacer sonar el teléfono de una persona y de cifrar una carga que
-- su navegador aceptará como nuestra. En una app donde una notificación dice
-- «un Alma Afín necesita hablar», poder enumerar suscripciones ajenas es poder
-- saber quién está en crisis y cuándo.
--
-- De ahí las dos reglas que este archivo aplica al pie de la letra:
--
--  1. **RLS decide FILAS; solo el privilegio de COLUMNA decide COLUMNAS.**
--     Una política `using (user_id = auth.uid())` no impide que un
--     `GET /rest/v1/push_subscriptions?select=p256dh,auth` devuelva las claves
--     de la propia fila — y ese material no tiene ningún uso legítimo en el
--     cliente (el navegador ya lo tiene, lo generó él). Aquí se enumera lo
--     legible y lo escribible; todo lo demás queda fuera del alcance del rol.
--     Mismo patrón que `profiles` en 0001 y que `comments` en 0004.
--
--  2. **Ninguna política RLS consulta otra tabla con una subconsulta.** La
--     lección de 0005: la expresión de una política se evalúa con los
--     privilegios de QUIEN CONSULTA, así que una subconsulta a otra tabla es un
--     acoplamiento invisible con los privilegios de columna de esa otra tabla,
--     y se rompe en silencio el día que alguien revoca una. Las políticas de
--     aquí solo comparan `user_id` con `auth.uid()`; lo que necesita mirar
--     `kindred` o `blocks` vive en funciones `security definer` (abajo).
-- ============================================================================

-- ============================================================================
-- SECCIÓN 1 · SUSCRIPCIONES
-- ============================================================================

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,

  -- URL del servicio de push del navegador. Es una CAPABILITY URL: quien la
  -- tiene puede intentar entregar una carga a ese dispositivo. No es un dato
  -- «público» del usuario y no se le devuelve ni a él (ver los grants).
  endpoint    text not null check (endpoint ~ '^https://'),

  -- Claves del par ECDH y secreto de autenticación que genera el navegador.
  -- Sirven para cifrar la carga (RFC 8291). NUNCA salen del servidor.
  p256dh      text not null,
  auth        text not null,

  -- HASH con sal, jamás el user-agent en claro (CONTRATOS §2: `user_agent` no
  -- existe en ninguna respuesta ni en ninguna fila). Sirve para distinguir dos
  -- dispositivos de la misma persona en la lista, y para nada más.
  user_agent_hash text,

  created_at  timestamptz not null default now(),
  -- Última entrega aceptada por el servicio de push. Un `null` viejo es la
  -- señal de una suscripción que nunca funcionó.
  last_ok_at  timestamptz
);

comment on table public.push_subscriptions is
  'Claves de cifrado del navegador. `p256dh` y `auth` NO son legibles por ningún rol de cliente: ni siquiera por su dueño. Si algo necesita leerlas, es el servidor con service_role.';

-- Un endpoint es único GLOBALMENTE: reinstalar la PWA genera uno nuevo, y el
-- viejo hay que poder retirarlo aunque el usuario ya no lo recuerde. Si fuera
-- único por (user_id, endpoint), un endpoint reasignado por el navegador podría
-- quedar colgando de dos cuentas a la vez en el mismo dispositivo — y entonces
-- una persona recibiría los avisos de otra.
create unique index uq_push_subscriptions_endpoint on public.push_subscriptions (endpoint);

-- «Dame las suscripciones de esta persona»: el único acceso del camino de envío.
create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

comment on index public.idx_push_subscriptions_user is
  'select id, endpoint, p256dh, auth from push_subscriptions where user_id = :u. Acotado por persona (unos pocos dispositivos): jamás count(*) sobre esta tabla.';

-- ============================================================================
-- SECCIÓN 2 · PREFERENCIAS
-- ============================================================================

create table public.notification_prefs (
  user_id     uuid primary key references public.profiles(id) on delete cascade,

  -- Mapa tipo→booleano. LO ESCRIBE EL CLIENTE vía PostgREST (ver el grant de
  -- abajo), así que su contenido es NO CONFIABLE en cada LECTURA, no solo al
  -- guardarlo: `sanitizarPrefs()` de lib/push/preferencias.ts se aplica siempre.
  prefs       jsonb not null default '{}'::jsonb,

  -- Horas de silencio en minutos desde medianoche LOCAL de la persona.
  quiet_from  smallint check (quiet_from between 0 and 1439),
  quiet_to    smallint check (quiet_to between 0 and 1439),

  -- Solo el desfase en minutos, NUNCA el nombre de la zona: 'Europe/Madrid' vs
  -- 'Atlantic/Canary' identifica la ciudad, y con eso más un alias se llega
  -- muy lejos en una red que promete anonimato. El desfase lo comparten
  -- millones de personas.
  tz_offset   smallint not null default 0 check (tz_offset between -840 and 840),

  updated_at  timestamptz not null default now()
);

comment on column public.notification_prefs.prefs is
  'jsonb escribible por el cliente. Trátalo como entrada no confiable EN CADA LECTURA (sanitizarPrefs), no solo al escribirlo.';

-- `updated_at` no se concede al cliente (ver grants), así que lo mantiene un
-- trigger: sin él, la columna mentiría en cuanto alguien escribiera por
-- PostgREST en vez de por la ruta.
create or replace function public.notification_prefs_touch() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_notification_prefs_touch
  before update on public.notification_prefs
  for each row execute function public.notification_prefs_touch();

-- ============================================================================
-- SECCIÓN 3 · ESTADO DE REPARTO (techo, agrupación y silencio)
--
-- La política antiadicción necesita memoria: cuándo se mandó el último aviso de
-- cada tipo (agrupación de 30 min) y cuántos eventos quedaron acumulados
-- durante las horas de silencio (que se ENTREGAN al terminar, no se descartan).
--
-- Es infraestructura del servidor, como `rate_limits` de 0002: RLS activada y
-- CERO políticas. Que el cliente pudiera leerla sería filtrar el ritmo de
-- actividad dirigido a cada persona.
-- ============================================================================

create table public.push_dispatch_state (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  -- Texto y no enum: los tipos los define lib/push/preferencias.ts y añadir uno
  -- no debe exigir un ALTER TYPE con lock sobre una tabla caliente. El conjunto
  -- válido lo impone el servidor, que es el único que escribe aquí.
  tipo           text not null,

  last_sent_at   timestamptz,
  -- Eventos ocurridos que todavía no se han anunciado (agrupación o silencio).
  -- Es lo que convierte «3 avisos» en «3 personas te escucharon».
  pendientes     integer not null default 0 check (pendientes >= 0),
  -- Cuándo se puede entregar lo acumulado (fin de las horas de silencio).
  diferido_hasta timestamptz,

  primary key (user_id, tipo)
);

comment on table public.push_dispatch_state is
  'Memoria de la política antiadicción: agrupación de 30 min y entrega diferida de lo acumulado en horas de silencio. Infraestructura de servidor, sin políticas RLS (mismo patrón que rate_limits).';

-- La barrida del diferido: «¿qué hay que entregar ya?». Índice parcial, así que
-- su tamaño es el del backlog real y no el del histórico.
create index idx_push_dispatch_pendiente on public.push_dispatch_state (diferido_hasta)
  where pendientes > 0;

-- ============================================================================
-- SECCIÓN 4 · FUNCIONES DE SERVIDOR
--
-- Las dos son `security definer` y están concedidas SOLO a `service_role`.
-- Motivo, y es el mismo que documenta 0002 para sus helpers: una función que
-- acepta uuids de terceros y responde un booleano es un oráculo. Concedida a
-- `authenticated`, `is_blocked_between(a, b)` permitiría sondear si Fulano
-- bloqueó a Mengano, y `destinatarios_alma_afin()` permitiría enumerar quién
-- tiene guardado a quién — justo lo que `kindred_read_own` de 0002 protege.
-- El envío de push ocurre en el servidor, así que `service_role` basta.
-- ============================================================================

-- ¿Hay un bloqueo vivo entre estas dos personas, en cualquier dirección?
-- Existe porque el bloqueo SE APLICA ANTES DE ENVIAR: que alguien bloqueado no
-- pueda escribirte pero sí hacer vibrar tu teléfono a las 3 de la madrugada
-- sería un agujero grande, y del tipo que no deja rastro en ninguna tabla.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to service_role;

-- Destinatarios del aviso de disponibilidad: quién tiene guardada como Alma
-- Afín a la persona que acaba de marcar «necesito hablar».
--
-- El sentido inverso de `kindred` ya está indexado en 0002 (`idx_kindred_reverse`)
-- exactamente para esto. Sin ese índice sería un seq scan de la tabla entera
-- cada vez que alguien cambia su disponibilidad — y ese cambio es frecuente.
create or replace function public.destinatarios_alma_afin(p_usuario uuid)
returns table (owner_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select k.owner_id
    from public.kindred k
   where k.kindred_id = p_usuario
     and not public.is_blocked_between(k.owner_id, k.kindred_id);
$$;

revoke all on function public.destinatarios_alma_afin(uuid) from public, anon, authenticated;
grant execute on function public.destinatarios_alma_afin(uuid) to service_role;

-- ============================================================================
-- SECCIÓN 5 · RLS
-- Denegado por defecto: activar RLS sin política que conceda acceso es DENEGAR.
-- ============================================================================

alter table public.push_subscriptions  enable row level security;
alter table public.notification_prefs  enable row level security;
alter table public.push_dispatch_state enable row level security;

-- push_dispatch_state: NINGUNA política. Deliberado (ver sección 3).

-- Cada quien ve y retira SOLO sus suscripciones. El INSERT no tiene política ni
-- privilegio: entra por el servidor, que es el único que puede comprobar que el
-- endpoint es de un servicio de push conocido (si no, la tabla se convierte en
-- una lista de URLs arbitrarias a las que nuestro servidor hace POST: SSRF).
create policy push_read_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

create policy push_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy prefs_read_own on public.notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));

create policy prefs_upsert_own on public.notification_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy prefs_update_own on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ============================================================================
-- SECCIÓN 6 · PRIVILEGIOS DE COLUMNA
-- La mitad que se olvida. Ver la cabecera de este archivo.
-- ============================================================================

-- ── push_subscriptions ──────────────────────────────────────────────────────
-- Se enumera lo legible en vez de recortar lo prohibido: la columna que alguien
-- añada mañana nace SIN privilegio, que es el fallo correcto.
--
-- Fuera del alcance de `authenticated`, a propósito:
--   · `p256dh` / `auth`  → material criptográfico. El navegador ya los tiene
--     (los generó él); devolvérselos no habilita ninguna función y sí amplía la
--     superficie de una fuga.
--   · `endpoint`         → capability URL del servicio de push. Para retirar un
--     dispositivo basta su `id`, que sí es legible.
--   · `user_id`          → no hace falta: RLS ya filtra la fila. Leerlo solo
--     serviría para confirmar el propio uuid, que la sesión ya conoce.
--   · `user_agent_hash`  → un hash estable es un identificador de dispositivo;
--     no se publica ni al propio usuario.
--
-- Con esto, la pantalla «mis dispositivos» funciona (id + cuándo se creó +
-- cuándo funcionó por última vez) sin que exista ninguna consulta capaz de
-- devolver una clave.
revoke all on public.push_subscriptions from anon, authenticated;
grant  select (id, created_at, last_ok_at) on public.push_subscriptions to authenticated;
grant  delete on public.push_subscriptions to authenticated;
-- INSERT y UPDATE: NINGUNO, ni por columna. Repetido explícitamente porque un
-- `revoke all` se lee rápido y esta ausencia es una decisión, no un olvido.
revoke insert, update on public.push_subscriptions from anon, authenticated;

-- ── notification_prefs ──────────────────────────────────────────────────────
-- Aquí sí se concede escritura directa al cliente: son SUS preferencias y no
-- hay ninguna invariante económica que proteger. `updated_at` queda fuera (lo
-- pone el trigger) y `user_id` solo es escribible en el INSERT, donde la
-- política `prefs_upsert_own` ya lo ata a `auth.uid()`.
revoke all on public.notification_prefs from anon, authenticated;
grant  select (user_id, prefs, quiet_from, quiet_to, tz_offset, updated_at)
       on public.notification_prefs to authenticated;
grant  insert (user_id, prefs, quiet_from, quiet_to, tz_offset)
       on public.notification_prefs to authenticated;
grant  update (prefs, quiet_from, quiet_to, tz_offset)
       on public.notification_prefs to authenticated;
revoke delete on public.notification_prefs from anon, authenticated;

-- ── push_dispatch_state ─────────────────────────────────────────────────────
-- Sin políticas y sin privilegios. Solo `service_role`.
revoke all on public.push_dispatch_state from anon, authenticated;
