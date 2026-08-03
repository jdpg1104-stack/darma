-- ============================================================================
-- Darma · 0002 · Comunidad: refugios, almas afines, contenido, moderación,
--                 economía premium y límites de uso.
--
-- 0001 definió QUIÉN eres (anónimamente) y CÓMO se gana el derecho a hablar.
-- 0002 define DÓNDE se habla y qué pasa cuando la conversación se pone seria.
--
-- PRINCIPIOS QUE ESTE ESQUEMA HACE CUMPLIR A NIVEL DE BASE DE DATOS:
--
--  1. UN REFUGIO ES INVISIBLE DESDE FUERA. No hay política de lectura para no
--     miembros: quien no pertenece no obtiene "permiso denegado", obtiene cero
--     filas. No puede ni confirmar que la sala exista, que es justo lo que un
--     acosador necesitaría para saber que su víctima sigue en la app.
--
--  2. EL SERVIDOR NO PUEDE LEER LOS MENSAJES. refuge_messages guarda
--     ciphertext + nonce cifrados EN EL CLIENTE. La clave se deriva del refugio
--     y nunca viaja a Postgres. Una filtración del dump de la base no expone lo
--     que la gente se contó en su peor noche.
--
--  3. EL BLOQUEO ES DE BASE DE DATOS, NO DE INTERFAZ. Ocultar a alguien en la
--     UI no sirve de nada si la anon key permite hablar con PostgREST
--     directamente. Aquí el bloqueo entra en el USING de las políticas: la fila
--     deja de existir para ambas partes.
--
--  4. MODERACIÓN Y CRISIS SON OPACAS AL PÚBLICO. moderation_flags y
--     crisis_events tienen RLS activada y CERO políticas — mismo patrón que
--     identity_vault en 0001. Nadie puede averiguar si fue reportado, ni quién
--     le reportó, ni qué usuarios están en la cola de riesgo.
--
--  5. ESCALA. Ni un count(*) en camino de lectura: todos los contadores se
--     mantienen por trigger. Toda la paginación es por keyset y el predicado
--     exacto está documentado en el `comment on index` correspondiente. Los
--     índices parciales replican el WHERE real de cada consulta para que
--     Postgres los use enteros.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Los estados van en enum y no en text+check porque son cerrados y se comparan
-- en el USING de políticas RLS: un enum ocupa 4 bytes y compara por OID.
create type public.refuge_kind      as enum ('duo', 'circulo');
create type public.content_state    as enum ('pending', 'approved', 'rejected');
create type public.flag_state       as enum ('pending', 'reviewing', 'resolved', 'dismissed');
create type public.boost_currency   as enum ('karma', 'crystals');

-- ============================================================================
-- SECCIÓN 1 · REFUGIOS
-- Chat privado 1:1 ('duo') o círculo pequeño. La identidad sigue siendo la de
-- 0001: alias + avatar_seed del perfil. No se guarda nada más de la persona.
-- ============================================================================

create table public.refuges (
  id             uuid primary key default gen_random_uuid(),
  kind           public.refuge_kind not null default 'duo',

  -- Título OPCIONAL y sin cifrar: es lo único que la app necesita mostrar en la
  -- lista de refugios antes de derivar la clave. Por eso se limita a algo
  -- inocuo; el contenido real va cifrado en refuge_messages.
  title          text check (title is null or char_length(title) between 1 and 60),
  topic          text,

  created_by     uuid not null references public.profiles(id) on delete cascade,

  -- Un círculo pequeño ES el producto: a partir de ~8 personas deja de ser un
  -- refugio y pasa a ser un foro, donde nadie se atreve a hablar de verdad.
  max_members    smallint not null default 2 check (max_members between 2 and 8),
  member_count   smallint not null default 0,

  -- Contadores desnormalizados: la lista de refugios se ordena por actividad
  -- reciente sin tocar jamás la tabla de mensajes.
  message_count  integer not null default 0,
  last_message_at timestamptz,

  -- Un refugio se archiva, no se borra: borrar la sala borraría el historial de
  -- la otra persona sin su consentimiento.
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.refuges is
  'Sala privada. Invisible para no miembros por ausencia de política de lectura, no por filtro de la app.';

-- Lista "mis refugios", ordenada por actividad. El índice parcial excluye los
-- archivados porque la consulta real nunca los pide en la vista principal.
create index idx_refuges_activity on public.refuges (last_message_at desc nulls last, id desc)
  where archived_at is null;
create index idx_refuges_creator on public.refuges (created_by, created_at desc);

comment on index public.idx_refuges_activity is
  'Keyset: where archived_at is null and (last_message_at, id) < (:cursor_ts, :cursor_id) order by last_message_at desc, id desc. Nunca OFFSET.';

-- ----------------------------------------------------------------------------
-- refuge_members — pertenencia. `left_at` en vez de DELETE para que salir de un
-- refugio no reescriba el hilo de quien se queda.
-- ----------------------------------------------------------------------------
create table public.refuge_members (
  refuge_id   uuid not null references public.refuges(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,

  -- El anfitrión es el único que puede invitar; en un 'duo' es irrelevante.
  is_host     boolean not null default false,
  -- Silenciar notificaciones sin salir de la sala.
  muted       boolean not null default false,

  -- Marca de lectura: permite el badge de "no leídos" sin contar mensajes.
  last_read_message_id bigint,

  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (refuge_id, user_id)
);

-- La PK ya indexa (refuge_id, user_id). Este índice cubre el otro sentido —
-- "dame los refugios de esta persona" — que es el que ejecuta la app en cada
-- carga de la bandeja. Una FK sin índice del lado por el que se filtra es un
-- seq scan garantizado a escala.
create index idx_refuge_members_user on public.refuge_members (user_id) where left_at is null;

-- ----------------------------------------------------------------------------
-- refuge_messages — el contenido. CIFRADO EXTREMO A EXTREMO POR EL CLIENTE.
--
-- El servidor NO TIENE LA CLAVE y no puede tenerla: se deriva en el dispositivo
-- a partir del secreto compartido del refugio y jamás se envía a Postgres. Para
-- esta base de datos `ciphertext` es un blob opaco. Consecuencias asumidas a
-- propósito:
--   · No se puede moderar el contenido de un refugio por texto. La moderación
--     de refugios es por reporte del receptor (moderation_flags), que sí ve el
--     texto en claro en su propio dispositivo.
--   · No se puede buscar dentro de los mensajes en el servidor. La búsqueda es
--     local o no existe.
--   · Si el usuario pierde su clave, el historial es irrecuperable. Es el
--     precio del punto 2 de la cabecera y es un precio que Darma paga.
-- ----------------------------------------------------------------------------
create table public.refuge_messages (
  -- bigint identity y no uuid: el id es TAMBIÉN el cursor de paginación y el
  -- orden cronológico. Con uuid v4 el keyset no tendría sentido temporal y
  -- habría que ordenar por created_at (no único → cursor ambiguo).
  id           bigint generated always as identity primary key,
  refuge_id    uuid not null references public.refuges(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,

  -- ── Carga cifrada ────────────────────────────────────────────────────────
  -- AEAD (AES-256-GCM, nonce de 12 bytes): el ciphertext lleva dentro el tag de
  -- autenticación. El nonce es público por definición del algoritmo; lo que
  -- nunca sale del dispositivo es la clave.
  --
  -- El algoritmo lo fija WebCrypto, no la preferencia: XChaCha20-Poly1305 sería
  -- mejor por su nonce de 24 bytes (aleatorio sin miedo a colisión), pero el
  -- navegador no lo implementa y meter una librería de criptografía en el
  -- bundle para el camino más sensible de la app es peor negocio que usar el
  -- AES-GCM que ya viene auditado en la plataforma. Ver HANDOFF/B10.md.
  ciphertext   bytea not null check (octet_length(ciphertext) between 1 and 65536),
  nonce        bytea not null check (octet_length(nonce) between 12 and 24),
  -- Versión del esquema de cifrado: permite rotar de algoritmo sin migrar el
  -- histórico ni romper clientes viejos.
  enc_version  smallint not null default 1,

  -- Metadatos NO sensibles, necesarios para pintar la burbuja antes de
  -- descifrar (altura del elemento, icono de adjunto).
  kind         text not null default 'text' check (kind in ('text', 'audio', 'system')),
  byte_size    integer not null default 0,

  state        public.entry_state not null default 'active',
  created_at   timestamptz not null default now()
);

comment on column public.refuge_messages.ciphertext is
  'Blob opaco. El servidor NO posee la clave de descifrado y no puede leer esto. No añadir aquí ninguna columna con el texto en claro.';

-- Índice de paginación del hilo. Es el índice más caliente de toda la app.
create index idx_refuge_messages_keyset on public.refuge_messages (refuge_id, id desc)
  where state = 'active';

comment on index public.idx_refuge_messages_keyset is
  'Keyset del hilo: where refuge_id = :r and state = ''active'' and id < :cursor_id order by id desc limit 50. Prohibido OFFSET: con 200 000 mensajes en una sala, OFFSET 190000 los lee y descarta todos.';

create index idx_refuge_messages_sender on public.refuge_messages (sender_id, id desc);

-- ============================================================================
-- SECCIÓN 2 · ALMAS AFINES Y BLOQUEOS
-- ============================================================================

-- kindred — la libreta de contactos. Dirigida (no simétrica) a propósito: que
-- alguien te guarde no le da derecho a nada, solo a ver tu disponibilidad.
create table public.kindred (
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  kindred_id  uuid not null references public.profiles(id) on delete cascade,
  -- Nota privada del dueño sobre esa persona ("me escuchó en enero").
  note        text check (note is null or char_length(note) <= 140),
  created_at  timestamptz not null default now(),

  primary key (owner_id, kindred_id),
  -- Guardarse a uno mismo no significa nada y ensuciaría los joins.
  constraint kindred_no_self check (owner_id <> kindred_id)
);

comment on table public.kindred is
  'Lista de almas afines. La PK (owner_id, kindred_id) ES la restricción de unicidad: no hace falta un unique aparte.';

-- La lista se lee siempre haciendo join con profiles para sacar alias, avatar y
-- profiles.availability ('disponible' / 'necesito_hablar' / 'ausente', definido
-- en 0001). Ese join es por PK de profiles, así que la lista completa de un
-- usuario es un index scan de N filas + N lookups por PK. Sin count(*).
create index idx_kindred_owner on public.kindred (owner_id, created_at desc);
-- El sentido inverso ("¿quién me tiene guardado?") lo usa el aviso de
-- disponibilidad: cuando pones 'necesito_hablar' hay que notificar a quienes te
-- guardaron. Sin este índice sería un seq scan de la tabla entera.
create index idx_kindred_reverse on public.kindred (kindred_id);

-- Señal de disponibilidad: índice parcial minúsculo, porque la consulta real es
-- "de mis almas afines, ¿quién necesita hablar AHORA?" y solo esas filas
-- importan. Replica exactamente el WHERE de esa consulta.
create index idx_profiles_needs_talk on public.profiles (id)
  where availability = 'necesito_hablar';

-- ----------------------------------------------------------------------------
-- blocks — bloqueo/silencio. Es la herramienta de seguridad personal más
-- importante de la app, así que actúa en el motor de la base de datos.
-- ----------------------------------------------------------------------------
create table public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  -- 'block' corta la relación en ambos sentidos; 'mute' solo oculta el
  -- contenido a quien silencia (la otra parte no nota nada, que es justo lo que
  -- hace seguro silenciar a alguien agresivo).
  mode        text not null default 'block' check (mode in ('block', 'mute')),
  reason      text,
  created_at  timestamptz not null default now(),

  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

-- Los dos sentidos se consultan: el bloqueo es efectivo también para quien fue
-- bloqueado (no puede escribirte), así que se busca por ambas columnas.
create index idx_blocks_blocked on public.blocks (blocked_id);

-- ── Helpers de RLS ──────────────────────────────────────────────────────────
-- Van en funciones SECURITY DEFINER por dos razones:
--   1. RECURSIÓN. Una política sobre refuge_members que consulte refuge_members
--      dispara la propia política y Postgres aborta con "infinite recursion
--      detected in policy". La función salta la RLS y corta el ciclo.
--   2. PLAN. Marcadas `stable`, el planificador puede cachear su resultado
--      dentro del statement en lugar de reejecutarlas sin control.
--
-- OJO CON EL DISEÑO DE LA FIRMA: estas funciones NO reciben "de quién" se
-- pregunta, lo sacan de auth.uid() por dentro. Es deliberado. Una expresión de
-- política RLS se evalúa con los privilegios de QUIEN CONSULTA, así que hay que
-- concederle EXECUTE al rol `authenticated` — y si la firma admitiera un uuid
-- ajeno, cualquiera podría llamarlas a mano vía PostgREST y sondear si Fulano
-- pertenece a tal sala o si Mengano bloqueó a Zutano. Sin ese parámetro, la
-- única respuesta que se puede obtener es sobre uno mismo.
create or replace function public.is_refuge_member(p_refuge uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.refuge_members m
     where m.refuge_id = p_refuge
       and m.user_id = (select auth.uid())
       and m.left_at is null
  );
$$;

-- ¿Hay un bloqueo vivo entre quien consulta y p_other, en cualquier dirección?
create or replace function public.is_blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_other)
        or (b.blocker_id = p_other and b.blocked_id = (select auth.uid()))
  );
$$;

-- ¿Hay alguien en este refugio con quien p_user tenga un bloqueo? Si lo hay, el
-- refugio entero desaparece para p_user: en una sala de 2 a 8 personas no tiene
-- sentido ocultar mensajes sueltos, la conversación quedaría incomprensible.
--
-- Esta sí lleva p_user, porque el anfitrión que invita a un tercero necesita
-- comprobar los bloqueos DE ESE TERCERO. La fuga que permite es despreciable:
-- exige conocer un uuid de refugio, que solo se obtiene siendo miembro.
create or replace function public.refuge_has_block(p_refuge uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.refuge_members m
      join public.blocks b
        on (b.blocker_id = p_user and b.blocked_id = m.user_id)
        or (b.blocker_id = m.user_id and b.blocked_id = p_user)
     where m.refuge_id = p_refuge
       and m.user_id <> p_user
       and m.left_at is null
  );
$$;

-- ============================================================================
-- SECCIÓN 3 · CONTENIDO CURADO
-- Vídeos cortos de bienestar y artículos de salud mental. Todo entra por
-- ingesta del servidor (service_role): NADIE sube contenido desde el cliente.
-- Es lo que impide que el feed de bienestar se convierta en un vector de
-- contenido pro-autolesión.
-- ============================================================================

create table public.content_items (
  id                uuid primary key default gen_random_uuid(),

  -- source: el medio ('who', 'nimh', 'canal_x'). platform: de dónde se
  -- reproduce ('youtube', 'vimeo', 'article', 'internal').
  source            text not null,
  platform          text not null,
  external_id       text not null,

  title             text not null check (char_length(title) between 3 and 200),
  summary           text check (summary is null or char_length(summary) <= 1000),
  url               text not null,
  thumbnail_url     text,

  -- BCP-47 recortado a idioma base ('es', 'en'): el feed filtra por idioma del
  -- usuario y una variante regional partiría el pool sin ganancia real.
  language          text not null default 'es' check (language ~ '^[a-z]{2}$'),
  duration_seconds  integer check (duration_seconds is null or duration_seconds >= 0),
  topic             text,
  tags              text[] not null default '{}',

  state             public.content_state not null default 'pending',
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,

  -- Contadores desnormalizados, mantenidos por trigger desde content_views. El
  -- feed no hace jamás count(*) sobre content_views (que crece con usuarios ×
  -- items, es decir, la tabla más grande de la app).
  view_count        integer not null default 0,
  completion_count  integer not null default 0,

  -- Rendimiento materializado (tasa de finalización ponderada por volumen). Se
  -- recalcula por trigger, igual que el hot_score de posts en 0001: ordenar el
  -- feed nunca implica un cálculo sobre el pool.
  performance_score double precision not null default 0,

  published_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- Idempotencia de la ingesta: el crawler se reintenta y no debe duplicar. Que
-- sea una restricción y no una comprobación previa es lo que hace que dos
-- crawlers en paralelo no puedan insertar el mismo vídeo dos veces.
create unique index uq_content_items_platform_external
  on public.content_items (platform, external_id);

-- Feed vertical: solo aprobado, en el idioma de la persona, mejor primero.
-- El índice parcial replica el WHERE literal de la consulta del feed.
create index idx_content_feed on public.content_items (language, performance_score desc, id desc)
  where state = 'approved';
-- "Novedades" del mismo feed.
create index idx_content_fresh on public.content_items (language, published_at desc, id desc)
  where state = 'approved';
-- Cola de curación humana: parcial y diminuta frente al catálogo completo.
create index idx_content_pending on public.content_items (created_at) where state = 'pending';

comment on index public.idx_content_feed is
  'Keyset del feed vertical: where state = ''approved'' and language = :lang and (performance_score, id) < (:cursor_score, :cursor_id) order by performance_score desc, id desc limit 20. Nunca OFFSET — el scroll infinito con OFFSET degrada linealmente con la profundidad del scroll.';

-- ----------------------------------------------------------------------------
-- content_views — quién completó qué. Alimenta el karma 'content_completed'
-- (+1, definido en karma_weights de 0001).
-- ----------------------------------------------------------------------------
create table public.content_views (
  content_id       uuid not null references public.content_items(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,

  -- Completado una sola vez por persona y contenido: la PK impide que se farmee
  -- karma reproduciendo el mismo vídeo en bucle. La restricción vive aquí y no
  -- en la app porque la app se puede saltar con una llamada directa.
  completed        boolean not null default false,
  watched_seconds  integer not null default 0 check (watched_seconds >= 0),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,

  primary key (content_id, user_id)
);

-- "Qué he visto ya", para no repetir contenido en el feed. Es el sentido de la
-- FK por el que realmente se filtra.
create index idx_content_views_user on public.content_views (user_id, created_at desc);

-- ============================================================================
-- SECCIÓN 4 · ENCUESTAS DEL FEED
-- ============================================================================

create table public.polls (
  id           uuid primary key default gen_random_uuid(),
  -- Una encuesta puede colgar de un post o vivir suelta en el feed.
  post_id      uuid references public.posts(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  question     text not null check (char_length(question) between 5 and 200),
  -- Anónima incluso para el autor: en Darma preguntar "¿alguien más se siente
  -- así?" solo funciona si responder no expone a nadie.
  is_anonymous boolean not null default true,
  closes_at    timestamptz,
  total_votes  integer not null default 0,
  state        public.entry_state not null default 'active',
  created_at   timestamptz not null default now()
);

create index idx_polls_post on public.polls (post_id) where post_id is not null;
create index idx_polls_feed on public.polls (created_at desc, id desc) where state = 'active';

comment on index public.idx_polls_feed is
  'Keyset: where state = ''active'' and (created_at, id) < (:cursor_ts, :cursor_id) order by created_at desc, id desc.';

create table public.poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls(id) on delete cascade,
  -- Posición estable: reordenar en cliente cambiaría el sentido de los votos.
  -- Se llama `ordinal` y no `position` porque POSITION es palabra reservada del
  -- SQL estándar (POSITION(x IN y)) y obligaría a entrecomillarla siempre.
  ordinal     smallint not null check (ordinal between 0 and 9),
  label       text not null check (char_length(label) between 1 and 80),
  -- Contador desnormalizado: pintar los porcentajes de una encuesta NUNCA hace
  -- count(*) sobre poll_votes.
  vote_count  integer not null default 0,

  unique (poll_id, ordinal)
);

-- El unique (poll_id, ordinal) ya cubre el único acceso real —"dame las
-- opciones de esta encuesta, en orden"— y es además la FK indexada del lado por
-- el que se filtra. Un índice extra sobre poll_id sería redundante.

create table public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- UN VOTO POR PERSONA Y ENCUESTA. La PK es (poll_id, user_id), no
  -- (option_id, user_id): así votar dos opciones distintas de la misma encuesta
  -- es imposible a nivel de motor. Comprobarlo en la app sería una condición de
  -- carrera con dos peticiones simultáneas.
  primary key (poll_id, user_id)
);

create index idx_poll_votes_option on public.poll_votes (option_id);

-- ============================================================================
-- SECCIÓN 5 · MODERACIÓN Y PROTOCOLO DE CRISIS
-- Ambas tablas: RLS activada y CERO políticas → solo service_role. Mismo patrón
-- deliberado que identity_vault en 0001.
-- ============================================================================

create table public.moderation_flags (
  id          bigint generated always as identity primary key,

  -- Referencia polimórfica (post | comment | refuge_message | profile |
  -- content_item). Sin FK a propósito: una FK por tipo obligaría a cinco
  -- columnas nullables, y el registro de moderación debe sobrevivir al borrado
  -- de la fila que lo originó — si el contenido desaparece, la señal sobre el
  -- autor sigue valiendo.
  ref_type    text not null check (ref_type in ('post', 'comment', 'refuge_message', 'profile', 'content_item')),
  ref_id      uuid,
  ref_bigint  bigint,          -- para refuge_messages, cuyo id es bigint

  -- Sobre quién recae la señal (para reincidencia), y quién reporta.
  subject_id  uuid references public.profiles(id) on delete set null,
  reporter_id uuid references public.profiles(id) on delete set null,

  signal      text not null,   -- 'ai_toxicity', 'user_report', 'spam_heuristic'...
  severity    smallint not null default 1 check (severity between 1 and 5),
  detail      text,

  state       public.flag_state not null default 'pending',
  reviewer_id uuid references public.profiles(id) on delete set null,

  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  resolved_at timestamptz
);

-- LA COLA. Índice PARCIAL sobre lo pendiente: por muchos millones de señales
-- históricas que acumule la tabla, el índice solo contiene las que quedan por
-- revisar, así que abrir el panel de moderación es instantáneo a cualquier
-- escala. Ordenado por severidad primero: lo grave se atiende antes.
create index idx_moderation_queue on public.moderation_flags (severity desc, created_at)
  where state = 'pending';

comment on index public.idx_moderation_queue is
  'Cola de revisión. Keyset: where state = ''pending'' and (severity, created_at) < (:cursor_sev, :cursor_ts) order by severity desc, created_at. El índice parcial mantiene su tamaño proporcional al backlog, no al histórico.';

-- Reincidencia: "¿cuántas señales confirmadas acumula esta persona?".
create index idx_moderation_subject on public.moderation_flags (subject_id, created_at desc)
  where subject_id is not null;

-- ----------------------------------------------------------------------------
-- crisis_events — el protocolo de crisis. Cada vez que el clasificador marca
-- riesgo 'high' o 'critical' se escribe aquí, ANTES de mostrar nada.
--
-- Esta tabla existe para responder a una pregunta que algún día habrá que
-- responder ante un regulador o ante una familia: "¿qué hizo el sistema cuando
-- esta persona dijo eso?". Por eso guarda qué recursos se mostraron y si hubo
-- revisión humana, no solo que se detectó.
-- ----------------------------------------------------------------------------
create table public.crisis_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,

  ref_type       text check (ref_type in ('post', 'comment', 'refuge_message')),
  ref_id         uuid,
  ref_bigint     bigint,

  risk           public.risk_level not null,
  -- Qué se le mostró exactamente: líneas de ayuda, contactos, ejercicio de
  -- anclaje. Array y no texto libre para poder auditarlo por agregación.
  resources_shown text[] not null default '{}',
  -- País en el momento del evento: las líneas de ayuda son nacionales y hay que
  -- poder demostrar que se mostró la correcta.
  country_code   text,

  human_reviewed boolean not null default false,
  reviewer_id    uuid references public.profiles(id) on delete set null,
  outcome        text,

  created_at     timestamptz not null default now(),
  attended_at    timestamptz
);

-- LA COLA QUE MÁS IMPORTA. Parcial sobre lo no atendido de riesgo alto: es la
-- consulta que un humano ejecuta cada pocos segundos, y debe devolver en
-- microsegundos aunque la tabla tenga años de histórico.
create index idx_crisis_pending on public.crisis_events (created_at)
  where attended_at is null and risk in ('high', 'critical');

comment on index public.idx_crisis_pending is
  'Cola de crisis viva. Replica literalmente: where attended_at is null and risk in (''high'',''critical'') order by created_at. Índice parcial → su tamaño es el del backlog real, no el del histórico.';

create index idx_crisis_user on public.crisis_events (user_id, created_at desc);

-- ============================================================================
-- SECCIÓN 6 · ECONOMÍA PREMIUM (CRISTALES)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- crystal_ledger — libro APPEND-ONLY. profiles.crystals es solo el caché; la
-- verdad está aquí y se puede reconstruir con un sum().
--
-- external_id ÚNICO = idempotencia frente a los webhooks de Apple IAP y Google
-- Play, que se reintentan por diseño (si tu endpoint tarda o devuelve 5xx, la
-- store reenvía la misma notificación durante días). Sin esta restricción, un
-- reintento acredita los cristales dos veces y la economía se rompe.
-- ----------------------------------------------------------------------------
create table public.crystal_ledger (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,

  -- Positivo = compra o regalo recibido. Negativo = gasto.
  delta        integer not null check (delta <> 0),
  reason       text not null,
  source       text not null default 'iap'
               check (source in ('iap_apple', 'iap_google', 'iap', 'gift', 'grant', 'spend', 'refund')),

  -- Identificador de la transacción de la store. NULL para movimientos internos
  -- (gastos), que no necesitan idempotencia externa porque van dentro de la
  -- misma transacción que el descuento.
  external_id  text,
  -- Recibo crudo de la store, por si hay que reauditar una compra disputada.
  raw_receipt  jsonb,

  created_at   timestamptz not null default now()
);

-- Unique PARCIAL: permite muchos NULL (los movimientos internos) y garantiza
-- unicidad solo donde importa. El insert de webhook debe ser siempre:
--   insert into crystal_ledger (...) values (...)
--   on conflict (external_id) where external_id is not null do nothing;
create unique index uq_crystal_ledger_external
  on public.crystal_ledger (external_id) where external_id is not null;

create index idx_crystal_ledger_user on public.crystal_ledger (user_id, id desc);

comment on index public.idx_crystal_ledger_user is
  'Historial de compras. Keyset: where user_id = :u and id < :cursor_id order by id desc.';

-- Append-only DE VERDAD. Los revokes de más abajo blindan a anon/authenticated,
-- pero service_role los saltaría: este trigger hace que ni un script del propio
-- equipo pueda reescribir el histórico económico. Corregir un movimiento se
-- hace insertando el contrario ('refund'), como en cualquier contabilidad seria.
create or replace function public.crystal_ledger_immutable() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'crystal_ledger es append-only: para corregir, inserta un movimiento inverso con source = ''refund''';
end;
$$;

create trigger trg_crystal_ledger_immutable
  before update or delete on public.crystal_ledger
  for each row execute function public.crystal_ledger_immutable();

-- ----------------------------------------------------------------------------
-- boosts — dar visibilidad temporal a un post. Se paga con karma gastable o con
-- cristales; el efecto en el feed lo aplica posts.boost_until (definido en
-- 0001), no esta tabla, que es solo el registro de la compra.
-- ----------------------------------------------------------------------------
create table public.boosts (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,

  currency   public.boost_currency not null,
  amount     integer not null check (amount > 0),

  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint boosts_window check (expires_at > created_at)
);

-- Los dos accesos reales: "boosts vivos de este post" (feed) y "boosts de hoy
-- de esta persona" (el límite antiabuso de más abajo).
--
-- NO se usa un índice parcial `where expires_at > now()` aunque sería el
-- predicado exacto: Postgres exige que las funciones del predicado sean
-- IMMUTABLE y now() no lo es (se congelaría en el instante de crear el índice).
-- El índice compuesto da el mismo plan: se salta a post_id y recorre por
-- expires_at.
create index idx_boosts_active on public.boosts (post_id, expires_at desc);
create index idx_boosts_user_day on public.boosts (user_id, created_at desc);

-- Techo antiabuso: N boosts al día por persona. Vive en un trigger y no en la
-- API porque la anon key permite insertar directamente vía PostgREST.
-- El count(*) aquí es aceptable —y solo aquí— porque es un camino de ESCRITURA
-- poco frecuente y el índice parcial por (user_id, created_at) hace que cuente
-- como mucho N+1 filas, nunca la tabla.
create or replace function public.boosts_enforce_daily_limit() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max   constant integer := 3;
  v_count integer;
begin
  select count(*) into v_count
    from public.boosts b
   where b.user_id = new.user_id
     and b.created_at >= date_trunc('day', now());

  if v_count >= v_max then
    raise exception 'límite de % boosts por día alcanzado', v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_boosts_daily_limit
  before insert on public.boosts
  for each row execute function public.boosts_enforce_daily_limit();

-- ----------------------------------------------------------------------------
-- gifts — regalos simbólicos (una vela, un abrazo) entre personas anónimas.
-- Con comisión: parte del coste se retiene y parte llega al receptor. Se
-- guardan los tres números (coste, comisión, neto) y no solo el coste, porque
-- un cambio futuro de la comisión no debe reescribir el histórico.
-- ----------------------------------------------------------------------------
create table public.gifts (
  id             uuid primary key default gen_random_uuid(),
  sender_id      uuid not null references public.profiles(id) on delete cascade,
  recipient_id   uuid not null references public.profiles(id) on delete cascade,

  -- Contexto opcional: el regalo puede colgar de un post, un comentario o nada.
  ref_type       text check (ref_type in ('post', 'comment', 'refuge')),
  ref_id         uuid,

  gift_kind      text not null,
  cost_crystals  integer not null check (cost_crystals > 0),
  fee_crystals   integer not null default 0 check (fee_crystals >= 0),
  net_crystals   integer not null check (net_crystals >= 0),
  message        text check (message is null or char_length(message) <= 140),

  created_at     timestamptz not null default now(),

  constraint gifts_no_self check (sender_id <> recipient_id),
  -- La aritmética es una restricción, no una convención: impide que un bug de
  -- la app cree cristales de la nada.
  constraint gifts_amounts check (cost_crystals = fee_crystals + net_crystals)
);

create index idx_gifts_recipient on public.gifts (recipient_id, created_at desc);
create index idx_gifts_sender on public.gifts (sender_id, created_at desc);

-- ----------------------------------------------------------------------------
-- spend_crystals — mismo patrón atómico que spend_karma() en 0001: el WHERE del
-- UPDATE ES a la vez la comprobación de saldo y el descuento. Dos gastos
-- simultáneos no pueden dejar el saldo negativo porque el segundo espera el
-- lock de fila del primero y luego no encuentra fila que cumpla la condición.
-- Devuelve false (no excepción) para que la app distinga "sin saldo" de "error".
-- ----------------------------------------------------------------------------
create or replace function public.spend_crystals(
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
     set crystals = crystals - p_amount
   where id = p_user and crystals >= p_amount
  returning true into v_ok;

  if v_ok is null then
    return false;
  end if;

  -- Mismo statement transaccional que el descuento: o hay apunte y descuento, o
  -- no hay ninguno de los dos.
  insert into public.crystal_ledger (user_id, delta, reason, source)
  values (p_user, -p_amount, p_reason, 'spend');

  return true;
end;
$$;

revoke all on function public.spend_crystals(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.spend_crystals(uuid, integer, text) to service_role;

-- ============================================================================
-- SECCIÓN 7 · RATE LIMITING PERSISTENTE
--
-- ¿Por qué hace falta si ya hay un limitador en memoria en el servidor de Next?
-- Porque en serverless NO HAY "el" servidor: cada invocación puede caer en una
-- instancia distinta, y cada instancia tiene su propio Map en su propia RAM. Un
-- límite de 10/min con 20 instancias vivas es, en la práctica, 200/min. Y al
-- reciclarse la instancia el contador se pone a cero. El limitador en memoria
-- sigue siendo útil como primera barrera barata (evita el viaje a la base de
-- datos en el caso común), pero el límite REAL tiene que ser compartido, y el
-- único estado compartido y transaccional que tenemos es Postgres.
-- ============================================================================

create table public.rate_limits (
  -- Clave compuesta por la app: 'post:<uuid>', 'ip:<hash>', 'refuge_msg:<uuid>'.
  key          text primary key,
  -- Inicio de la ventana FIJA (no deslizante). Una ventana deslizante exigiría
  -- guardar cada evento; la fija se resuelve con una fila y un upsert, que es lo
  -- que permite que esto aguante cientos de miles de usuarios.
  window_start timestamptz not null,
  count        integer not null default 0
);

comment on table public.rate_limits is
  'Contador compartido entre instancias serverless. Se puede truncar sin pérdida: solo abre la ventana a todo el mundo durante un intervalo.';

-- Barrido de ventanas viejas (job periódico): delete where window_start < now() - interval '1 day'.
create index idx_rate_limits_window on public.rate_limits (window_start);

-- check_rate_limit — atómica. Todo (leer, decidir si la ventana caducó,
-- incrementar) ocurre en UN solo statement: `insert ... on conflict do update`
-- toma el lock de la fila, así que dos peticiones simultáneas nunca leen el
-- mismo contador y escriben el mismo valor. Un SELECT seguido de UPDATE sí
-- tendría esa carrera y el límite se podría duplicar bajo carga.
create or replace function public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'parámetros de rate limit inválidos';
  end if;

  -- Ventana alineada a múltiplos del intervalo: todas las instancias calculan
  -- exactamente el mismo instante de inicio sin coordinarse entre ellas.
  v_window := to_timestamp(
    (floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds)::double precision
  );

  -- En ON CONFLICT DO UPDATE la fila existente se referencia por el NOMBRE de la
  -- tabla (sin esquema) y la propuesta por `excluded`.
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key) do update
     set count = case
                   when rate_limits.window_start = excluded.window_start
                   then rate_limits.count + 1
                   else 1                      -- ventana nueva: reinicia
                 end,
         window_start = excluded.window_start
  returning rate_limits.count into v_count;

  -- true = permitido. La petición que hace exactamente p_limit todavía pasa.
  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- ============================================================================
-- TRIGGERS DE CONTADORES DESNORMALIZADOS
-- Ninguna lectura de la app hace count(*): todo lo que se muestra como número
-- se mantiene aquí, en el camino de escritura, que es N veces menos frecuente.
-- ============================================================================

-- ── Refugios: miembros ─────────────────────────────────────────────────────
create or replace function public.refuge_members_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- El aforo se comprueba y se ocupa en el mismo UPDATE: el WHERE es la
    -- comprobación. Dos invitaciones simultáneas no pueden desbordar la sala.
    update public.refuges
       set member_count = member_count + 1
     where id = new.refuge_id and member_count < max_members;

    if not found then
      raise exception 'el refugio está completo' using errcode = 'check_violation';
    end if;

  elsif tg_op = 'DELETE' then
    update public.refuges
       set member_count = greatest(0, member_count - 1)
     where id = old.refuge_id;

  elsif tg_op = 'UPDATE' then
    -- Salir (left_at pasa de null a no null) libera plaza; volver la ocupa.
    if old.left_at is null and new.left_at is not null then
      update public.refuges set member_count = greatest(0, member_count - 1) where id = new.refuge_id;
    elsif old.left_at is not null and new.left_at is null then
      update public.refuges set member_count = member_count + 1 where id = new.refuge_id;
    end if;
  end if;

  return null;
end;
$$;

create trigger trg_refuge_members_sync
  after insert or delete or update of left_at on public.refuge_members
  for each row execute function public.refuge_members_sync();

-- ── Refugios: actividad ────────────────────────────────────────────────────
-- Sin esto, ordenar la bandeja por "último mensaje" obligaría a un max(id) por
-- refugio en cada carga. Con esto es una lectura de columna.
create or replace function public.refuge_messages_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.refuges
     set message_count   = message_count + 1,
         last_message_at = new.created_at
   where id = new.refuge_id;
  return null;
end;
$$;

create trigger trg_refuge_messages_sync
  after insert on public.refuge_messages
  for each row execute function public.refuge_messages_sync();

-- ── Encuestas: votos ───────────────────────────────────────────────────────
create or replace function public.poll_votes_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
    update public.polls        set total_votes = total_votes + 1 where id = new.poll_id;
  else
    update public.poll_options set vote_count = greatest(0, vote_count - 1) where id = old.option_id;
    update public.polls        set total_votes = greatest(0, total_votes - 1) where id = old.poll_id;
  end if;
  return null;
end;
$$;

create trigger trg_poll_votes_sync
  after insert or delete on public.poll_votes
  for each row execute function public.poll_votes_sync();

-- ── Contenido: vistas, finalizaciones, score y karma ───────────────────────
-- El score se materializa aquí por el mismo motivo que el hot_score de posts en
-- 0001: ordenar el feed no puede implicar dividir dos contadores por fila.
-- La fórmula pondera la tasa de finalización por el volumen (log) para que un
-- vídeo con 1 vista y 1 finalización no encabece el feed con un 100 %.
create or replace function public.content_views_sync() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_views       integer;
  v_completions integer;
begin
  if tg_op = 'INSERT' then
    update public.content_items
       set view_count       = view_count + 1,
           completion_count = completion_count + (case when new.completed then 1 else 0 end)
     where id = new.content_id
    returning view_count, completion_count into v_views, v_completions;

  elsif new.completed and not old.completed then
    update public.content_items
       set completion_count = completion_count + 1
     where id = new.content_id
    returning view_count, completion_count into v_views, v_completions;

  else
    return null;
  end if;

  -- Casts explícitos a numeric: log(b, x) solo existe para numeric, y el cast
  -- desde double precision no es implícito en resolución de funciones.
  update public.content_items
     set performance_score =
           (v_completions::double precision / greatest(v_views, 1))
           * log(10::numeric, greatest(v_views, 10)::numeric)::double precision
   where id = new.content_id;

  -- Karma 'content_completed' (+1, ver karma_weights en 0001). La clave de
  -- idempotencia es (contenido, usuario): reproducir el mismo vídeo mil veces
  -- paga una sola vez, aunque la fila se actualice mil veces.
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    perform public.award_karma(
      new.user_id, 'content_completed', 'content_item', new.content_id,
      'content_completed:' || new.content_id::text || ':' || new.user_id::text
    );
  end if;

  return null;
end;
$$;

create trigger trg_content_views_sync
  after insert or update of completed on public.content_views
  for each row execute function public.content_views_sync();

-- ============================================================================
-- RLS — denegado por defecto en TODAS las tablas nuevas.
-- ============================================================================
alter table public.refuges          enable row level security;
alter table public.refuge_members   enable row level security;
alter table public.refuge_messages  enable row level security;
alter table public.kindred          enable row level security;
alter table public.blocks           enable row level security;
alter table public.content_items    enable row level security;
alter table public.content_views    enable row level security;
alter table public.polls            enable row level security;
alter table public.poll_options     enable row level security;
alter table public.poll_votes       enable row level security;
alter table public.moderation_flags enable row level security;
alter table public.crisis_events    enable row level security;
alter table public.crystal_ledger   enable row level security;
alter table public.boosts           enable row level security;
alter table public.gifts            enable row level security;
alter table public.rate_limits      enable row level security;

-- moderation_flags, crisis_events y rate_limits: NINGUNA política. Deliberado.
-- Son infraestructura del servidor; que un cliente pueda leerlas sería filtrar
-- quién reportó a quién y quién está en riesgo.

-- ── Refugios ───────────────────────────────────────────────────────────────
-- Un no miembro no obtiene error: obtiene cero filas. No puede distinguir "no
-- tengo acceso" de "no existe", que es exactamente la propiedad que se busca.
create policy refuges_read_member on public.refuges
  for select to authenticated using (
    public.is_refuge_member(id)
    and not public.refuge_has_block(id, (select auth.uid()))
  );

create policy refuges_insert_own on public.refuges
  for insert to authenticated with check (created_by = (select auth.uid()));

-- Editar título/tema/archivado: solo quien creó la sala.
create policy refuges_update_creator on public.refuges
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- ── Miembros ───────────────────────────────────────────────────────────────
create policy refuge_members_read on public.refuge_members
  for select to authenticated using (
    public.is_refuge_member(refuge_id)
  );

-- Entrar: o te añade el anfitrión, o entras tú mismo (con invitación validada
-- por el servidor). En ningún caso se puede meter a un tercero en una sala.
-- Y nunca a través de un bloqueo: eso convertiría los refugios en una vía para
-- alcanzar a quien te bloqueó.
create policy refuge_members_join on public.refuge_members
  for insert to authenticated with check (
    (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.refuges r
         where r.id = refuge_id and r.created_by = (select auth.uid())
      )
    )
    and not public.refuge_has_block(refuge_id, user_id)
  );

-- Salir o silenciar: solo sobre la propia fila.
create policy refuge_members_update_own on public.refuge_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy refuge_members_leave on public.refuge_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── Mensajes ───────────────────────────────────────────────────────────────
create policy refuge_messages_read on public.refuge_messages
  for select to authenticated using (
    state = 'active'
    and public.is_refuge_member(refuge_id)
    and not public.refuge_has_block(refuge_id, (select auth.uid()))
  );

-- Escribir exige tres cosas a la vez: ser tú el remitente, seguir siendo
-- miembro, y que no haya bloqueo. La segunda condición es la que hace que
-- expulsar a alguien lo silencie de inmediato, sin desplegar nada.
create policy refuge_messages_insert on public.refuge_messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and public.is_refuge_member(refuge_id)
    and not public.refuge_has_block(refuge_id, (select auth.uid()))
  );

-- Solo se puede retirar el propio mensaje (state); el ciphertext es inmutable
-- por privilegio de columna más abajo — editar un mensaje ya leído por la otra
-- persona reescribiría su recuerdo de la conversación.
create policy refuge_messages_update_own on public.refuge_messages
  for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

-- ── Almas afines ───────────────────────────────────────────────────────────
-- Cada quien ve SOLO su propia lista. Ni siquiera se puede saber si alguien te
-- tiene guardado: la política no contempla el sentido inverso.
create policy kindred_read_own on public.kindred
  for select to authenticated using (owner_id = (select auth.uid()));

create policy kindred_insert_own on public.kindred
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    -- No se puede guardar a quien te bloqueó ni a quien bloqueaste.
    and not public.is_blocked_with(kindred_id)
  );

create policy kindred_update_own on public.kindred
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy kindred_delete_own on public.kindred
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ── Bloqueos ───────────────────────────────────────────────────────────────
-- Solo lee sus bloqueos quien los creó. Que la persona bloqueada no pueda
-- consultarlo es intencionado: si supiera que la bloquearon, buscaría otra vía.
create policy blocks_read_own on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- ── Contenido curado ───────────────────────────────────────────────────────
-- Lectura solo de lo aprobado. Lo pendiente y lo rechazado no existe para el
-- cliente: es la barrera que impide que contenido sin revisar llegue a alguien
-- vulnerable por un fallo de la app. Sin políticas de escritura → solo
-- service_role ingesta.
create policy content_items_read_approved on public.content_items
  for select to authenticated using (state = 'approved');

-- Cada persona registra y consulta solo sus propias visualizaciones.
create policy content_views_read_own on public.content_views
  for select to authenticated using (user_id = (select auth.uid()));

-- Se puede abrir la fila (empezaste a ver algo), pero SIEMPRE a cero: el
-- `with check` impide nacer ya completado. Sin esta condición, el agujero que
-- cerramos en los privilegios de UPDATE volvería a abrirse por la vía del
-- INSERT, que es la mitad que casi siempre se olvida.
create policy content_views_insert_own on public.content_views
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and completed = false
    and coalesce(watched_seconds, 0) = 0
  );

-- Sin política de UPDATE a propósito: el avance de reproducción lo escribe la
-- RPC de latidos de B07 (security definer), que es la única que puede comprobar
-- que el tiempo declarado es plausible.

-- ── Encuestas ──────────────────────────────────────────────────────────────
create policy polls_read on public.polls
  for select to authenticated using (state = 'active');

create policy polls_insert_own on public.polls
  for insert to authenticated with check (author_id = (select auth.uid()));

create policy poll_options_read on public.poll_options
  for select to authenticated using (
    exists (select 1 from public.polls p where p.id = poll_id and p.state = 'active')
  );

create policy poll_options_insert_author on public.poll_options
  for insert to authenticated with check (
    exists (select 1 from public.polls p where p.id = poll_id and p.author_id = (select auth.uid()))
  );

-- El voto es privado incluso para el autor de la encuesta: cada quien ve solo
-- el suyo, y los totales salen de los contadores desnormalizados, no de contar
-- filas de esta tabla. Así "¿alguien más se siente así?" se puede responder sin
-- exponer a nadie.
create policy poll_votes_read_own on public.poll_votes
  for select to authenticated using (user_id = (select auth.uid()));

create policy poll_votes_insert_own on public.poll_votes
  for insert to authenticated with check (user_id = (select auth.uid()));

-- ── Economía ───────────────────────────────────────────────────────────────
-- Cada quien ve su propio libro de cristales. Escritura: solo service_role
-- (webhooks de la store) o spend_crystals(), que es SECURITY DEFINER.
create policy crystal_ledger_read_own on public.crystal_ledger
  for select to authenticated using (user_id = (select auth.uid()));

-- Los boosts son públicos por transparencia: se debe poder saber que un post
-- está impulsado, igual que un anuncio se marca como anuncio.
create policy boosts_read on public.boosts
  for select to authenticated using (true);

create policy gifts_read_involved on public.gifts
  for select to authenticated using (
    sender_id = (select auth.uid()) or recipient_id = (select auth.uid())
  );

-- Sin políticas de INSERT en boosts ni gifts: el cobro y el registro tienen que
-- ocurrir en la misma transacción, y eso solo puede hacerlo el servidor.

-- ============================================================================
-- PRIVILEGIOS DE COLUMNA
-- RLS decide QUÉ FILAS; solo el privilegio de columna decide QUÉ COLUMNAS.
-- Sin esto, una política de UPDATE "sobre mi propia fila" deja que un PATCH a
-- PostgREST reescriba contadores, saldos y estados de moderación.
-- ============================================================================

-- Refugios: el creador retoca lo cosmético; los contadores los lleva el trigger.
revoke update on public.refuges from anon, authenticated;
grant  update (title, topic, archived_at) on public.refuges to authenticated;

-- Miembros: solo se puede silenciar, marcar leído y salir.
revoke update on public.refuge_members from anon, authenticated;
grant  update (muted, last_read_message_id, left_at) on public.refuge_members to authenticated;

-- Mensajes: el ciphertext es INMUTABLE. Solo se puede retirar el mensaje.
revoke update on public.refuge_messages from anon, authenticated;
grant  update (state) on public.refuge_messages to authenticated;
-- Borrado físico prohibido: rompería el hilo de la otra persona. Se usa state.
revoke delete on public.refuge_messages from anon, authenticated;

-- Almas afines: solo la nota privada es editable.
revoke update on public.kindred from anon, authenticated;
grant  update (note) on public.kindred to authenticated;

-- Bloqueos: se crean y se quitan, no se editan (cambiar 'block' por 'mute' es
-- quitar y volver a poner, y así queda registrado el created_at correcto).
revoke update on public.blocks from anon, authenticated;

-- Contenido: catálogo de solo lectura para el cliente.
revoke insert, update, delete on public.content_items from anon, authenticated;

-- Vistas: el cliente reporta progreso, no fabrica el estado de completado a su
-- antojo… salvo `completed`, que es justamente lo que dispara el karma. Se le
-- concede porque el techo real lo pone la PK (una vez por contenido) más el
-- tope diario de award_karma() de 0001.
-- CORREGIDO (auditoría 2026-08-03). La versión anterior concedía
-- `grant update (watched_seconds, completed, completed_at)` a authenticated, y
-- eso era karma gratis: un `PATCH` directo a PostgREST poniendo
-- completed = true, repetido sobre 120 contenidos distintos, agotaba el tope
-- diario entero sin ver un solo segundo de vídeo. La PK solo impide repetir el
-- MISMO contenido; no impide barrer el catálogo.
--
-- El cliente ya no escribe nada aquí. B07 expone una RPC de latidos que acumula
-- el tiempo real de reproducción en el servidor y decide cuándo marcar
-- `completed`. El privilegio se queda en cero a propósito: si algo necesita
-- escribir en esta tabla, que pase por una función con validación.
revoke update, delete on public.content_views from anon, authenticated;

-- Encuestas: los contadores no se tocan desde el cliente.
revoke update on public.polls from anon, authenticated;
grant  update (state, closes_at) on public.polls to authenticated;
revoke update, delete on public.poll_options from anon, authenticated;
-- El voto es definitivo: sin UPDATE no se puede cambiar de opción esquivando la
-- PK, y sin DELETE no se puede votar, borrar y volver a votar.
revoke update, delete on public.poll_votes from anon, authenticated;

-- Economía: el cliente no escribe NADA. Ni un insert de cortesía.
revoke insert, update, delete on public.crystal_ledger from anon, authenticated;
revoke insert, update, delete on public.boosts from anon, authenticated;
revoke insert, update, delete on public.gifts from anon, authenticated;

-- Moderación, crisis y rate limits: sin RLS que los permita y sin privilegios.
revoke all on public.moderation_flags from anon, authenticated;
revoke all on public.crisis_events    from anon, authenticated;
revoke all on public.rate_limits      from anon, authenticated;

-- Helpers de RLS: SÍ se conceden a `authenticated`, y es obligatorio. Una
-- expresión de política se evalúa con los privilegios del rol que consulta, no
-- con los del propietario de la tabla: sin este grant, toda consulta a refuges
-- fallaría con "permission denied for function". Que sean seguras de exponer no
-- es un accidente — es el motivo de que su firma no acepte un uuid de tercero
-- (ver el bloque de helpers, más arriba).
revoke all on function public.is_refuge_member(uuid)       from public, anon;
revoke all on function public.is_blocked_with(uuid)        from public, anon;
revoke all on function public.refuge_has_block(uuid, uuid) from public, anon;

grant execute on function public.is_refuge_member(uuid)       to authenticated;
grant execute on function public.is_blocked_with(uuid)        to authenticated;
grant execute on function public.refuge_has_block(uuid, uuid) to authenticated;
