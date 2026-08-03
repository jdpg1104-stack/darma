-- ============================================================================
-- Darma · 0109_1 · B09 · Encuestas del feed
--
-- `polls`, `poll_options` y `poll_votes` ya existen desde 0002. Aquí se añade
-- lo que falta para que una encuesta pueda vivir en el feed sin identificar a
-- quien la responde:
--
--   1. El BANCO curado (`poll_bank`) y la reposición automática.
--   2. La CADENCIA por persona (`poll_cadence`) y el descarte
--      (`poll_dismissals`).
--   3. El UMBRAL DE REVELACIÓN (`polls.min_reveal`), aplicado EN POSTGRES.
--   4. Tres agujeros del esquema anterior que esta migración cierra y que se
--      documentan uno a uno más abajo (§0).
--
-- Nomenclatura: la ficha B09 pedía `0009_b09_encuestas.sql`, pero `0009` está
-- en el rango de cimientos y el que `PARALELO.md` §3 reserva a B09 es `0109x`.
-- Mismo criterio que siguió B02 con `0102_1_feed_keyset.sql`. Anotado en
-- HANDOFF/PEDIDOS.md.
--
-- ============================================================================
-- §0 · LO QUE ESTABA ROTO ANTES DE ESTA MIGRACIÓN
--
-- (a) INSERT ABIERTO EN `polls` Y `poll_options`.
--     `0004_insert_columnas.sql` enumeró las columnas insertables de
--     `comments`, `posts`, `post_votes`, `poll_votes` y `content_views` — pero
--     no tocó `polls` ni `poll_options`. Comprobado contra la base de
--     desarrollo: `authenticated` (y `anon`) tenían INSERT sobre TODAS las
--     columnas de las dos tablas, `total_votes` y `vote_count` incluidas.
--     Traducción: cualquiera podía crear una encuesta y publicarla ya con
--     `vote_count = 40000` en la opción que le conviniera. El agregado de una
--     encuesta de bienestar es exactamente el dato que la gente usa para
--     decidir si lo que le pasa es normal; falsificarlo es barato y es daño
--     real. Se enumeran aquí (RLS decide filas, el privilegio de columna decide
--     columnas).
--
-- (b) UN VOTO PODÍA APUNTAR A LA OPCIÓN DE OTRA ENCUESTA.
--     `poll_votes` tiene FK a `polls(id)` y FK a `poll_options(id)`, pero NADA
--     obligaba a que la opción perteneciera a esa encuesta. Con un `option_id`
--     ajeno, `poll_votes_sync()` sumaba `vote_count` en la encuesta A y
--     `total_votes` en la B: contadores descuadrados y voto inflado sin tocar
--     ninguna restricción. Se cierra con una FK COMPUESTA
--     `(option_id, poll_id) → poll_options (id, poll_id)`, que lo hace
--     imposible en el motor en vez de comprobarlo en la app.
--
-- (c) `poll_options.vote_count` ERA LEGIBLE DIRECTAMENTE POR EL CLIENTE.
--     Un `GET /rest/v1/poll_options?poll_id=eq.<x>` con la anon key devolvía
--     los recuentos por opción. Con eso, cualquier umbral de revelación que
--     viva en la ruta de Next es decorativo: se salta con curl (ARCHITECTURE
--     §0). Se revoca el SELECT de esa columna y los resultados salen SOLO por
--     `encuesta_resultados()`, que aplica `min_reveal` dentro de Postgres.
--
-- Además, las políticas `poll_options_read` y `poll_options_insert_author` de
-- 0002 consultaban `public.polls` con una SUBCONSULTA dentro de la política.
-- Es el acoplamiento invisible que documenta `0005_politica_posts_read.sql`: el
-- día que se revoque una columna de `polls`, la política se rompe en silencio y
-- el error apunta a otro sitio. Se reescriben las dos contra funciones
-- `security definer`, igual que `esta_silenciado()`.
-- ============================================================================

-- ============================================================================
-- 1 · COLUMNAS NUEVAS DE `polls`
-- ============================================================================

-- De dónde salió la encuesta y con qué clave del banco, para no repetirla.
alter table public.polls add column if not exists origin text not null default 'usuario'
  check (origin in ('usuario', 'banco'));
alter table public.polls add column if not exists bank_key text;

-- Idioma de la encuesta. La regla de reposición es "al menos 3 activas POR
-- IDIOMA": sin esta columna, un banco en español dejaría el feed en inglés sin
-- encuestas y nadie se enteraría.
alter table public.polls add column if not exists language text not null default 'es'
  check (language ~ '^[a-z]{2}$');

-- Umbral por debajo del cual NO se publican porcentajes. Con 3 votos y un
-- refugio de 4 personas, un porcentaje identifica a quien votó: la primera
-- persona que responde ve "100 % opción A" y deduce el voto de la siguiente en
-- cuanto el número se mueve. No es una preferencia estética.
--
-- El suelo de 3 está en el CHECK y no solo en el default porque el default se
-- puede sobrescribir y el CHECK no. `authenticated` tampoco puede escribir esta
-- columna (§5), así que hacen falta las dos cosas para bajarla: privilegio y
-- que el motor lo acepte.
alter table public.polls add column if not exists min_reveal smallint not null default 5
  check (min_reveal between 3 and 10000);

-- Dos reposiciones simultáneas no pueden activar la misma pregunta dos veces.
-- Parcial: las encuestas de personas no tienen `bank_key` y no deben competir
-- por la unicidad.
create unique index if not exists uq_polls_bank_key
  on public.polls (bank_key) where bank_key is not null;

-- El `WHERE` real de la consulta de selección (§7) y de la de reposición.
-- `idx_polls_feed` de 0002 no lleva el idioma, así que con dos idiomas activos
-- obligaría a filtrar sobre el heap.
create index if not exists idx_polls_activas_idioma
  on public.polls (language, created_at desc, id desc) where state = 'active';

comment on index public.idx_polls_activas_idioma is
  'where state = ''active'' and language = :idioma order by created_at desc, id desc.';

-- ── §0(b): la FK compuesta que ata la opción a su encuesta ──────────────────
-- Hace falta un unique sobre (id, poll_id) para poder referenciarlo. Es
-- redundante en información (id ya es PK) pero es el precio de que el motor
-- pueda comprobar la pertenencia.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_poll_options_id_poll') then
    alter table public.poll_options
      add constraint uq_poll_options_id_poll unique (id, poll_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fk_poll_votes_opcion_de_su_encuesta') then
    alter table public.poll_votes
      add constraint fk_poll_votes_opcion_de_su_encuesta
      foreign key (option_id, poll_id)
      references public.poll_options (id, poll_id) on delete cascade;
  end if;
end;
$$;

-- ============================================================================
-- 2 · EL BANCO CURADO
--
-- En tabla y no en una constante de TypeScript para poder retirar una pregunta
-- en producción sin desplegar: una pregunta de bienestar puede envejecer muy
-- mal muy deprisa, y "esperar al siguiente despliegue" no es una respuesta
-- aceptable cuando la pregunta que está en el feed hace daño.
-- ============================================================================

create table if not exists public.poll_bank (
  key        text primary key,
  question   text not null check (char_length(question) between 5 and 200),
  options    text[] not null check (array_length(options, 1) between 2 and 5),
  topic      text,
  language   text not null default 'es' check (language ~ '^[a-z]{2}$'),
  enabled    boolean not null default true,
  -- Cuántas veces se ha activado ya. Rota por la menos usada.
  times_used smallint not null default 0,
  last_used_at timestamptz
);

-- El `WHERE` real de la consulta de reposición: enabled, por idioma, la menos
-- usada primero, `key` como desempate estable.
create index if not exists idx_poll_bank_pick
  on public.poll_bank (language, times_used, key) where enabled;

-- ============================================================================
-- 3 · DESCARTE Y CADENCIA
-- ============================================================================

-- "No me interesa" / "ya la vi y no voté". Es lo que permite que la cadencia no
-- dependa solo de haber votado: sin esto, una encuesta que alguien no quiere
-- responder le persigue por el feed hasta que caduque.
create table if not exists public.poll_dismissals (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- La PK `(poll_id, user_id)` sirve para la sonda "¿ha descartado ESTA persona
-- ESTA encuesta?" cuando el planificador la resuelve fila a fila. Pero cuando
-- decide darle la vuelta al anti-join —"dame todo lo que ha descartado esta
-- persona"— `user_id` deja de ser la columna guía y el índice se recorre
-- entero. Medido: con 200 000 descartes, 1 730 buffers y 38 ms solo en esa
-- rama. Con el índice espejo, el mismo plan cuesta unidades de buffer.
-- `poll_votes` ya tenía el suyo desde 0003 (`idx_poll_votes_user`); esta tabla
-- se lo había dejado sin poner por copiar la forma de la PK sin copiar el
-- índice que la acompañaba.
create index if not exists idx_poll_dismissals_user
  on public.poll_dismissals (user_id, poll_id);

comment on index public.idx_poll_dismissals_user is
  'not exists (select 1 from poll_dismissals where poll_id = :p and user_id = :yo), cuando el plan invierte el anti-join.';

-- Última vez que ESTA persona vio una encuesta en el feed. Una fila por
-- persona: la cadencia se resuelve con una lectura por clave primaria, no
-- agregando sobre el histórico.
create table if not exists public.poll_cadence (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  last_shown_at timestamptz,
  shown_today   smallint not null default 0 check (shown_today >= 0),
  day           date not null default current_date
);

-- ============================================================================
-- 4 · EL PERFIL DE SISTEMA
--
-- `polls.author_id` es NOT NULL y `polls_insert_own` exige
-- `author_id = auth.uid()`. Las encuestas del banco no tienen autor humano, así
-- que necesitan un perfil propio — y las inserta `service_role`, que salta RLS
-- (ver `reponer_encuestas()`, §8).
--
-- El id es FIJO y no aleatorio: la reposición lo resuelve por alias una vez y
-- lo cachea, pero un id estable hace que un `insert ... on conflict` sea
-- idempotente entre despliegues y que se pueda reconocer de un vistazo en
-- cualquier dump.
--
-- La fila de `auth.users` se crea aquí porque `profiles.id` tiene FK contra
-- ella y B01 no reserva el alias todavía (anotado en HANDOFF/PEDIDOS.md). No
-- tiene email, ni contraseña, ni identidad en `identity_vault`: no es una
-- cuenta, es un emisor. Nadie puede iniciar sesión como Darma porque no hay
-- ninguna credencial con la que hacerlo.
-- ============================================================================

insert into auth.users (id, is_anonymous)
values ('0da12a00-0000-4000-8000-000000000009', false)
on conflict (id) do nothing;

insert into public.profiles (id, alias, avatar_seed, bio)
values (
  '0da12a00-0000-4000-8000-000000000009',
  'Darma',
  'darma000',
  'Las preguntas de la comunidad. Responder es anónimo.'
)
on conflict (id) do nothing;

comment on column public.polls.origin is
  '''banco'' = curada, autor = el perfil de sistema Darma. ''usuario'' = escrita por una persona (pasa por evaluarRiesgo(), CONTRATOS §9).';

-- ============================================================================
-- 5 · PRIVILEGIOS DE COLUMNA
-- RLS decide QUÉ FILAS; solo el privilegio de columna decide QUÉ COLUMNAS.
-- ============================================================================

-- ── polls (§0a) ─────────────────────────────────────────────────────────────
-- Lo que una persona puede declarar al crear su encuesta es la pregunta, a qué
-- post cuelga y cuándo cierra. Todo lo demás lo decide el servidor:
--   · `total_votes` y `state`  → los llevan el trigger y la moderación.
--   · `origin` y `bank_key`    → declararse "banco" sería colarse en la rotación
--                                curada con la firma implícita de Darma.
--   · `min_reveal`             → bajarlo a 3 es des-anonimizar a quien vota.
--   · `is_anonymous`           → el anonimato del voto no es opcional en Darma.
--   · `created_at`             → sitúa la encuesta arriba del keyset del feed.
revoke insert on public.polls from anon, authenticated;
grant  insert (post_id, author_id, question, closes_at) on public.polls to authenticated;

-- ── poll_options (§0a) ──────────────────────────────────────────────────────
revoke insert on public.poll_options from anon, authenticated;
grant  insert (poll_id, ordinal, label) on public.poll_options to authenticated;

-- ── poll_options (§0c): el recuento por opción deja de ser legible ──────────
-- Sin esto el umbral de revelación no existe: se lee `vote_count` con la anon
-- key y se calculan los porcentajes a mano. Los resultados salen SOLO por
-- `encuesta_resultados()`, que aplica `min_reveal` dentro del motor.
revoke select on public.poll_options from anon, authenticated;
grant  select (id, poll_id, ordinal, label) on public.poll_options to authenticated;

-- `polls.total_votes` SÍ sigue siendo legible: "12 personas han respondido" no
-- revela el reparto, y es lo que permite que la tarjeta explique por qué
-- todavía no enseña porcentajes sin mentir sobre cuánta gente ha contestado.

-- ── Tablas nuevas ───────────────────────────────────────────────────────────
-- Descartes: se crean y ya está. Sin update (no hay nada que editar) y sin
-- delete (des-descartar es votar, y para eso está el voto).
revoke all    on public.poll_dismissals from anon, authenticated;
grant  select on public.poll_dismissals to authenticated;
grant  insert (poll_id, user_id) on public.poll_dismissals to authenticated;

-- Cadencia: se LEE (la ruta necesita las señales para decidir) pero no se
-- escribe desde el cliente. La única columna insertable es `user_id`, que la
-- política clava a auth.uid(); el contador lo lleva `encuesta_siguiente()`.
-- Si `shown_today` fuera escribible, cualquiera se pondría el contador a 0 y el
-- tope diario dejaría de existir.
revoke all    on public.poll_cadence from anon, authenticated;
grant  select on public.poll_cadence to authenticated;
grant  insert (user_id) on public.poll_cadence to authenticated;

-- Banco: NI UN PRIVILEGIO. Publicar el banco entero revelaría las preguntas
-- futuras y sesgaría las respuestas de las que ya están en el feed. No se
-- expone por API jamás.
revoke all on public.poll_bank from anon, authenticated;

-- ============================================================================
-- 6 · RLS
-- ============================================================================

alter table public.poll_bank       enable row level security;
alter table public.poll_dismissals enable row level security;
alter table public.poll_cadence    enable row level security;

-- `poll_bank`: RLS activada y CERO políticas → denegado para anon y
-- authenticated. Solo service_role y las funciones `security definer` de abajo.
-- Mismo patrón deliberado que `identity_vault` en 0001.

drop policy if exists poll_dismissals_own on public.poll_dismissals;
create policy poll_dismissals_own on public.poll_dismissals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists poll_dismissals_insert_own on public.poll_dismissals;
create policy poll_dismissals_insert_own on public.poll_dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists poll_cadence_own on public.poll_cadence;
create policy poll_cadence_own on public.poll_cadence
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists poll_cadence_insert_own on public.poll_cadence;
create policy poll_cadence_insert_own on public.poll_cadence
  for insert to authenticated with check (user_id = (select auth.uid()));

-- ── Funciones de apoyo de las políticas ────────────────────────────────────
-- Una política RLS NUNCA debe consultar otra tabla con una subconsulta: las
-- expresiones de la política se evalúan con los privilegios de QUIEN CONSULTA,
-- así que revocar mañana una columna de `polls` rompería la política en
-- silencio y el error apuntaría a otro sitio (lección de 0005).

create or replace function public.encuesta_visible(p_poll uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.polls p where p.id = p_poll and p.state = 'active'
  );
$$;

create or replace function public.soy_autor_encuesta(p_poll uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.polls p
     where p.id = p_poll and p.author_id = auth.uid()
  );
$$;

-- ¿Se puede votar en esta encuesta AHORA? Activa y no cerrada.
-- Va en la política de INSERT de `poll_votes` porque, sin ella, `0002` permitía
-- votar en una encuesta oculta o caducada: la política solo comprobaba QUIÉN
-- eres, no DÓNDE votas.
create or replace function public.encuesta_admite_voto(p_poll uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.polls p
     where p.id = p_poll
       and p.state = 'active'
       and (p.closes_at is null or p.closes_at > now())
  );
$$;

revoke all on function public.encuesta_visible(uuid)      from public, anon;
revoke all on function public.soy_autor_encuesta(uuid)    from public, anon;
revoke all on function public.encuesta_admite_voto(uuid)  from public, anon;
grant execute on function public.encuesta_visible(uuid)     to authenticated, service_role;
grant execute on function public.soy_autor_encuesta(uuid)   to authenticated, service_role;
grant execute on function public.encuesta_admite_voto(uuid) to authenticated, service_role;

-- ── Políticas reescritas de 0002 ───────────────────────────────────────────
drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options
  for select to authenticated using (public.encuesta_visible(poll_id));

drop policy if exists poll_options_insert_author on public.poll_options;
create policy poll_options_insert_author on public.poll_options
  for insert to authenticated with check (public.soy_autor_encuesta(poll_id));

drop policy if exists poll_votes_insert_own on public.poll_votes;
create policy poll_votes_insert_own on public.poll_votes
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and public.encuesta_admite_voto(poll_id)
  );

-- ============================================================================
-- 7 · LA ENCUESTA QUE TOCA — selección + registro de cadencia en UNA llamada
--
-- POR QUÉ `security definer` (y no es un atajo):
-- la función escribe en `poll_cadence`, cuyo UPDATE está revocado a propósito
-- (§5). Es la misma razón por la que `award_karma()` es definer: la escritura
-- tiene que ocurrir sin que el cliente pueda hacerla por su cuenta.
--
-- La cautela que compensa el privilegio: la función NO acepta un id de usuario.
-- Lo saca de `auth.uid()` y sin sesión devuelve `null`. Aceptar un `p_user`
-- sería exactamente la vulnerabilidad de CONTRATOS §6, y con definer sería
-- además "dame la cadencia de cualquiera".
--
-- Coste: un `limit 1` sobre `idx_polls_activas_idioma` con dos sondas por
-- clave primaria por candidato (`poll_votes` y `poll_dismissals` comparten la
-- forma `(poll_id, user_id)`). Como el pool de activas se mantiene en unas
-- pocas por idioma (§8), toca un puñado de filas aunque haya millones de votos.
-- ============================================================================

create or replace function public.encuesta_siguiente(p_idioma text default 'es')
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo     uuid := auth.uid();
  v_poll   public.polls%rowtype;
  v_idioma text := coalesce(nullif(p_idioma, ''), 'es');
begin
  -- Fail-closed: sin sesión no hay cadencia que registrar ni encuesta que dar.
  if v_yo is null then
    return null;
  end if;

  select p.* into v_poll
    from public.polls p
   where p.state = 'active'
     and p.language = v_idioma
     and (p.closes_at is null or p.closes_at > now())
     and not exists (
       select 1 from public.poll_votes v
        where v.poll_id = p.id and v.user_id = v_yo)
     and not exists (
       select 1 from public.poll_dismissals d
        where d.poll_id = p.id and d.user_id = v_yo)
   order by p.created_at desc, p.id desc
   limit 1;

  if not found then
    return null;
  end if;

  -- El contador se reinicia comparando con `current_date` dentro del propio
  -- upsert: una tarea nocturna que pusiera todas las filas a 0 sería una
  -- escritura sobre la tabla entera cada noche para no ganar nada.
  insert into public.poll_cadence (user_id, last_shown_at, shown_today, day)
  values (v_yo, now(), 1, current_date)
  on conflict (user_id) do update
    set last_shown_at = now(),
        shown_today   = case
                          when poll_cadence.day = current_date
                          then poll_cadence.shown_today + 1
                          else 1
                        end,
        day           = current_date;

  return jsonb_build_object(
    'id',          v_poll.id,
    'question',    v_poll.question,
    'total_votes', v_poll.total_votes,
    'min_reveal',  v_poll.min_reveal,
    'closes_at',   v_poll.closes_at,
    'origin',      v_poll.origin,
    -- Recién elegida = no votada (los `not exists` de arriba lo garantizan).
    'mi_voto',     null,
    -- Nunca se han visto los recuentos aquí: quien acaba de recibir la tarjeta
    -- no ha votado, así que el agregado no le corresponde todavía ni aunque la
    -- encuesta esté por encima del umbral. `revelado` lo calcula la ruta a
    -- partir de total_votes/min_reveal para el caso de después de votar.
    'options',     (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'ordinal', o.ordinal, 'label', o.label,
               'vote_count', null::integer
             ) order by o.ordinal), '[]'::jsonb)
        from public.poll_options o
       where o.poll_id = v_poll.id
    )
  );
end;
$$;

-- ============================================================================
-- 7bis · RESULTADOS — el umbral de revelación, aplicado en el motor
--
-- Los porcentajes salen SIEMPRE de `poll_options.vote_count` y
-- `polls.total_votes`, que mantiene el trigger `poll_votes_sync()`. NUNCA de un
-- `count(*)` sobre `poll_votes`: funciona perfecto con 20 votos y es un seq
-- scan con 20 millones.
--
-- `vote_count` sale como NULL mientras `total_votes < min_reveal`. Aquí y no en
-- la ruta de Next: la ruta se salta con un curl a PostgREST (ARCHITECTURE §0).
--
-- `mi_voto` sale de `auth.uid()`, jamás de un parámetro, y es lo ÚNICO que se
-- devuelve de `poll_votes`. Ni un identificador de votante, ni un `created_at`
-- de un voto ajeno: con pocos votantes, la marca de tiempo cruzada con la
-- actividad del feed identifica a la persona.
-- ============================================================================

create or replace function public.encuesta_resultados(p_poll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_yo       uuid := auth.uid();
  v_poll     public.polls%rowtype;
  v_revelado boolean;
begin
  if v_yo is null then
    return null;
  end if;

  select p.* into v_poll from public.polls p
   where p.id = p_poll and p.state <> 'removed';

  if not found then
    return null;
  end if;

  v_revelado := v_poll.total_votes >= v_poll.min_reveal;

  return jsonb_build_object(
    'id',          v_poll.id,
    'question',    v_poll.question,
    'total_votes', v_poll.total_votes,
    'min_reveal',  v_poll.min_reveal,
    'closes_at',   v_poll.closes_at,
    'origin',      v_poll.origin,
    'mi_voto',     (select v.option_id from public.poll_votes v
                     where v.poll_id = v_poll.id and v.user_id = v_yo),
    'options',     (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'ordinal', o.ordinal, 'label', o.label,
               'vote_count', case when v_revelado then o.vote_count else null end
             ) order by o.ordinal), '[]'::jsonb)
        from public.poll_options o
       where o.poll_id = v_poll.id
    )
  );
end;
$$;

revoke all on function public.encuesta_siguiente(text) from public, anon;
revoke all on function public.encuesta_resultados(uuid) from public, anon;
grant execute on function public.encuesta_siguiente(text)  to authenticated, service_role;
grant execute on function public.encuesta_resultados(uuid) to authenticated, service_role;

-- ============================================================================
-- 8 · REPOSICIÓN DEL BANCO
--
-- Regla: siempre al menos `p_minimo` encuestas activas por idioma, y ninguna
-- del banco con más de `p_max_dias`. Una encuesta caducada en el feed es peor
-- que ninguna encuesta.
--
-- Va entera en una función y no en TypeScript por dos razones:
--   1. Atomicidad. Cerrar las gastadas y activar las nuevas en la misma
--      transacción evita el hueco en el que el feed se queda sin encuestas.
--   2. Carrera. Dos disparos simultáneos del cron chocan en
--      `uq_polls_bank_key` y el segundo no duplica nada; con la lógica repartida
--      entre app y base, la ventana entre el `select` y el `insert` la abre la
--      propia app.
--
-- `service_role` y NADIE MÁS: inserta con el `author_id` del perfil de sistema,
-- que es justo lo que `polls_insert_own` prohíbe a una persona.
-- ============================================================================

create or replace function public.reponer_encuestas(
  p_idioma   text default 'es',
  p_minimo   integer default 3,
  p_max_dias integer default 14
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_autor     constant uuid := '0da12a00-0000-4000-8000-000000000009';
  v_idioma    text    := coalesce(nullif(p_idioma, ''), 'es');
  v_minimo    integer := greatest(0, least(coalesce(p_minimo, 3), 20));
  v_max_dias  integer := greatest(1, least(coalesce(p_max_dias, 14), 365));
  v_cerradas  integer := 0;
  v_activadas integer := 0;
  v_activas   integer;
  v_audiencia bigint;
  v_banco     public.poll_bank%rowtype;
  v_nueva     uuid;
  v_i         integer;
begin
  -- Audiencia estimada a partir de las estadísticas del planificador y NO de un
  -- `count(*) from profiles`: esto se ejecuta a diario y `profiles` crece sin
  -- techo. Un valor aproximado es de sobra para decidir "esta pregunta ya la ha
  -- visto casi todo el mundo".
  select greatest(coalesce(c.reltuples, 0)::bigint, 1) into v_audiencia
    from pg_catalog.pg_class c where c.oid = 'public.profiles'::regclass;

  -- ── Cerrar las gastadas (solo las del banco: las de personas no se rotan) ──
  with cerradas as (
    update public.polls p
       set state = 'hidden'
     where p.state = 'active'
       and p.origin = 'banco'
       and p.language = v_idioma
       and (
         p.created_at < now() - make_interval(days => v_max_dias)
         or p.total_votes::numeric / v_audiencia >= 0.55
       )
    returning 1
  )
  select count(*) into v_cerradas from cerradas;

  select count(*) into v_activas
    from public.polls p
   where p.state = 'active' and p.origin = 'banco' and p.language = v_idioma;

  -- ── Activar hasta llegar al mínimo ────────────────────────────────────────
  while v_activas < v_minimo loop
    select b.* into v_banco
      from public.poll_bank b
     where b.enabled
       and b.language = v_idioma
       and not exists (select 1 from public.polls p where p.bank_key = b.key)
     order by b.times_used, b.key
     limit 1;

    -- Banco agotado: se devuelve lo hecho hasta aquí SIN error. Un cron que
    -- falla por quedarse sin preguntas es un cron que alguien silencia.
    exit when not found;

    -- `returning ... into` NO toca la variable si el ON CONFLICT no insertó
    -- nada. Sin este reset, la vuelta siguiente del bucle vería el id de la
    -- encuesta anterior y le colgaría opciones duplicadas.
    v_nueva := null;

    insert into public.polls (author_id, question, origin, bank_key, language, state)
    values (v_autor, v_banco.question, 'banco', v_banco.key, v_banco.language, 'active')
    on conflict (bank_key) where bank_key is not null do nothing
    returning id into v_nueva;

    -- Otra reposición simultánea se adelantó con esta misma clave. No es un
    -- error: se recuenta y se vuelve a intentar con la siguiente.
    if v_nueva is null then
      select count(*) into v_activas
        from public.polls p
       where p.state = 'active' and p.origin = 'banco' and p.language = v_idioma;
      continue;
    end if;

    v_i := 0;
    while v_i < array_length(v_banco.options, 1) loop
      insert into public.poll_options (poll_id, ordinal, label)
      values (v_nueva, v_i, v_banco.options[v_i + 1]);
      v_i := v_i + 1;
    end loop;

    update public.poll_bank
       set times_used = times_used + 1, last_used_at = now()
     where key = v_banco.key;

    v_activadas := v_activadas + 1;
    v_activas   := v_activas + 1;
  end loop;

  return jsonb_build_object('activadas', v_activadas, 'cerradas', v_cerradas);
end;
$$;

revoke all on function public.reponer_encuestas(text, integer, integer) from public, anon, authenticated;
grant execute on function public.reponer_encuestas(text, integer, integer) to service_role;

-- ============================================================================
-- 9 · SEMILLA DEL BANCO
--
-- Suelo mínimo escrito a mano. Tres reglas al redactarlas:
--   · Ninguna pregunta pide un diagnóstico ni un dato clínico.
--   · Ninguna opción es un juicio ("lo llevo fatal" no es una opción; "me
--     cuesta" sí): la persona está eligiendo cómo describirse a sí misma.
--   · Todas admiten una respuesta honesta que no sea la peor ni la mejor.
--
-- `on conflict do nothing` para que reaplicar la migración no pise las
-- estadísticas de uso ni reactive una pregunta que se retiró en producción.
-- ============================================================================

insert into public.poll_bank (key, question, options, topic, language) values
  ('animo_semana',      '¿Cómo ha ido tu semana?',
   array['Mejor de lo que esperaba', 'Normal', 'Cuesta arriba', 'No sabría decir'], 'animo', 'es'),
  ('dormir',            '¿Estás durmiendo lo que necesitas?',
   array['Sí, bastante bien', 'A ratos', 'Casi nunca'], 'sueno', 'es'),
  ('pedir_ayuda',       'Cuando lo pasas mal, ¿te cuesta pedir ayuda?',
   array['Mucho', 'Depende de a quién', 'Cada vez menos'], 'apoyo', 'es'),
  ('soledad',           '¿Con qué frecuencia te sientes solo o sola?',
   array['Casi siempre', 'A veces', 'Casi nunca'], 'soledad', 'es'),
  ('hablar_de_esto',    '¿Hay alguien en tu vida con quien puedas hablar de esto?',
   array['Sí', 'Alguien, pero no del todo', 'Ahora mismo no'], 'apoyo', 'es'),
  ('descanso_real',     '¿Cuándo fue la última vez que descansaste de verdad?',
   array['Esta semana', 'Este mes', 'Ni me acuerdo'], 'autocuidado', 'es'),
  ('comparacion',       '¿Te comparas con lo que ves de los demás?',
   array['Constantemente', 'A veces', 'Ya casi no'], 'autoestima', 'es'),
  ('algo_bueno',        '¿Ha pasado algo bueno hoy, aunque sea pequeño?',
   array['Sí', 'Creo que sí', 'Hoy no'], 'gratitud', 'es'),
  ('week_check',        'How has your week been?',
   array['Better than expected', 'About normal', 'Uphill', 'Hard to say'], 'animo', 'en'),
  ('asking_for_help',   'When things get hard, is it difficult to ask for help?',
   array['Very', 'Depends who', 'Less than it used to be'], 'apoyo', 'en')
on conflict (key) do nothing;
