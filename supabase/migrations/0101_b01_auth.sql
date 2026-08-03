-- ============================================================================
-- Darma · 0101 · B01 · Auth anónima y onboarding
--
-- SOLO AÑADE. No modifica ni una línea de 0001_core.sql ni de 0002_comunidad.sql
-- (ya aplicadas). Cuatro cosas, y cada una existe porque el esquema de 0001
-- cierra deliberadamente un camino que el onboarding necesita:
--
--  1. profiles.entry_level — por dónde quiere empezar la persona (Ánimo /
--     Escucha / Apoyo). Es un ENRUTADO INICIAL, NO UN PERMISO: quien eligió
--     'animo' y mañana quiere publicar debe poder hacerlo sin rehacer el
--     onboarding. El único gate de publicación es trg_posts_reciprocity.
--
--  2. auth_totp — segundo factor opcional para mentores. Mismo patrón que
--     identity_vault: RLS activada y CERO políticas → solo service_role. El
--     secreto va ADEMÁS cifrado (AES-256-GCM en lib/auth/totp.ts): son dos
--     barreras independientes, y la segunda sigue en pie si se filtra un dump.
--
--  3. crear_perfil() — OBLIGATORIA. `profiles` no tiene política de INSERT en
--     0001, así que el cliente RLS no puede crear la fila del onboarding ni
--     aunque sea la suya. La salida correcta es una función security definer,
--     no una política nueva sobre una migración ya aplicada.
--
--  4. mi_sesion() — por el mismo motivo del otro lado: 0001 REVOCA el select
--     sobre `profiles` y lo reconcede solo sobre las columnas públicas.
--     `shadow_banned`, `banned_until` y ahora `entry_level` quedan fuera (el
--     primero a propósito: si el troll puede consultarlo, sabe que está
--     silenciado y se crea otra cuenta). requireSesion() necesita esas tres, y
--     esta función es la única puerta, filtrada por auth.uid().
-- ============================================================================

-- ============================================================================
-- 1 · profiles.entry_level
-- ============================================================================

alter table public.profiles
  add column entry_level text not null default 'escucha'
    check (entry_level in ('animo', 'escucha', 'apoyo'));

comment on column public.profiles.entry_level is
  'Punto de entrada elegido en el onboarding. Preferencia de arranque, NUNCA un permiso: el gate de publicar es trg_posts_reciprocity.';

-- 0001 revocó el UPDATE entero sobre profiles y lo reconcede columna a columna.
-- Una columna añadida después NO hereda aquel grant, así que hay que darlo aquí
-- o PATCH /api/me fallaría con "permission denied for column entry_level".
grant update (entry_level) on public.profiles to authenticated;

-- El SELECT no se concede a propósito. entry_level se lee por mi_sesion(), que
-- filtra por auth.uid(): saber por dónde entró OTRA persona ("solo viene a ver
-- contenido") es un dato de comportamiento que nadie necesita, y el principio
-- de esta base es conceder lo justo, no lo cómodo.

-- ============================================================================
-- 2 · auth_totp — segundo factor
-- ============================================================================

create table public.auth_totp (
  user_id          uuid primary key references auth.users(id) on delete cascade,

  -- iv(12) ‖ tag(16) ‖ ciphertext, cifrado con TOTP_ENC_KEY (AES-256-GCM).
  -- Nunca el secreto en claro: quien lo lea puede generar códigos válidos para
  -- siempre, que es exactamente lo que el segundo factor debía impedir.
  secret_encrypted bytea not null,

  -- NULL mientras la persona no ha validado su primer código. Un secreto sin
  -- confirmar no bloquea el acceso: si bloqueara, un fallo al escanear el QR
  -- dejaría a alguien fuera de su propia cuenta.
  confirmed_at     timestamptz,

  -- Códigos de recuperación hasheados con scrypt (nunca en claro, nunca
  -- cifrados: para verificar no hace falta poder recuperar). Se consumen
  -- quitando el elemento del array, así que uno usado no vale dos veces.
  recovery_hashes  text[] not null default '{}',

  created_at       timestamptz not null default now()
);

comment on table public.auth_totp is
  'Segundo factor de mentores. SIN POLÍTICAS RLS a propósito (mismo patrón que identity_vault): solo service_role. No añadir aquí ninguna columna con el secreto en claro.';

alter table public.auth_totp enable row level security;
-- CERO políticas. Con RLS activa eso es DENEGADO para anon y para authenticated.

-- El revoke es la segunda mitad: RLS decide filas, los privilegios deciden si
-- la tabla existe siquiera para el rol. Sin él, un `select` devolvería cero
-- filas en vez de un error, y "cero filas" se confunde con "no tiene 2FA".
revoke all on public.auth_totp from anon, authenticated;

-- ============================================================================
-- 3 · crear_perfil() — la única vía de alta de un perfil
-- ============================================================================

create or replace function public.crear_perfil(
  p_alias        text,
  p_avatar_seed  text,
  p_entry_level  text
) returns public.profiles
language plpgsql
security definer
-- search_path fijado: sin él, alguien podría crear una tabla `profiles` en un
-- esquema propio y suplantar a la de aquí dentro de una función que corre con
-- los privilegios del dueño.
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_perfil public.profiles;
begin
  if v_uid is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  -- Se comprueba antes para poder dar un error distinto del de alias repetido:
  -- ambos serían unique_violation y la ruta no podría distinguir "elige otro
  -- alias" de "ya terminaste el onboarding".
  if exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'perfil ya creado' using errcode = '23505';
  end if;

  begin
    insert into public.profiles (id, alias, avatar_seed, entry_level)
    values (v_uid, p_alias, p_avatar_seed, p_entry_level)
    returning * into v_perfil;
  exception
    when unique_violation then
      -- Colisión del UNIQUE de alias. Se relanza con el mismo SQLSTATE para que
      -- lib/auth/errores.ts lo traduzca a 'entrada_invalida' y la persona vea
      -- "prueba con otro", en vez de un 500 con el nombre del índice dentro.
      raise exception 'alias no disponible' using errcode = '23505';
  end;

  return v_perfil;
end;
$$;

-- Revocar de PUBLIC quita también el EXECUTE heredado; se devuelve solo a quien
-- lo necesita. `anon` no: una persona sin sesión no tiene auth.uid() y la
-- función ya la rechazaría, pero no hace falta que ni siquiera pueda llamarla.
revoke all on function public.crear_perfil(text, text, text) from public, anon;
grant execute on function public.crear_perfil(text, text, text) to authenticated;

-- ============================================================================
-- 4 · mi_sesion() — lo que lee requireSesion(), en UNA consulta
-- ============================================================================

create or replace function public.mi_sesion()
returns table (
  id               uuid,
  alias            text,
  avatar_seed      text,
  bio              text,
  level            text,
  entry_level      text,
  availability     text,
  karma_reputation integer,
  shadow_banned    boolean,
  banned_until     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.alias, p.avatar_seed, p.bio, p.level, p.entry_level,
         p.availability, p.karma_reputation, p.shadow_banned, p.banned_until
    from public.profiles p
   -- El filtro por auth.uid() ES la seguridad: la función no acepta ningún
   -- parámetro, así que no hay forma de preguntar por la sesión de otro. Es el
   -- mismo criterio de diseño de firma que los helpers de RLS de 0002.
   where p.id = (select auth.uid());
$$;

revoke all on function public.mi_sesion() from public, anon;
grant execute on function public.mi_sesion() to authenticated;

-- ============================================================================
-- 5 · Disponibilidad de alias
-- ============================================================================

-- Índice funcional para `lower(alias) = lower(:candidato)`. El trigram
-- idx_profiles_alias_trgm de 0001 es para búsqueda difusa (B06): para una
-- igualdad exacta insensible a mayúsculas, un GIN de trigramas es mucho más
-- caro que un B-tree sobre la expresión.
create index idx_profiles_alias_lower on public.profiles (lower(alias));

comment on index public.idx_profiles_alias_lower is
  'Comprobación de alias libre: where lower(alias) = lower(:candidato). Index scan de una fila.';

create or replace function public.alias_disponible(p_alias text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.profiles p where lower(p.alias) = lower(p_alias)
  );
$$;

comment on function public.alias_disponible(text) is
  'Devuelve solo un booleano. No filtra nada que profiles_read (using true) no permita ya, pero se expone como función para poder usar el índice funcional y para poder limitarla por rate limit en la ruta: sin límite, esto es un enumerador del padrón de alias.';

revoke all on function public.alias_disponible(text) from public, anon;
grant execute on function public.alias_disponible(text) to authenticated;
