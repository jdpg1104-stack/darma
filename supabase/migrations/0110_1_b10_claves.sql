-- ============================================================================
-- Darma · 0110_1 · B10 · Refugios: directorio de claves, sobres, copia de
--                        seguridad de identidad y cierre de la escritura de
--                        columnas de las tablas de refugio.
--
-- 0002 dejó el chat cifrado listo por el lado de las FILAS (RLS) pero no por el
-- de las COLUMNAS: `refuges`, `refuge_members`, `refuge_messages`, `kindred` y
-- `blocks` conservaban el INSERT íntegro para `authenticated`. Es exactamente el
-- agujero que documenta 0004 para `posts` y `comments`, en cinco tablas más.
-- Ver la sección 4 de este archivo: es la parte más importante de la migración.
--
-- Lo que este archivo AÑADE al modelo criptográfico (nada de esto es secreto):
--   · user_keys             — clave PÚBLICA de identidad (ECDH P-256). Pública
--                             por definición: sin ella no hay intercambio.
--   · refuge_key_envelopes  — la clave simétrica del refugio, YA CIFRADA para
--                             cada miembro. Para Postgres es un blob opaco.
--   · identity_backups      — copia OPCIONAL de la clave privada, envuelta con
--                             una frase de recuperación que el servidor NUNCA
--                             ve. Sin frase no hay backup y no hay recuperación.
--
-- CIFRADO: AES-256-GCM con nonce de 12 bytes aleatorios, intercambio ECDH P-256
-- + HKDF-SHA256. XChaCha20-Poly1305 sería mejor por su nonce de 24 bytes, pero
-- WebCrypto no lo implementa y meter una librería de criptografía en el bundle
-- para el camino más sensible de la app es peor negocio que usar lo que la
-- plataforma ya trae auditado. Razonado entero en HANDOFF/B10.md §2.
-- ============================================================================

-- ============================================================================
-- SECCIÓN 1 · user_keys — el directorio de claves públicas
-- ============================================================================

create table if not exists public.user_keys (
  user_id      uuid primary key references public.profiles(id) on delete cascade,

  -- JWK pública de ECDH P-256 (kty EC, crv P-256, x, y). SIN la parte privada:
  -- el `check` de más abajo es una barrera de motor, no una convención, porque
  -- un cliente con un bug podría subir la JWK entera y entonces el cifrado
  -- extremo a extremo dejaría de existir sin que nadie se enterase.
  public_jwk   jsonb not null,

  -- Huella SHA-256 de la JWK canonicalizada, en hex. Es el "número de
  -- seguridad" que dos personas comparan para detectar que el servidor les ha
  -- servido una clave falsa.
  fingerprint  text not null check (fingerprint ~ '^[0-9a-f]{64}$'),

  -- Sube al rotar (dispositivo nuevo). Los sobres viejos quedan ilegibles: eso
  -- es una propiedad, no un fallo. Ver HANDOFF/B10.md §4.
  key_version  smallint not null default 1 check (key_version >= 1),

  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,

  constraint user_keys_jwk_publica check (
    public_jwk->>'kty' = 'EC'
    and public_jwk->>'crv' = 'P-256'
    and public_jwk ? 'x' and public_jwk ? 'y'
    -- 'd' es la componente PRIVADA de una JWK EC. Si aparece aquí, alguien está
    -- subiendo su clave privada al servidor.
    and not (public_jwk ? 'd')
  )
);

comment on table public.user_keys is
  'Directorio de claves PÚBLICAS de identidad (ECDH P-256). Legible por cualquier sesión a propósito: ocultar una clave pública no aporta seguridad y rompe el intercambio.';
comment on column public.user_keys.public_jwk is
  'JWK pública. El check user_keys_jwk_publica rechaza la componente privada `d`.';

-- ============================================================================
-- SECCIÓN 2 · refuge_key_envelopes — un sobre por miembro
-- ============================================================================

create table if not exists public.refuge_key_envelopes (
  refuge_id    uuid not null references public.refuges(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,

  -- AES-GCM sobre la clave del refugio, con el KEK derivado por ECDH+HKDF entre
  -- emisor y receptor. Opaco para la base de datos.
  wrapped_key  bytea not null check (octet_length(wrapped_key) between 16 and 512),
  wrap_nonce   bytea not null check (octet_length(wrap_nonce) between 12 and 24),

  -- Huella de la clave pública del emisor EN EL MOMENTO de envolver: permite
  -- detectar que el emisor rotó y que este sobre ya no corresponde.
  sender_fingerprint text not null check (sender_fingerprint ~ '^[0-9a-f]{64}$'),

  key_version  smallint not null default 1 check (key_version >= 1),
  created_at   timestamptz not null default now(),

  primary key (refuge_id, recipient_id)
);

comment on table public.refuge_key_envelopes is
  'Clave del refugio cifrada por miembro. El servidor ve un blob. Un sobre no se edita: se sustituye borrando la pertenencia y volviendo a invitar.';

-- El acceso real es siempre "dame mis sobres" (al abrir la bandeja) y "dame mi
-- sobre de este refugio" (al abrir el hilo). La PK indexa (refuge_id,
-- recipient_id); este índice cubre el otro sentido, que es el que se ejecuta.
create index if not exists idx_envelopes_recipient
  on public.refuge_key_envelopes (recipient_id, refuge_id);

-- ============================================================================
-- SECCIÓN 3 · identity_backups — la copia OPCIONAL
--
-- Desactivada por defecto. Quien no la active pierde el historial al perder el
-- dispositivo, y eso es el comportamiento correcto: cualquier recuperación por
-- email, por soporte o por verificación de identidad obligaría a que Darma
-- tuviera la clave, y entonces el cifrado extremo a extremo sería teatro.
-- ============================================================================

create table if not exists public.identity_backups (
  user_id          uuid primary key references public.profiles(id) on delete cascade,

  -- La clave privada de identidad, envuelta con el KEK derivado de la frase de
  -- 12 palabras. Sin la frase esto es ruido, y la frase no existe en ninguna
  -- columna de esta base de datos.
  wrapped_identity bytea not null check (octet_length(wrapped_identity) between 32 and 4096),
  wrap_nonce       bytea not null check (octet_length(wrap_nonce) between 12 and 24),
  kdf_salt         bytea not null check (octet_length(kdf_salt) between 16 and 64),

  -- Suelo, no sugerencia: por debajo de 600 000 iteraciones de PBKDF2-SHA256 la
  -- frase se puede atacar por fuerza bruta con hardware de consumo si algún día
  -- se filtrara un dump. El `check` impide que un cliente viejo o manipulado
  -- suba un backup débil.
  kdf_iterations   integer not null check (kdf_iterations >= 600000),

  created_at       timestamptz not null default now()
);

comment on table public.identity_backups is
  'Copia de seguridad OPT-IN de la clave de identidad. Darma no puede abrirla: la frase de recuperación se genera y se queda en el cliente.';

-- ============================================================================
-- SECCIÓN 4 · CERRAR LA ESCRITURA DE COLUMNAS EN LAS TABLAS DE REFUGIO
--
-- ⚠️ Esta sección es lo más importante del archivo.
--
-- Comprobado contra darma-dev antes de escribirla: `authenticated` tenía INSERT
-- sobre TODAS las columnas de las cinco tablas. RLS decide filas; solo el
-- privilegio de columna decide columnas (0004). Lo que eso permitía con un solo
-- POST a PostgREST, sin tocar la app:
--
--   · refuge_messages.created_at — el trigger refuge_messages_sync() copia ese
--     valor a refuges.last_message_at, que es la clave de orden de la bandeja de
--     TODOS los miembros. Un created_at en el año 2400 fija tu conversación
--     arriba del todo para siempre en el móvil de la otra persona. Es acoso con
--     un campo de fecha.
--   · refuge_messages.state — un mensaje que nace 'removed' es invisible para la
--     política de lectura pero cuenta en message_count.
--   · refuge_members.is_host — autoascenderse a anfitrión es el permiso de
--     invitar. Quien entra a un círculo puede meter en él a quien quiera.
--   · refuge_members.left_at — insertar la fila ya con left_at hace que el
--     trigger de aforo cuente una plaza que nadie ocupa.
--   · refuges.member_count / message_count — contadores inventados; con
--     member_count = max_members el refugio nace lleno y nadie puede entrar.
--   · blocks.created_at / kindred.created_at — reescribir la cronología de un
--     bloqueo es reescribir la prueba de cuándo alguien pidió que le dejaran en
--     paz.
--
-- La regla, otra vez y para toda tabla futura: ENUMERAR lo que el cliente puede
-- escribir. Nunca confiar en que una política de fila proteja una columna.
-- ============================================================================

-- Refugios: el cliente declara qué sala quiere, no su estado. `created_by` se
-- concede porque la política `refuges_insert_own` ya lo ata a auth.uid().
revoke insert on public.refuges from anon, authenticated;
grant  insert (kind, title, topic, created_by, max_members) on public.refuges to authenticated;

-- Miembros: entrar es declarar quién y a dónde. `is_host` lo decide quien crea
-- la sala (vía la RPC de más abajo), nunca quien entra.
revoke insert on public.refuge_members from anon, authenticated;
grant  insert (refuge_id, user_id) on public.refuge_members to authenticated;

-- Mensajes: la carga cifrada y sus metadatos de pintado. Ni `state`, ni
-- `created_at`, ni `id`.
revoke insert on public.refuge_messages from anon, authenticated;
grant  insert (refuge_id, sender_id, ciphertext, nonce, enc_version, kind, byte_size)
  on public.refuge_messages to authenticated;

-- Almas afines y bloqueos: sin `created_at`.
revoke insert on public.kindred from anon, authenticated;
grant  insert (owner_id, kindred_id, note) on public.kindred to authenticated;

revoke insert on public.blocks from anon, authenticated;
grant  insert (blocker_id, blocked_id, mode, reason) on public.blocks to authenticated;

-- ============================================================================
-- SECCIÓN 5 · RLS de las tres tablas nuevas
-- ============================================================================

alter table public.user_keys            enable row level security;
alter table public.refuge_key_envelopes enable row level security;
alter table public.identity_backups     enable row level security;

-- ── user_keys ──────────────────────────────────────────────────────────────
-- Lectura abierta a cualquier sesión: una clave pública es pública. Esconderla
-- no protege nada (no permite descifrar ni firmar) y sí impide que dos personas
-- que quieren hablar deriven su secreto compartido.
create policy user_keys_read_all on public.user_keys
  for select to authenticated using (true);

create policy user_keys_insert_own on public.user_keys
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy user_keys_update_own on public.user_keys
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.user_keys from anon, authenticated;
grant  insert (user_id, public_jwk, fingerprint, key_version) on public.user_keys to authenticated;
-- Rotar es reescribir la propia clave. `created_at` no se toca: la fecha de
-- alta original es lo que permite distinguir una rotación de un alta.
grant  update (public_jwk, fingerprint, key_version, rotated_at) on public.user_keys to authenticated;
-- Sin DELETE: borrar tu clave pública dejaría los sobres que otros te enviaron
-- sin forma de comprobar contra quién se envolvieron.
revoke delete on public.user_keys from anon, authenticated;

-- ── refuge_key_envelopes ───────────────────────────────────────────────────
-- SOLO el destinatario lee su sobre. Ni el emisor: una vez enviado, no hay
-- ninguna razón para volver a leerlo, y poder listarlos sería poder enumerar
-- quién está en qué sala.
create policy envelopes_read_recipient on public.refuge_key_envelopes
  for select to authenticated using (recipient_id = (select auth.uid()));

-- Enviar exige las tres cosas a la vez: ser tú el emisor, seguir siendo miembro
-- de la sala, y que no haya bloqueo vivo con el destinatario. La tercera es la
-- que impide que un sobre sea la vía para alcanzar a quien te bloqueó.
create policy envelopes_insert_member on public.refuge_key_envelopes
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and public.is_refuge_member(refuge_id)
    and not public.refuge_has_block(refuge_id, recipient_id)
    and not public.is_blocked_with(recipient_id)
  );

revoke insert, update, delete on public.refuge_key_envelopes from anon, authenticated;
grant  insert (refuge_id, recipient_id, sender_id, wrapped_key, wrap_nonce, sender_fingerprint, key_version)
  on public.refuge_key_envelopes to authenticated;
-- Un sobre NO se edita. Reenvolver la clave (porque alguien rotó) es borrar la
-- pertenencia y volver a invitar, que es lo que deja rastro en member_count y en
-- el mensaje de sistema del hilo.
revoke update, delete on public.refuge_key_envelopes from anon, authenticated;

-- ── identity_backups ───────────────────────────────────────────────────────
-- Solo la propia fila, en los tres verbos. El DELETE existe y es importante:
-- "desactivar la copia de seguridad" tiene que borrar de verdad el blob, no
-- marcarlo.
create policy identity_backups_read_own on public.identity_backups
  for select to authenticated using (user_id = (select auth.uid()));

create policy identity_backups_insert_own on public.identity_backups
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy identity_backups_delete_own on public.identity_backups
  for delete to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.identity_backups from anon, authenticated;
grant  insert (user_id, wrapped_identity, wrap_nonce, kdf_salt, kdf_iterations)
  on public.identity_backups to authenticated;
grant  delete on public.identity_backups to authenticated;
-- Sin UPDATE a propósito: cambiar la frase es borrar el backup y crear otro, y
-- así el created_at dice la verdad sobre cuándo se generó la frase que hoy vale.
revoke update on public.identity_backups from anon, authenticated;

-- ============================================================================
-- SECCIÓN 6 · b10_crear_refugio — crear sala y pertenencias en UNA transacción
--
-- Por qué una función y no tres inserts desde el cliente RLS: un refugio sin
-- miembros es basura invisible (nadie lo puede leer, ni siquiera quien lo creó,
-- porque `refuges_read_member` exige pertenencia), y con tres viajes de red
-- cualquier fallo intermedio deja exactamente eso. Aquí o existe la sala con
-- toda su gente, o no existe nada.
--
-- Es `security definer` PERO no rodea ninguna política: reimplementa las mismas
-- condiciones que `refuge_members_join` (bloqueo en cualquier dirección) y saca
-- SIEMPRE el creador de auth.uid(), nunca de un parámetro. Lo único que gana
-- respecto al cliente RLS es la atomicidad.
-- ============================================================================

create or replace function public.b10_crear_refugio(
  p_kind      public.refuge_kind,
  p_title     text,
  p_topic     text,
  p_miembros  uuid[]
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo       uuid := (select auth.uid());
  v_refugio  uuid;
  v_max      smallint;
  v_otros    uuid[];
  v_a        uuid;
  v_b        uuid;
begin
  if v_yo is null then
    raise exception 'sin sesion' using errcode = '42501';
  end if;

  -- Nunca se puede meter al creador dos veces ni "invitarse" a uno mismo.
  select coalesce(array_agg(distinct m), '{}')
    into v_otros
    from unnest(coalesce(p_miembros, '{}'::uuid[])) as m
   where m <> v_yo;

  v_max := (array_length(v_otros, 1) + 1)::smallint;
  if v_max is null then v_max := 1; end if;

  -- Un 'duo' es exactamente dos personas; un círculo, de 2 a 8. El aforo se
  -- fija aquí y no lo elige el cliente: `max_members` ya no está entre las
  -- columnas que puede escribir (sección 4) precisamente para esto.
  if p_kind = 'duo' and v_max <> 2 then
    raise exception 'un duo son exactamente dos personas' using errcode = '23514';
  end if;
  if v_max < 2 or v_max > 8 then
    raise exception 'un refugio son entre 2 y 8 personas' using errcode = '23514';
  end if;

  -- Bloqueo entre CUALQUIER par de futuros miembros, no solo contra el creador:
  -- meter en la misma sala a dos personas que se bloquearon mutuamente haría
  -- que `refuge_has_block` la volviera invisible para las dos y el refugio
  -- naciera muerto, sin explicación en ninguna pantalla.
  foreach v_a in array (v_otros || v_yo) loop
    foreach v_b in array (v_otros || v_yo) loop
      if v_a < v_b and exists (
        select 1 from public.blocks b
         where (b.blocker_id = v_a and b.blocked_id = v_b)
            or (b.blocker_id = v_b and b.blocked_id = v_a)
      ) then
        raise exception 'hay un bloqueo entre dos de estas personas' using errcode = '42501';
      end if;
    end loop;
  end loop;

  insert into public.refuges (kind, title, topic, created_by, max_members)
  values (p_kind, nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_topic, '')), ''), v_yo, v_max)
  returning id into v_refugio;

  insert into public.refuge_members (refuge_id, user_id, is_host)
  values (v_refugio, v_yo, true);

  insert into public.refuge_members (refuge_id, user_id, is_host)
  select v_refugio, m, false from unnest(v_otros) as m;

  return v_refugio;
end;
$$;

revoke all on function public.b10_crear_refugio(public.refuge_kind, text, text, uuid[]) from public, anon;
grant execute on function public.b10_crear_refugio(public.refuge_kind, text, text, uuid[]) to authenticated;

-- ============================================================================
-- SECCIÓN 7 · b10_bandeja — keyset de la bandeja, SIN salirse de RLS
--
-- `security invoker` a propósito (mismo criterio que mi_historial_karma de
-- B05): las políticas de `refuges` y `refuge_members` siguen siendo la barrera.
-- La función existe solo para poder escribir la comparación de TUPLA, que es lo
-- que hace que el keyset use idx_refuges_activity entero y que PostgREST no
-- sabe expresar.
-- ============================================================================

create or replace function public.b10_bandeja(
  p_cursor_ts timestamptz,
  p_cursor_id uuid,
  p_limite    integer
) returns table (
  id                   uuid,
  kind                 public.refuge_kind,
  title                text,
  member_count         smallint,
  message_count        integer,
  last_message_at      timestamptz,
  last_read_message_id bigint,
  muted                boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select r.id, r.kind, r.title, r.member_count, r.message_count, r.last_message_at,
         m.last_read_message_id, m.muted
    from public.refuges r
    join public.refuge_members m
      on m.refuge_id = r.id
     and m.user_id = (select auth.uid())
     and m.left_at is null
   where r.archived_at is null
     -- `coalesce(last_message_at, created_at)` porque un refugio recién creado
     -- todavía no tiene mensajes y con NULL desaparecería de la página 2 en
     -- adelante: la comparación de tupla no casa con NULL.
     and (p_cursor_ts is null
          or (coalesce(r.last_message_at, r.created_at), r.id) < (p_cursor_ts, p_cursor_id))
   order by coalesce(r.last_message_at, r.created_at) desc, r.id desc
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

revoke all on function public.b10_bandeja(timestamptz, uuid, integer) from public, anon;
grant execute on function public.b10_bandeja(timestamptz, uuid, integer) to authenticated;

-- ============================================================================
-- SECCIÓN 8 · b10_limitar — rate limiting real sin el cliente admin
--
-- `check_rate_limit()` (0002) está concedida SOLO a service_role, y B10 tiene
-- prohibido el cliente admin. Sin esta función el bloque se quedaría en la capa
-- de memoria, que con N instancias en Vercel es N veces el límite configurado.
--
-- Dos detalles que la hacen segura de conceder a `authenticated`:
--   1. El SUJETO sale de auth.uid() por dentro. No se puede gastar el cupo de
--      otra persona ni sondear el de nadie.
--   2. Los NÚMEROS están aquí dentro, no en los parámetros. Si el límite viniera
--      del cliente, bastaría con pedir 1 000 000 para no tener límite — que es
--      el error clásico al mover un rate limit al lado del que lo sufre.
-- ============================================================================

create or replace function public.b10_limitar(p_accion text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo      uuid := (select auth.uid());
  v_limite  integer;
  v_ventana integer;
begin
  if v_yo is null then
    raise exception 'sin sesion' using errcode = '42501';
  end if;

  case p_accion
    when 'refuge_msg'     then v_limite := 30;  v_ventana := 60;      -- 30/min
    when 'refugio_crear'  then v_limite := 5;   v_ventana := 3600;    -- 5/hora
    when 'kindred'        then v_limite := 20;  v_ventana := 60;      -- 20/min
    when 'bloquear'       then v_limite := 20;  v_ventana := 60;      -- 20/min
    -- Rotar la clave de identidad tres veces al día no es un uso legítimo: es
    -- una sonda contra el directorio de claves.
    when 'keys'           then v_limite := 3;   v_ventana := 86400;   -- 3/día
    when 'sobre'          then v_limite := 60;  v_ventana := 3600;
    when 'leido'          then v_limite := 120; v_ventana := 60;
    when 'refugio_leer'   then v_limite := 120; v_ventana := 60;
    when 'crisis_refugio' then v_limite := 20;  v_ventana := 3600;
    else raise exception 'accion desconocida' using errcode = '22023';
  end case;

  return public.check_rate_limit('b10:' || p_accion || ':' || v_yo::text, v_limite, v_ventana);
end;
$$;

revoke all on function public.b10_limitar(text) from public, anon;
grant execute on function public.b10_limitar(text) to authenticated;

-- ============================================================================
-- SECCIÓN 9 · b10_registrar_crisis_refugio — el nivel de riesgo, NUNCA el texto
--
-- El servidor no puede leer un mensaje de refugio, así que `assessCrisisRisk()`
-- corre EN EL CLIENTE sobre el texto en claro, antes de cifrar. Lo único que
-- viaja hasta aquí es el nivel y el refugio.
--
-- `crisis_events` no tiene ninguna política RLS ni ningún privilegio para
-- `authenticated` (0002, sección 5) y así debe seguir: es la tabla que dice
-- quién está en riesgo. Esta función es la única puerta, y solo escribe.
--
-- El `user_id` sale de auth.uid(). Que no se pueda declarar en crisis a otra
-- persona no es un detalle de implementación: sería una forma de marcar a
-- alguien en la cola de revisión humana desde fuera.
-- ============================================================================

create or replace function public.b10_registrar_crisis_refugio(
  p_refuge         uuid,
  p_risk           public.risk_level,
  p_recursos       text[],
  p_country_code   text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo uuid := (select auth.uid());
begin
  if v_yo is null then
    raise exception 'sin sesion' using errcode = '42501';
  end if;

  -- Solo se registra crisis en una sala de la que se es miembro. Sin esto, el
  -- parámetro sería un oráculo para saber si un uuid de refugio existe.
  if not public.is_refuge_member(p_refuge) then
    raise exception 'no encontrado' using errcode = '42501';
  end if;

  -- 'none' y 'low' no entran en la cola: CONTRATOS §9 solo exige intervención a
  -- partir de 'high'. Escribir los otros dos llenaría de ruido el índice
  -- parcial idx_crisis_pending, que es la cola que un humano mira cada pocos
  -- segundos.
  if p_risk not in ('high', 'critical') then
    return;
  end if;

  insert into public.crisis_events (user_id, ref_type, ref_id, risk, resources_shown, country_code)
  values (v_yo, 'refuge_message', p_refuge, p_risk, coalesce(p_recursos, '{}'), p_country_code);
end;
$$;

revoke all on function public.b10_registrar_crisis_refugio(uuid, public.risk_level, text[], text) from public, anon;
grant execute on function public.b10_registrar_crisis_refugio(uuid, public.risk_level, text[], text) to authenticated;

-- ============================================================================
-- SECCIÓN 10 · Realtime
--
-- La publicación `supabase_realtime` solo llevaba `comments` (0104_1). Se añade
-- `refuge_messages`: Realtime respeta RLS, así que un no miembro no recibe nada
-- aunque se suscriba al canal. Aun así el cliente descarta todo payload cuyo
-- refuge_id no coincida con el del hilo abierto — dos barreras, porque esta es
-- la única que se ve desde el navegador.
--
-- `refuges` y `refuge_members` NO se publican: la bandeja se refresca al volver
-- a ella. Un canal por refugio de la bandeja son miles de suscripciones por
-- cliente y tumba el servicio (HANDOFF/B10.md, trampa 4).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'refuge_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.refuge_messages';
  end if;
end;
$$;
