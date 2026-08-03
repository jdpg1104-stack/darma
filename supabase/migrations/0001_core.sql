-- ============================================================================
-- Darma · 0001 · Núcleo: identidad anónima, Karma y el bucle de reciprocidad
--
-- PRINCIPIOS QUE ESTE ESQUEMA HACE CUMPLIR A NIVEL DE BASE DE DATOS (no de app):
--
--  1. ANONIMATO. `profiles` no contiene email, teléfono ni nombre real. La
--     identidad real vive en `identity_vault`, sin política RLS ninguna: eso
--     significa DENEGADO PARA TODOS salvo service_role, que la salta. Ni un bug
--     en la API ni una consulta mal escrita pueden filtrarla.
--
--  2. EL KARMA NO SE ESCRIBE A MANO. `authenticated` no tiene privilegio UPDATE
--     sobre las columnas de karma. La única vía es award_karma(), SECURITY
--     DEFINER, que aplica el tope diario y escribe el ledger en la misma
--     transacción. Un cliente con la anon key en la mano no puede regalarse
--     reputación.
--
--  3. RECIPROCIDAD 3:1 EN LA TRANSACCIÓN. El gate no es una comprobación de la
--     API (que se puede saltar con una llamada directa a PostgREST): es un
--     trigger BEFORE INSERT sobre `posts` que descuenta el crédito con UPDATE
--     ... RETURNING. Si no hay crédito, la fila no se escribe. Dos peticiones
--     simultáneas no pueden gastar el mismo crédito: el UPDATE toma el lock.
--
--  4. ESCALA. Todos los contadores están desnormalizados y mantenidos por
--     trigger; el hot score está MATERIALIZADO en columna con índice. El feed a
--     100 000 usuarios es un index scan de N filas, no un cálculo sobre un pool.
--     Toda la paginación es por keyset (ver comentario en idx_posts_hot).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.post_kind   as enum ('desahogo', 'pregunta', 'gratitud');
create type public.risk_level  as enum ('none', 'low', 'high', 'critical');
create type public.entry_state as enum ('active', 'hidden', 'removed');

-- ============================================================================
-- profiles — la CARA PÚBLICA de una persona. Todo lo que otro usuario puede
-- llegar a ver de ti está en esta tabla, y aquí no hay nada que te identifique.
-- ============================================================================
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,

  -- Seudónimo + semilla determinista del avatar generado. Nunca una foto.
  alias              text not null unique
                     check (char_length(alias) between 3 and 24
                            and alias ~ '^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$'),
  avatar_seed        text not null default encode(gen_random_bytes(8), 'hex'),
  bio                text check (char_length(bio) <= 280),

  -- ── Karma. Dos magnitudes del MISMO evento (ver lib/karma.ts) ────────────
  -- Reputación: vitalicia, solo sube, define el nivel.
  karma_reputation   integer not null default 0 check (karma_reputation >= 0),
  -- Gastable: el 30 % de lo ganado; es lo que se consume en boosts y Frutos.
  karma_spendable    integer not null default 0 check (karma_spendable >= 0),

  -- Nivel derivado. Columna generada: imposible que se desincronice del karma,
  -- y filtrable/indexable sin recalcular en cada lectura.
  level              text not null generated always as (
                       case
                         when karma_reputation >= 5000 then 'mentor'
                         when karma_reputation >= 2000 then 'guia'
                         when karma_reputation >= 500  then 'brote'
                         else 'semilla'
                       end
                     ) stored,

  -- ── Reciprocidad ─────────────────────────────────────────────────────────
  -- Escuchas validadas acumuladas y aún no canjeadas. 3 → 1 publicación.
  listen_credits     integer not null default 0 check (listen_credits >= 0),
  listens_given      integer not null default 0,
  posts_published    integer not null default 0,

  -- ── Tope diario de karma (anti-farmeo) ───────────────────────────────────
  daily_karma_earned integer not null default 0,
  daily_karma_date   date    not null default current_date,

  -- ── Moneda premium ───────────────────────────────────────────────────────
  crystals           integer not null default 0 check (crystals >= 0),

  -- ── Estado y moderación ──────────────────────────────────────────────────
  -- shadow_banned: sigue viendo la app con normalidad, pero su contenido no
  -- entra en el feed de nadie. Frente a un troll es mucho más efectivo que un
  -- baneo duro, que solo provoca que se cree otra cuenta.
  shadow_banned      boolean not null default false,
  banned_until       timestamptz,
  availability       text not null default 'disponible'
                     check (availability in ('disponible', 'necesito_hablar', 'ausente')),

  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

comment on table public.profiles is
  'Cara pública seudónima. Prohibido añadir aquí email, teléfono o nombre real: eso va a identity_vault.';

create index idx_profiles_karma on public.profiles (karma_reputation desc) where not shadow_banned;
create index idx_profiles_alias_trgm on public.profiles using gin (alias gin_trgm_ops);

-- ============================================================================
-- identity_vault — el único punto donde existe el vínculo con la persona real.
-- SIN POLÍTICAS RLS = nadie lo lee salvo service_role. Aislado a propósito.
-- ============================================================================
create table public.identity_vault (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  -- Hash con sal del email/teléfono: permite detectar multicuenta sin guardar
  -- el dato en claro y sin poder revertirlo.
  contact_hash   text not null,
  country_code   text,
  kyc_level      smallint not null default 0,
  created_at     timestamptz not null default now()
);
create index idx_identity_vault_contact on public.identity_vault (contact_hash);

-- ============================================================================
-- karma_weights — la economía, PÚBLICA Y AUDITABLE (valor "Transparencia").
-- award_karma() lee de aquí; cambiar un peso no requiere migración de código.
-- ============================================================================
create table public.karma_weights (
  kind           text primary key,
  reputation     integer not null,
  -- % de lo ganado que además se acredita como gastable.
  spendable_pct  numeric(4,3) not null default 0.300,
  description    text not null,
  counts_to_cap  boolean not null default true
);

insert into public.karma_weights (kind, reputation, spendable_pct, description, counts_to_cap) values
  ('comment_validated',  10, 0.300, 'Comentario de apoyo validado por IA',            true),
  ('marked_helpful',     15, 0.300, 'El autor marcó tu comentario como "me ayudó"',   true),
  ('circle_hosted',      30, 0.300, 'Hostear un círculo grupal (Guía/Mentor)',        true),
  ('content_completed',   1, 0.300, 'Ver contenido de bienestar completo',            true),
  ('spam_penalty',      -40, 0.000, 'Comentario spam o de relleno',                  false),
  ('report_upheld',     -30, 0.000, 'Reporte confirmado en tu contra',               false),
  -- Los gastos también necesitan su propia clase. Sin ella, spend_karma() tenía
  -- que reutilizar 'comment_validated' para satisfacer la FK, y el ledger salía
  -- mintiendo: un boost de −50 aparecía en el historial de la persona como un
  -- "comentario validado". El primer sitio donde eso duele es la pantalla de
  -- transparencia del karma, que es justo la que sostiene la confianza.
  ('karma_spend',         0, 0.000, 'Gasto de karma gastable (boost, fruto, regalo)', false);

-- ============================================================================
-- karma_events — ledger APPEND-ONLY. Fuente de verdad; profiles es el caché.
-- La idempotency_key impide que un reintento de la API pague dos veces.
-- ============================================================================
create table public.karma_events (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  kind              text not null references public.karma_weights(kind),
  delta_reputation  integer not null,
  delta_spendable   integer not null,
  ref_type          text,
  ref_id            uuid,
  idempotency_key   text unique,
  created_at        timestamptz not null default now()
);
create index idx_karma_events_user on public.karma_events (user_id, created_at desc);

-- ============================================================================
-- posts — la voz. Anónima por construcción: solo se une con profiles.
-- ============================================================================
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  kind          public.post_kind not null default 'desahogo',
  body          text not null check (char_length(body) between 20 and 5000),
  topic         text,

  -- Contadores desnormalizados (mantenidos por trigger). Leer el feed NO hace
  -- count(*) sobre comments/votes: a 100 000 usuarios eso sería el cuello.
  upvote_count  integer not null default 0,
  reply_count   integer not null default 0,

  -- Hot score MATERIALIZADO (ver lib/feedRanking.ts para la fórmula y su
  -- justificación). Se recalcula por trigger cuando cambian los contadores.
  hot_score     double precision not null default 0,
  boost_until   timestamptz,

  risk          public.risk_level not null default 'none',
  state         public.entry_state not null default 'active',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Índice del feed "Para ti". La condición del índice replica exactamente la de
-- la consulta del feed, así que Postgres lo usa entero y nunca toca los posts
-- ocultos ni retirados.
create index idx_posts_hot on public.posts (hot_score desc, id desc) where state = 'active';
create index idx_posts_new on public.posts (created_at desc, id desc) where state = 'active';
create index idx_posts_author on public.posts (author_id, created_at desc);
-- Cola de crisis: parcial y diminuta, así que la revisión humana es instantánea
-- por muchos millones de posts que haya.
create index idx_posts_risk on public.posts (created_at desc) where risk in ('high', 'critical');

comment on index public.idx_posts_hot is
  'Paginación SIEMPRE por keyset: where (hot_score, id) < (:cursor_score, :cursor_id). Nunca OFFSET — con OFFSET 10000 Postgres lee y descarta 10 000 filas en cada página.';

-- ============================================================================
-- comments — la escucha. Solo un comentario VALIDADO cuenta para el 3:1.
-- ============================================================================
create table public.comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete cascade,
  body           text not null check (char_length(body) between 40 and 4000),

  -- Validación de calidad por IA. Hasta que no es true no hay karma ni crédito
  -- de reciprocidad: es lo que impide farmear con "ánimo!" repetido.
  is_validated   boolean not null default false,
  quality_score  numeric(4,3),
  -- El autor del post marcó este comentario como el que le ayudó.
  is_helpful     boolean not null default false,

  upvote_count   integer not null default 0,
  state          public.entry_state not null default 'active',
  created_at     timestamptz not null default now()
);
create index idx_comments_post on public.comments (post_id, created_at) where state = 'active';
create index idx_comments_author on public.comments (author_id, created_at desc);
-- Una persona escucha a otra UNA vez para efectos de reciprocidad: no puedes
-- ganar 3 créditos comentando 3 veces el mismo post.
create unique index uq_comments_one_listen_per_post
  on public.comments (post_id, author_id) where is_validated;

-- ============================================================================
-- post_votes — un voto por persona y post.
-- ============================================================================
create table public.post_votes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ============================================================================
-- FUNCIONES DE ECONOMÍA
-- ============================================================================

-- award_karma — ÚNICA vía por la que el karma se mueve.
-- Aplica el tope diario, escribe el ledger y actualiza el caché en una sola
-- transacción. SECURITY DEFINER + search_path fijado (sin el `set search_path`
-- un usuario podría crear una tabla que suplante a otra dentro de la función).
create or replace function public.award_karma(
  p_user     uuid,
  p_kind     text,
  p_ref_type text default null,
  p_ref_id   uuid default null,
  p_idem     text default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w              public.karma_weights%rowtype;
  v_today        date := current_date;
  v_earned_today integer;
  v_grant        integer;
  v_spendable    integer;
begin
  select * into w from public.karma_weights where kind = p_kind;
  if not found then
    raise exception 'karma kind desconocido: %', p_kind;
  end if;

  -- Reinicia la ventana diaria si cambió el día, y bloquea la fila para que dos
  -- peticiones paralelas no se salten el tope entre las dos.
  update public.profiles
     set daily_karma_earned = case when daily_karma_date = v_today then daily_karma_earned else 0 end,
         daily_karma_date   = v_today
   where id = p_user
  returning daily_karma_earned into v_earned_today;

  if not found then
    raise exception 'perfil inexistente: %', p_user;
  end if;

  v_grant := w.reputation;

  -- Tope diario: 120. Recorta el excedente en vez de rechazar la acción — quien
  -- ayuda de más no debe recibir un error, simplemente deja de acumular.
  if w.counts_to_cap and v_grant > 0 then
    v_grant := least(v_grant, greatest(0, 120 - v_earned_today));
  end if;

  if v_grant = 0 then
    return 0;
  end if;

  v_spendable := floor(greatest(v_grant, 0) * w.spendable_pct)::integer;

  -- ON CONFLICT DO NOTHING sobre la idempotency_key: si la API reintenta tras un
  -- timeout, el segundo intento no paga.
  insert into public.karma_events (user_id, kind, delta_reputation, delta_spendable, ref_type, ref_id, idempotency_key)
  values (p_user, p_kind, v_grant, v_spendable, p_ref_type, p_ref_id, p_idem)
  on conflict (idempotency_key) do nothing;

  if not found then
    return 0;
  end if;

  update public.profiles
     set karma_reputation   = greatest(0, karma_reputation + v_grant),
         karma_spendable    = greatest(0, karma_spendable + v_spendable),
         daily_karma_earned = daily_karma_earned + greatest(v_grant, 0)
   where id = p_user;

  return v_grant;
end;
$$;

-- Revocar de PUBLIC quita también el EXECUTE que service_role heredaba por
-- defecto, así que hay que devolvérselo explícitamente: el servidor necesita
-- poder llamarla por RPC. Los triggers no dependen de este grant (dentro de una
-- función SECURITY DEFINER el usuario efectivo es el dueño), pero las rutas de
-- API sí.
revoke all on function public.award_karma(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.award_karma(uuid, text, text, uuid, text) to service_role;

-- spend_karma — gasto del karma gastable (boosts, Frutos). Nunca deja negativo:
-- el WHERE del UPDATE es la comprobación y el descuento a la vez, así que dos
-- gastos simultáneos no pueden dejar el saldo bajo cero.
create or replace function public.spend_karma(
  p_user   uuid,
  p_amount integer,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean;
begin
  if p_amount <= 0 then
    raise exception 'importe inválido';
  end if;

  update public.profiles
     set karma_spendable = karma_spendable - p_amount
   where id = p_user and karma_spendable >= p_amount
  returning true into v_ok;

  if v_ok is null then
    return false;
  end if;

  -- El gasto NO toca la reputación: es vitalicia y solo sube. Lo que se consume
  -- es el 30 % gastable, y así queda reflejado en el ledger.
  insert into public.karma_events (user_id, kind, delta_reputation, delta_spendable, ref_type)
  values (p_user, 'karma_spend', 0, -p_amount, p_reason);

  return true;
end;
$$;

revoke all on function public.spend_karma(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.spend_karma(uuid, integer, text) to service_role;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Recalcula el hot score. Espejo EXACTO de computeHotScore() en
-- lib/feedRanking.ts — si cambias uno, cambia el otro (hay un test que lo vigila).
create or replace function public.compute_hot_score(
  p_upvotes integer, p_replies integer, p_created timestamptz
) returns double precision
language sql immutable
as $$
  select sign(1.0 * p_upvotes + 13.5 * p_replies)
         * log(10, greatest(abs(1.0 * p_upvotes + 13.5 * p_replies), 1))
       + (extract(epoch from p_created) - 1767225600) / 45000.0;
$$;

create or replace function public.posts_refresh_hot() returns trigger
language plpgsql as $$
begin
  new.hot_score := public.compute_hot_score(new.upvote_count, new.reply_count, new.created_at);
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_posts_hot
  before insert or update of upvote_count, reply_count on public.posts
  for each row execute function public.posts_refresh_hot();

-- ── El gate de reciprocidad ────────────────────────────────────────────────
-- Escuchar a 3 personas desbloquea 1 publicación. Vive AQUÍ y no en la API
-- porque la anon key permite hablar con PostgREST directamente: cualquier gate
-- que viva solo en el servidor de Next se salta con un curl.
create or replace function public.posts_consume_credit() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean;
begin
  -- El primer post es gratis: si exigiéramos escuchar antes de haber visto
  -- nunca la app, nadie llegaría a publicar. A partir del segundo, 3:1.
  update public.profiles
     set listen_credits  = case when posts_published = 0 then listen_credits else listen_credits - 3 end,
         posts_published = posts_published + 1
   where id = new.author_id
     and (posts_published = 0 or listen_credits >= 3)
     and not coalesce(banned_until > now(), false)
  returning true into v_ok;

  if v_ok is null then
    raise exception 'reciprocidad: necesitas escuchar a 3 personas para publicar'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_posts_reciprocity
  before insert on public.posts
  for each row execute function public.posts_consume_credit();

-- ── Una escucha validada: crédito + karma, en la misma transacción ─────────
create or replace function public.comments_on_validated() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_validated and not coalesce(old.is_validated, false) then
    update public.profiles
       set listen_credits = listen_credits + 1,
           listens_given  = listens_given + 1
     where id = new.author_id;

    perform public.award_karma(
      new.author_id, 'comment_validated', 'comment', new.id,
      'comment_validated:' || new.id::text
    );

    update public.posts
       set reply_count = reply_count + 1
     where id = new.post_id;
  end if;

  -- "Me ayudó": +15 a quien escuchó, +2 a quien cierra el ciclo reconociéndolo.
  if new.is_helpful and not coalesce(old.is_helpful, false) then
    perform public.award_karma(
      new.author_id, 'marked_helpful', 'comment', new.id,
      'marked_helpful:' || new.id::text
    );
  end if;

  return new;
end;
$$;

create trigger trg_comments_validated
  after update of is_validated, is_helpful on public.comments
  for each row execute function public.comments_on_validated();

-- ── Votos → contador ───────────────────────────────────────────────────────
create or replace function public.post_votes_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set upvote_count = upvote_count + 1 where id = new.post_id;
  else
    update public.posts set upvote_count = greatest(0, upvote_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger trg_post_votes_sync
  after insert or delete on public.post_votes
  for each row execute function public.post_votes_sync();

-- ============================================================================
-- RLS — denegado por defecto en TODAS las tablas.
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.identity_vault enable row level security;
alter table public.karma_events   enable row level security;
alter table public.karma_weights  enable row level security;
alter table public.posts          enable row level security;
alter table public.comments       enable row level security;
alter table public.post_votes     enable row level security;

-- identity_vault: NINGUNA política. Deliberado — ver cabecera del archivo.

-- profiles: cualquiera autenticado ve los perfiles (son anónimos, no hay nada
-- sensible que proteger); cada quien edita SOLO su fila y SOLO las columnas
-- cosméticas (el privilegio de columna de más abajo es lo que blinda el karma).
create policy profiles_read on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- karma_weights: lectura pública. La economía es auditable por diseño.
create policy karma_weights_read on public.karma_weights
  for select to anon, authenticated using (true);

-- karma_events: cada persona ve su propio ledger, el de nadie más.
create policy karma_events_read_own on public.karma_events
  for select to authenticated using (user_id = (select auth.uid()));

-- posts: se ven los activos de quien no está en shadow-ban (y los propios
-- siempre, para que quien está silenciado no note nada raro).
create policy posts_read on public.posts
  for select to authenticated using (
    state = 'active'
    and (
      author_id = (select auth.uid())
      or not exists (select 1 from public.profiles p where p.id = posts.author_id and p.shadow_banned)
    )
  );
create policy posts_insert_own on public.posts
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy posts_update_own on public.posts
  for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy comments_read on public.comments
  for select to authenticated using (state = 'active');
create policy comments_insert_own on public.comments
  for insert to authenticated with check (author_id = (select auth.uid()));

create policy votes_read on public.post_votes
  for select to authenticated using (true);
create policy votes_write_own on public.post_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy votes_delete_own on public.post_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── Privilegios de COLUMNA ─────────────────────────────────────────────────
-- RLS decide QUÉ FILAS; solo el privilegio de columna decide QUÉ COLUMNAS. Sin
-- esto, la política profiles_update_own dejaría que cualquiera se pusiera
-- karma_reputation = 999999 con un PATCH a PostgREST.
revoke update on public.profiles from anon, authenticated;
grant  update (alias, avatar_seed, bio, availability) on public.profiles to authenticated;

-- Lo mismo en LECTURA, y es la mitad que se olvida. `profiles_read ... using
-- (true)` deja ver todas las FILAS, que es lo que queremos (los perfiles son
-- anónimos), pero RLS no sabe nada de columnas: sin este recorte, un
-- `GET /rest/v1/profiles?select=karma_spendable,crystals` devolvía el saldo de
-- cualquiera. Eso rompe CONTRATOS §2, que declara esos campos privados.
--
-- Público = exactamente lo que el contrato llama PerfilPublico. Fuera quedan el
-- saldo gastable, los cristales, los créditos de escucha, el contador diario y
-- el estado de moderación. `shadow_banned` es privado por una razón concreta:
-- si el troll puede consultarlo, sabe que está silenciado y se crea otra cuenta
-- — y entonces el shadow-ban no sirve para nada.
revoke select on public.profiles from anon, authenticated;
grant  select (id, alias, avatar_seed, bio, karma_reputation, level,
               availability, created_at, last_seen_at)
       on public.profiles to authenticated;

-- Y la vía por la que cada quien sí ve LO SUYO. Es una función y no una
-- política porque `authenticated` ya no tiene el privilegio de columna: no hay
-- consulta directa que pueda devolver estos campos, ni siquiera sobre tu propia
-- fila. Aquí el filtro por auth.uid() es la única puerta.
create or replace function public.mi_perfil_privado()
returns table (
  karma_spendable    integer,
  crystals           integer,
  listen_credits     integer,
  listens_given      integer,
  posts_published    integer,
  daily_karma_earned integer,
  banned_until       timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.karma_spendable, p.crystals, p.listen_credits, p.listens_given,
         p.posts_published,
         case when p.daily_karma_date = current_date then p.daily_karma_earned else 0 end,
         p.banned_until
    from public.profiles p
   where p.id = (select auth.uid());
$$;

grant execute on function public.mi_perfil_privado() to authenticated;

revoke insert, update, delete on public.karma_events  from anon, authenticated;
revoke insert, update, delete on public.karma_weights from anon, authenticated;
revoke all on public.identity_vault from anon, authenticated;

-- El cuerpo de un post es editable por su autor; los contadores y el score, no.
revoke update on public.posts from anon, authenticated;
grant  update (body, topic, state) on public.posts to authenticated;

revoke update on public.comments from anon, authenticated;
grant  update (body, state) on public.comments to authenticated;
