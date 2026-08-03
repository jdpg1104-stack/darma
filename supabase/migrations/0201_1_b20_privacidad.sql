-- ============================================================================
-- Darma · 0201 · B20 · Privacidad, RGPD y legales
--
-- Tres cosas y ninguna más:
--   1. Consentimientos VERSIONADOS con la huella del texto exacto que se aceptó.
--   2. Solicitudes de privacidad (exportación y borrado) con confirmación en dos
--      pasos: se guarda el HASH del token, nunca el token.
--   3. `borrar_usuario()` — el borrado real, en UNA transacción, con la política
--      de integridad del hilo escrita en el propio SQL.
--
-- ── LA DECISIÓN QUE GOBIERNA TODO ESTE ARCHIVO ─────────────────────────────
-- Tu borrado no puede robarle a otra persona el apoyo que recibió.
--
-- Lo que la persona escribió SOBRE SÍ MISMA se elimina (posts → lápida). Lo que
-- escribió PARA OTROS se conserva intacto, atribuido a un perfil ya anonimizado
-- (art. 17.3 RGPD: el derecho al borrado cede ante derechos de terceros, y la
-- anonimización cumple el objetivo real — que nadie pueda saber quién lo
-- escribió). Borrar los comentarios dejaría al autor del post sin el apoyo que
-- recibió, con `reply_count` mintiendo y su «me ayudó» apuntando al vacío.
--
-- ── POR QUÉ SE ELIMINA LA FK profiles.id → auth.users ──────────────────────
-- `profiles.id references auth.users(id) on delete cascade`, y de `profiles`
-- cuelgan en cascada `posts`, `comments`, `karma_events`, `crystal_ledger`,
-- `crisis_events`, `content_views`, `poll_votes`, `refuge_members`… Un
-- `delete from auth.users` a secas destruye:
--   · los COMENTARIOS con los que la persona acompañó a otros (y con ellos el
--     `reply_count` de posts ajenos, que lo mantiene un trigger que NO se
--     dispara en el delete: quedaría desincronizado para siempre),
--   · `crystal_ledger`, que hay que conservar 6 años por obligación mercantil,
--   · `crisis_events`, justo el registro que existe para poder responder ante
--     un regulador o una familia.
--
-- Es decir: la cascada convierte el ejercicio de un derecho de una persona en
-- una destrucción de datos de terceros y de registros legalmente obligatorios.
-- No hay forma de desactivar una cascada «solo para este delete»: o está o no
-- está. Y `profiles.id` es la clave primaria, así que `on delete set null`
-- tampoco es una opción.
--
-- Lo que la FK protegía DE VERDAD era el lado del INSERT — que no exista un
-- perfil sin usuario de auth —, y eso se restituye aquí con un trigger
-- `before insert` que comprueba exactamente eso. Lo que se pierde es solo el
-- lado del DELETE, que era la bomba. Tras `borrar_usuario()` el perfil queda
-- deliberadamente huérfano: es una LÁPIDA, un seudónimo sin persona detrás, y
-- esa orfandad es el estado correcto, no una inconsistencia.
--
-- ── REGLAS DE ESQUEMA QUE ESTE ARCHIVO RESPETA ─────────────────────────────
--  · RLS decide FILAS; solo los privilegios de columna deciden COLUMNAS. Todo
--    lo escribible por el cliente se enumera con `grant insert (…)`. Aquí el
--    cliente no escribe NADA: las tres tablas son de servidor.
--  · Ninguna política RLS consulta otra tabla con subconsulta (ver la cabecera
--    de 0005 y `esta_silenciado()`). La única política de este archivo compara
--    contra `auth.uid()` y punto.
--  · Solo se AÑADE. No se modifica 0001 ni 0002 (salvo el `drop constraint`
--    razonado arriba y la columna `deleted_at`, ambos aditivos en su migración
--    propia).
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.privacy_request_kind  as enum ('export', 'erase');
create type public.privacy_request_state as enum
  ('pending_confirm', 'confirmed', 'processing', 'done', 'failed', 'cancelled');

-- ============================================================================
-- consents — consentimiento VERSIONADO con la huella del texto exacto.
--
-- `text_sha256` es lo que convierte «aceptó los términos» en una afirmación
-- comprobable: sin la huella, la frase no significa nada porque los términos
-- cambiaron después. La PK incluye la versión a propósito — aceptar la v2 no
-- borra el rastro de haber aceptado la v1.
-- ============================================================================
create table public.consents (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in
                ('terminos', 'privacidad', 'no_es_terapia', 'edad_minima', 'datos_agregados')),
  version     text not null check (char_length(version) between 1 and 32),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (user_id, kind, version)
);

comment on table public.consents is
  'Consentimiento por (persona, tipo, versión) con sha256 del texto EXACTO servido. Lo escribe el servidor tras servir el texto; el cliente nunca afirma que aceptó.';

-- ============================================================================
-- privacy_requests — solicitudes de exportación y borrado.
--
-- RLS activada y CERO políticas: mismo patrón deliberado que `identity_vault`
-- en 0001 y que `moderation_flags` en 0002. Solo `service_role`.
--
-- `token_sha256`: se guarda el HASH del token de confirmación, nunca el token.
-- Un volcado de esta tabla no permite confirmar el borrado de nadie.
-- ============================================================================
create table public.privacy_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         public.privacy_request_kind not null,
  state        public.privacy_request_state not null default 'pending_confirm',
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  error        text
);

-- La cola del cron de ejecución. Parcial sobre lo que queda por hacer: su
-- tamaño es el del backlog real, no el del histórico de solicitudes.
create index idx_privacy_requests_pendientes on public.privacy_requests (requested_at)
  where state in ('confirmed', 'processing');

-- «¿Cuál es la última solicitud de esta persona?» (GET /api/privacy/exportar).
create index idx_privacy_requests_user on public.privacy_requests (user_id, requested_at desc);

-- ============================================================================
-- retired_aliases — un alias liberado por un borrado NO se puede reclamar.
--
-- Sin esta tabla, alguien registra el alias de una persona que se fue y hereda
-- su historial de hilos ante los ojos de la comunidad: los comentarios viejos
-- siguen ahí, firmados con ese nombre.
--
-- `user_id` (nullable) existe SOLO para que `borrar_usuario()` sea idempotente:
-- al reintentar sobre alguien ya borrado hay que poder devolver el mismo alias
-- retirado. No des-anonimiza a nadie: el vínculo alias↔perfil ya era público
-- por definición (el alias se mostraba en cada post), y el vínculo con la
-- PERSONA REAL murió en el paso 1 al vaciar `identity_vault`. Va con
-- `on delete set null` para que la retirada del alias sobreviva a cualquier
-- borrado posterior de la fila de perfil.
-- ============================================================================
create table public.retired_aliases (
  alias      text primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  retired_at timestamptz not null default now()
);

create index idx_retired_aliases_user on public.retired_aliases (user_id)
  where user_id is not null;

-- ============================================================================
-- profiles.deleted_at — la marca de lápida.
--
-- No se concede a `authenticated` (0001 revocó el `select` sobre `profiles` y
-- concede columna a columna): que una cuenta esté borrada no es información que
-- el resto de la red necesite consultar. El alias `alguien_…` y el shadow-ban
-- ya producen el efecto visible.
-- ============================================================================
alter table public.profiles add column if not exists deleted_at timestamptz;

create index idx_profiles_borrados on public.profiles (deleted_at)
  where deleted_at is not null;

-- ── La FK que se retira, y el trigger que ocupa su lugar ────────────────────
-- Ver la cabecera del archivo. Se pierde la cascada (que era la bomba) y se
-- conserva la garantía real: no puede nacer un perfil sin usuario de auth.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create or replace function public.profiles_exige_auth_user() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not exists (select 1 from auth.users u where u.id = new.id) then
    raise exception 'perfil sin usuario de auth: %', new.id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger trg_profiles_exige_auth_user
  before insert on public.profiles
  for each row execute function public.profiles_exige_auth_user();

comment on function public.profiles_exige_auth_user() is
  'Sustituye el lado INSERT de la FK profiles.id → auth.users, retirada en 0201 porque su ON DELETE CASCADE destruía comentarios de terceros, crystal_ledger y crisis_events al ejercer el derecho de supresión.';

-- El punto 3 de `0003_endurecimiento.sql` revocó EN BLOQUE todas las funciones
-- `returns trigger` de `public`, pero aquel `do $$ … $$` se ejecutó sobre las
-- funciones que existían ENTONCES: la de arriba nace después y hereda otra vez
-- el EXECUTE que PUBLIC tiene por defecto. Hoy no es explotable —Postgres
-- rechaza llamar a una función `returns trigger` fuera de un trigger— pero
-- PostgREST la publica como endpoint RPC, y es `security definer`. La disciplina
-- de 0003 solo vale si cada migración nueva la repite para lo suyo.
revoke all on function public.profiles_exige_auth_user() from public, anon, authenticated;

-- ============================================================================
-- borrar_usuario — EL ALGORITMO. Una transacción, idempotente.
--
-- Devuelve el ESTADO FINAL, no las filas tocadas en esta pasada: por eso
-- repetirla devuelve exactamente lo mismo. Un reintento tras un timeout de red
-- no puede dejar a nadie a medio borrar ni dar un recuento distinto.
-- ============================================================================
create or replace function public.borrar_usuario(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_alias_actual  text;
  v_alias_nuevo   text;
  v_ya_borrado    boolean;
  v_alias_retirado text;
  v_intento       integer := 0;
  v_lapida        constant text :=
    'Esta persona pidió que su cuenta se eliminara. Su texto ya no está aquí. Los comentarios con los que acompañó a otras personas siguen en sus hilos, sin autor identificable, porque borrarlos le quitaría a alguien el apoyo que recibió.';
  v_lapida_encuesta constant text := 'Encuesta retirada a petición de quien la creó.';
  v_posts         integer;
  v_comentarios   integer;
  v_refugios      integer;
  v_auth_borrado  boolean;
begin
  -- ── PASO 1 · identity_vault. DURO, SIEMPRE Y PRIMERO ──────────────────────
  -- Es la única fila del sistema que reidentifica. A partir de aquí todo lo
  -- demás es un seudónimo sin persona detrás, y por eso todo lo demás puede
  -- conservarse. Un borrado que la deje viva no es un borrado: es un cambio de
  -- nombre.
  --
  -- El `contact_hash` que se va es un HMAC con PIMIENTA de servidor
  -- (IDENTITY_PEPPER), no un hash con sal guardada al lado: al desaparecer la
  -- fila no queda absolutamente nada de lo que partir, ni siquiera teniendo la
  -- pimienta. Es irreversible en el sentido fuerte.
  delete from public.identity_vault where user_id = p_user;

  select p.alias, p.deleted_at is not null
    into v_alias_actual, v_ya_borrado
    from public.profiles p
   where p.id = p_user;

  if v_alias_actual is null then
    -- Ni perfil ni nada que anonimizar. Puede pasar en un reintento posterior a
    -- un borrado completo o si alguien nunca terminó el onboarding: no es un
    -- error, es el estado final ya alcanzado.
    return jsonb_build_object(
      'identity_vault_borrado', true,
      'perfil_anonimizado',     false,
      'posts_lapidados',        0,
      'comentarios_conservados', 0,
      'refugios_abandonados',   0,
      'auth_user_borrado',      not exists (select 1 from auth.users u where u.id = p_user),
      'alias_retirado',         coalesce((select r.alias from public.retired_aliases r where r.user_id = p_user limit 1), ''),
      'ya_estaba_borrado',      true,
      'ejecutado_en',           to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  end if;

  if not v_ya_borrado then
    -- ── PASO 2 · Anonimizar el perfil EN EL SITIO, no borrarlo ──────────────
    -- Borrar la fila dispararía las cascadas que destruyen los comentarios con
    -- los que acompañó a otros. Se conserva `karma_reputation` porque de él
    -- depende el nivel que muestran los hilos antiguos, y un número de
    -- reputación no identifica a nadie.
    --
    -- `profiles.alias` es UNIQUE: `alguien_<8hex>` puede colisionar. Con
    -- cientos de miles de borrados a lo largo de los años deja de ser
    -- despreciable, así que se reintenta con otra semilla.
    loop
      v_alias_nuevo := 'alguien_' || encode(gen_random_bytes(4), 'hex');
      exit when not exists (select 1 from public.profiles p where p.alias = v_alias_nuevo)
            and not exists (select 1 from public.retired_aliases r where r.alias = v_alias_nuevo);
      v_intento := v_intento + 1;
      if v_intento > 20 then
        raise exception 'no se pudo generar un alias anónimo libre';
      end if;
    end loop;

    -- El alias viejo se retira ANTES de liberarlo: si alguien lo reclamara,
    -- heredaría una historia de hilos que no es suya.
    insert into public.retired_aliases (alias, user_id)
    values (v_alias_actual, p_user)
    on conflict (alias) do nothing;

    update public.profiles
       set alias           = v_alias_nuevo,
           avatar_seed     = encode(gen_random_bytes(8), 'hex'),
           bio             = null,
           availability    = 'ausente',
           karma_spendable = 0,
           crystals        = 0,
           -- shadow_banned deja de aparecer en feeds y rankings usando las
           -- políticas y los índices parciales QUE YA EXISTEN (0001, 0007). No
           -- hace falta ni una condición nueva en ninguna consulta ajena.
           shadow_banned   = true,
           banned_until    = 'infinity'::timestamptz,
           deleted_at      = now()
     where id = p_user;

    -- ── PASO 3 · Lo que escribió SOBRE SÍ MISMA se elimina ──────────────────
    -- La fila del post SE CONSERVA como lápida: si desapareciera, los
    -- comentarios de quienes la acompañaron quedarían colgando y los
    -- contadores mentirían.
    update public.posts
       set body  = v_lapida,
           topic = null,
           state = 'removed'
     where author_id = p_user
       and state <> 'removed';

    update public.polls
       set question = v_lapida_encuesta,
           state    = 'removed'
     where author_id = p_user
       and state <> 'removed';

    -- ── PASO 4 · Lo que escribió PARA OTROS se conserva ─────────────────────
    -- `comments` queda INTACTO. Ni el body, ni `is_validated`, ni `is_helpful`,
    -- ni el `state`. Es la parte del borrado que una persona no espera, y por
    -- eso está escrita con estas mismas palabras en /legal/privacidad.
    -- Reasignarlos a un «perfil lápida compartido» reventaría contra
    -- `uq_comments_one_listen_per_post (post_id, author_id) where is_validated`
    -- en cuanto dos personas borradas hubieran comentado el mismo post: por eso
    -- la lápida es el MISMO perfil anonimizado, uno por persona.

    -- ── PASO 5 · Refugios ──────────────────────────────────────────────────
    -- Salir, no borrar: borrar la sala reescribiría el historial de quien se
    -- queda. El `ciphertext` se conserva porque el borrado REAL de la
    -- conversación es asunto de las CLAVES, que destruye B10 a petición nuestra
    -- (ver HANDOFF/PEDIDOS.md). Este SQL no puede prometer lo que no controla.
    update public.refuge_members
       set left_at = now()
     where user_id = p_user
       and left_at is null;

    update public.refuge_messages
       set state = 'removed'
     where sender_id = p_user
       and state <> 'removed';

    -- ── PASO 6 · Contabilidad y registros que SOBREVIVEN ────────────────────
    -- `karma_events`, `crystal_ledger`, `crisis_events` y `moderation_flags` se
    -- conservan unidos al perfil ya anonimizado: contabilidad de la economía,
    -- obligación mercantil, y la capacidad de responder «¿qué hizo el sistema
    -- cuando esta persona dijo eso?» (art. 17.3.b y 17.3.e).
    --
    -- Lo que sí se corta es el vínculo con las DENUNCIAS que hizo: su seudónimo
    -- no tiene por qué quedar atado a un reporte.
    update public.moderation_flags
       set reporter_id = null
     where reporter_id = p_user;

    -- Texto libre suyo sobre terceros: se borra el texto, se conserva el efecto
    -- protector del bloqueo (quitar la fila reabriría un canal que alguien
    -- cerró a propósito).
    update public.blocks
       set reason = null
     where blocker_id = p_user
       and reason is not null;

    update public.gifts
       set message = null
     where sender_id = p_user
       and message is not null;

    -- Su libreta privada de almas afines y sus notas sobre otras personas: es
    -- texto suyo y no sostiene nada de nadie.
    delete from public.kindred where owner_id = p_user;

    -- Historial de reproducción: dato de navegación, puramente suyo. Los
    -- contadores agregados de `content_items` no se recalculan a propósito —
    -- son agregados sin persona detrás y recalcularlos exigiría un count(*)
    -- sobre la tabla más grande de la app.
    delete from public.content_views where user_id = p_user;

    -- Sesiones de reproducción abiertas (B07) y segundo factor (B01).
    delete from public.content_sessions where user_id = p_user;
    delete from public.auth_totp where user_id = p_user;
  end if;

  -- ── PASO 7 · auth.users ─────────────────────────────────────────────────
  -- El acceso desaparece para siempre. Ya no hay cascada hacia `profiles` (ver
  -- la cabecera), así que esto solo se lleva por delante lo que debe: sesiones,
  -- refresh tokens, identidades, factores MFA y el correo o teléfono que el
  -- proveedor de auth guardaba.
  delete from auth.users where id = p_user;
  v_auth_borrado := not exists (select 1 from auth.users u where u.id = p_user);

  -- ── Recuento del ESTADO FINAL (no de las filas tocadas) ─────────────────
  select count(*) into v_posts       from public.posts    where author_id = p_user and state = 'removed';
  select count(*) into v_comentarios from public.comments where author_id = p_user;
  select count(*) into v_refugios    from public.refuge_members where user_id = p_user and left_at is not null;

  select r.alias into v_alias_retirado
    from public.retired_aliases r where r.user_id = p_user
   order by r.retired_at limit 1;

  return jsonb_build_object(
    'identity_vault_borrado',  not exists (select 1 from public.identity_vault v where v.user_id = p_user),
    'perfil_anonimizado',      true,
    'posts_lapidados',         v_posts,
    'comentarios_conservados', v_comentarios,
    'refugios_abandonados',    v_refugios,
    'auth_user_borrado',       v_auth_borrado,
    'alias_retirado',          coalesce(v_alias_retirado, ''),
    'ya_estaba_borrado',       v_ya_borrado,
    'ejecutado_en',            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

revoke all on function public.borrar_usuario(uuid) from public, anon, authenticated;
grant execute on function public.borrar_usuario(uuid) to service_role;

comment on function public.borrar_usuario(uuid) is
  'Borrado RGPD en una sola transacción e idempotente. identity_vault primero y duro; perfil anonimizado en el sitio; posts propios a lápida; comentarios ajenos INTACTOS (art. 17.3); ledgers y crisis_events conservados seudonimizados.';

-- ============================================================================
-- Solicitudes: crear, confirmar, cancelar, consumir.
-- Todo lo que decide si una solicitud es válida vive AQUÍ, en una sentencia con
-- `returning`: la comprobación y la transición de estado son la misma
-- operación, así que un token no se puede usar dos veces por mucho que lleguen
-- dos peticiones a la vez.
-- ============================================================================

create or replace function public.crear_solicitud_privacidad(
  p_user          uuid,
  p_kind          public.privacy_request_kind,
  p_token_sha256  text,
  p_ttl_segundos  integer,
  p_confirmada    boolean default false
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_id uuid;
begin
  if p_ttl_segundos <= 0 or p_ttl_segundos > 604800 then
    raise exception 'ttl fuera de rango';
  end if;

  insert into public.privacy_requests (user_id, kind, state, token_sha256, expires_at, confirmed_at)
  values (
    p_user, p_kind,
    case when p_confirmada then 'confirmed'::public.privacy_request_state
         else 'pending_confirm'::public.privacy_request_state end,
    p_token_sha256,
    now() + make_interval(secs => p_ttl_segundos),
    case when p_confirmada then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.crear_solicitud_privacidad(uuid, public.privacy_request_kind, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.crear_solicitud_privacidad(uuid, public.privacy_request_kind, text, integer, boolean)
  to service_role;

-- Confirma un borrado. Devuelve false —sin decir por qué— si el token no casa,
-- si caducó, si ya se usó o si la solicitud es de otra persona. Quien llama NO
-- debe distinguir esos casos: hacerlo confirmaría qué ids existen.
create or replace function public.confirmar_borrado(
  p_solicitud    uuid,
  p_user         uuid,
  p_token_sha256 text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_ok boolean;
begin
  update public.privacy_requests
     set state        = 'confirmed',
         confirmed_at = now(),
         -- 30 días de arrepentimiento: la ejecución no puede ocurrir antes.
         expires_at   = now() + interval '30 days'
   where id = p_solicitud
     and user_id = p_user
     and kind = 'erase'
     and state = 'pending_confirm'
     and expires_at > now()
     and token_sha256 = p_token_sha256
  returning true into v_ok;

  if v_ok is null then
    return false;
  end if;

  -- Suspensión inmediata: durante el arrepentimiento la cuenta deja de aparecer
  -- para los demás pero su dueña la sigue viendo (la política `posts_read` de
  -- 0005 mantiene visibles los posts propios a quien está en shadow-ban, justo
  -- para que quien está silenciado no lo note; aquí ese mismo mecanismo sirve
  -- para que quien se va pueda arrepentirse viendo lo que aún tiene).
  update public.profiles set shadow_banned = true where id = p_user;

  return true;
end;
$$;

revoke all on function public.confirmar_borrado(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirmar_borrado(uuid, uuid, text) to service_role;

-- Arrepentirse. Solo mientras no se haya ejecutado.
create or replace function public.cancelar_borrado(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_n integer;
begin
  update public.privacy_requests
     set state = 'cancelled', completed_at = now()
   where user_id = p_user
     and kind = 'erase'
     and state in ('pending_confirm', 'confirmed');
  get diagnostics v_n = row_count;

  if v_n > 0 then
    -- Solo se levanta la suspensión si la puso el propio borrado: si la persona
    -- estaba en shadow-ban por moderación, cancelar su borrado no puede
    -- devolverle la visibilidad.
    update public.profiles
       set shadow_banned = false
     where id = p_user
       and deleted_at is null
       and not exists (
         select 1 from public.moderation_flags m
          where m.subject_id = p_user and m.state in ('pending', 'reviewing')
       );
  end if;

  return v_n > 0;
end;
$$;

revoke all on function public.cancelar_borrado(uuid) from public, anon, authenticated;
grant execute on function public.cancelar_borrado(uuid) to service_role;

-- Consume el enlace de descarga de una exportación: UN SOLO USO y caducidad, en
-- la misma sentencia que lo comprueba. Devuelve false para «no existe», «no es
-- tuyo», «ya se usó» y «caducó» sin distinguirlos — la ruta traduce ese false a
-- un 404, nunca a un 403: un 403 confirmaría que ese id existe.
create or replace function public.consumir_exportacion(
  p_solicitud uuid,
  p_user      uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_ok boolean;
begin
  update public.privacy_requests
     set state = 'done', completed_at = now()
   where id = p_solicitud
     and user_id = p_user
     and kind = 'export'
     and state = 'confirmed'
     and expires_at > now()
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.consumir_exportacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consumir_exportacion(uuid, uuid) to service_role;

-- Cola del cron: borrados confirmados cuyos 30 días ya pasaron.
create or replace function public.borrados_vencidos(p_limite integer default 50)
returns table (user_id uuid, solicitud_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select r.user_id, r.id
    from public.privacy_requests r
   where r.state = 'confirmed'
     and r.kind = 'erase'
     and r.confirmed_at < now() - interval '30 days'
   order by r.requested_at
   limit greatest(1, least(p_limite, 500));
$$;

revoke all on function public.borrados_vencidos(integer) from public, anon, authenticated;
grant execute on function public.borrados_vencidos(integer) to service_role;

-- ============================================================================
-- registrar_consentimiento — lo escribe el SERVIDOR tras servir el texto.
-- El cliente nunca afirma que aceptó: afirma que pulsó, y el servidor registra
-- qué texto exacto tenía delante en ese momento.
-- ============================================================================
create or replace function public.registrar_consentimiento(
  p_user    uuid,
  p_kind    text,
  p_version text,
  p_sha256  text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  insert into public.consents (user_id, kind, version, text_sha256)
  values (p_user, p_kind, p_version, p_sha256)
  on conflict (user_id, kind, version) do update
     set revoked_at = null;
end;
$$;

revoke all on function public.registrar_consentimiento(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_consentimiento(uuid, text, text, text) to service_role;

-- ============================================================================
-- purgar_retencion — barrido por lotes, invocado por cron.
--
-- NUNCA un `delete` sin `limit` sobre `content_views` o `refuge_messages`:
-- bloquea la tabla y tumba la app. El patrón `where ctid in (select ctid …
-- limit N)` borra un lote acotado y deja que la siguiente pasada siga.
--
-- `crystal_ledger` NO se purga aquí y es deliberado: tiene un trigger de
-- inmutabilidad (0002) que rechaza cualquier DELETE, incluido el de
-- `service_role`. Su plazo de 6 años exige levantar ese trigger a mano, que es
-- justo la clase de operación que no debe ocurrir de rebote dentro de un cron.
-- ============================================================================
create or replace function public.purgar_retencion(p_lote integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_lote  integer := greatest(1, least(coalesce(p_lote, 1000), 10000));
  v_vistas integer;
  v_limites integer;
  v_mensajes integer;
  v_flags integer;
  v_crisis integer;
begin
  delete from public.content_views
   where ctid in (
     select c.ctid from public.content_views c
      where c.created_at < now() - interval '90 days'
      limit v_lote
   );
  get diagnostics v_vistas = row_count;

  delete from public.rate_limits
   where ctid in (
     select r.ctid from public.rate_limits r
      where r.window_start < now() - interval '1 day'
      limit v_lote
   );
  get diagnostics v_limites = row_count;

  delete from public.refuge_messages
   where ctid in (
     select m.ctid from public.refuge_messages m
      where m.created_at < now() - interval '2 years'
      limit v_lote
   );
  get diagnostics v_mensajes = row_count;

  delete from public.moderation_flags
   where ctid in (
     select f.ctid from public.moderation_flags f
      where f.created_at < now() - interval '2 years'
        and f.state in ('resolved', 'dismissed')
      limit v_lote
   );
  get diagnostics v_flags = row_count;

  delete from public.crisis_events
   where ctid in (
     select e.ctid from public.crisis_events e
      where e.created_at < now() - interval '5 years'
      limit v_lote
   );
  get diagnostics v_crisis = row_count;

  return jsonb_build_object(
    'content_views',    v_vistas,
    'rate_limits',      v_limites,
    'refuge_messages',  v_mensajes,
    'moderation_flags', v_flags,
    'crisis_events',    v_crisis
  );
end;
$$;

revoke all on function public.purgar_retencion(integer) from public, anon, authenticated;
grant execute on function public.purgar_retencion(integer) to service_role;

-- ============================================================================
-- RLS y privilegios.
-- ============================================================================
alter table public.consents         enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.retired_aliases  enable row level security;

-- `privacy_requests` y `retired_aliases`: RLS activada y CERO políticas → solo
-- `service_role`. Mismo patrón que `identity_vault`. Que un cliente pudiera
-- leer `privacy_requests` sería publicar quién está a punto de irse; que
-- pudiera leer `retired_aliases` sería publicar la lista de quién se fue.
revoke all on public.privacy_requests from anon, authenticated;
revoke all on public.retired_aliases  from anon, authenticated;

-- `consents`: cada quien lee LO SUYO. La política no consulta ninguna otra
-- tabla (regla de 0005): compara la columna contra auth.uid() y nada más.
create policy consents_read_own on public.consents
  for select to authenticated using (user_id = (select auth.uid()));

-- Y la mitad que se olvida: RLS decide filas, el privilegio decide columnas y
-- VERBOS. Sin este revoke, `authenticated` podría INSERTAR su propio
-- consentimiento —afirmar que aceptó un texto que nunca se le sirvió— porque
-- Supabase concede todos los verbos por defecto a las tablas nuevas de `public`.
revoke all on public.consents from anon, authenticated;
grant select (user_id, kind, version, text_sha256, accepted_at, revoked_at)
  on public.consents to authenticated;

-- No hay `grant insert (…)` en NINGUNA de las tres tablas a propósito: aquí el
-- cliente no escribe nada. Todo entra por las funciones `security definer` de
-- arriba, concedidas solo a `service_role`.
