-- ============================================================================
-- Darma · pgTAP · PRIVILEGIOS DE COLUMNA
--
-- RLS decide QUÉ FILAS; solo el privilegio de columna decide QUÉ COLUMNAS. Son
-- dos mecanismos distintos y la suite de integración (rls.integracion.ts) solo
-- puede observar el EFECTO combinado desde fuera. Aquí se comprueba el
-- mecanismo directamente contra el catálogo, que es lo único que detecta que
-- alguien añadió una columna a un `grant update (...)` en una migración nueva.
--
-- Ejecutar con:  supabase test db
-- ============================================================================

begin;
-- `no_plan()` en vez de `plan(N)`: un contador de tests a mano se desactualiza
-- en cuanto alguien añade una comprobación, y el fallo resultante («planned N
-- but ran M») distrae del hallazgo real.
select * from no_plan();

-- ── profiles · el ataque nº1: escribirse karma ──────────────────────────────
-- `profiles_update_own` permite editar la fila propia. Lo único que impide
-- `karma_reputation = 999999` es este privilegio de columna.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'karma_reputation', 'UPDATE'),
  'authenticated NO puede escribir profiles.karma_reputation'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'karma_spendable', 'UPDATE'),
  'authenticated NO puede escribir profiles.karma_spendable'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'crystals', 'UPDATE'),
  'authenticated NO puede escribir profiles.crystals'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'listen_credits', 'UPDATE'),
  'authenticated NO puede escribir profiles.listen_credits'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'shadow_banned', 'UPDATE'),
  'authenticated NO puede escribir profiles.shadow_banned'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'banned_until', 'UPDATE'),
  'authenticated NO puede escribir profiles.banned_until'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'posts_published', 'UPDATE'),
  'authenticated NO puede escribir profiles.posts_published'
);

-- Lo que sí debe poder editarse (si esto se rompe, la app deja de funcionar).
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'alias', 'UPDATE'),
  'authenticated SÍ puede editar su alias'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'availability', 'UPDATE'),
  'authenticated SÍ puede editar su disponibilidad'
);

-- ── REGRESIÓN R5 · fuga de saldo por privilegio de SELECT ───────────────────
-- `profiles_read ... using (true)` deja ver todas las FILAS (correcto: los
-- perfiles son anónimos), pero RLS no sabe nada de columnas. Sin este recorte,
-- `GET /rest/v1/profiles?select=karma_spendable,crystals` devolvía el saldo de
-- cualquiera y rompía CONTRATOS §2.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'karma_spendable', 'SELECT'),
  'R5 · authenticated NO puede LEER profiles.karma_spendable'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'crystals', 'SELECT'),
  'R5 · authenticated NO puede LEER profiles.crystals'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'listen_credits', 'SELECT'),
  'R5 · authenticated NO puede LEER profiles.listen_credits'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'shadow_banned', 'SELECT'),
  'R5 · authenticated NO puede LEER profiles.shadow_banned (si lo supiera, se crearía otra cuenta)'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'daily_karma_earned', 'SELECT'),
  'R5 · authenticated NO puede LEER profiles.daily_karma_earned'
);

-- Los dos contadores que la ficha B05 llamaba «públicos» y el esquema nunca
-- concedió. Se decidió que son PRIVADOS (0223) y se comprueba aquí porque el
-- porqué no es evidente: `posts_published` es cuántas veces alguien ha pedido
-- ayuda, y `listens_given` es la misma señal que el tablero de B06 pero SIN el
-- techo diario que impide que acompañar deprisa rente más que acompañar bien.
-- Un `grant` sobre cualquiera de las dos revierte una decisión; que salte.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'listens_given', 'SELECT'),
  'listens_given no es legible por authenticated (0223: privado, no olvidado)'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'posts_published', 'SELECT'),
  'posts_published no es legible por authenticated (0223: privado, no olvidado)'
);
select ok(
  not has_column_privilege('anon', 'public.profiles', 'listens_given', 'SELECT'),
  'listens_given tampoco sin sesion'
);

-- Lo público es exactamente PerfilPublico (CONTRATOS §2).
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'alias', 'SELECT'),
  'authenticated SÍ puede leer profiles.alias'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'karma_reputation', 'SELECT'),
  'authenticated SÍ puede leer profiles.karma_reputation (es la reputación pública)'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'level', 'SELECT'),
  'authenticated SÍ puede leer profiles.level'
);

-- ── comments · LA COLUMNA MÁS PELIGROSA DE LA APP ───────────────────────────
-- Si `is_validated` entrara en el `grant update`, cualquiera con la anon key
-- podría auto-validarse comentarios, disparar trg_comments_validated, ganar
-- karma y saltarse la reciprocidad entera.
select ok(
  not has_column_privilege('authenticated', 'public.comments', 'is_validated', 'UPDATE'),
  '⚠ comments.is_validated NO es escribible por authenticated (auto-validación = farmeo total)'
);
select ok(
  not has_column_privilege('authenticated', 'public.comments', 'is_helpful', 'UPDATE'),
  'comments.is_helpful NO es escribible por authenticated'
);
select ok(
  not has_column_privilege('authenticated', 'public.comments', 'quality_score', 'UPDATE'),
  'comments.quality_score NO es escribible por authenticated'
);
select ok(
  not has_column_privilege('authenticated', 'public.comments', 'upvote_count', 'UPDATE'),
  'comments.upvote_count NO es escribible por authenticated'
);
select ok(
  has_column_privilege('authenticated', 'public.comments', 'body', 'UPDATE'),
  'comments.body SÍ es editable por su autor'
);

-- ── posts · contadores, score, riesgo y boost fuera de alcance ──────────────
select ok(
  not has_column_privilege('authenticated', 'public.posts', 'upvote_count', 'UPDATE'),
  'posts.upvote_count NO es escribible'
);
select ok(
  not has_column_privilege('authenticated', 'public.posts', 'reply_count', 'UPDATE'),
  'posts.reply_count NO es escribible'
);
select ok(
  not has_column_privilege('authenticated', 'public.posts', 'hot_score', 'UPDATE'),
  'posts.hot_score NO es escribible'
);
select ok(
  not has_column_privilege('authenticated', 'public.posts', 'risk', 'UPDATE'),
  'posts.risk NO es escribible (la crisis no se puede desmarcar desde el cliente)'
);
select ok(
  not has_column_privilege('authenticated', 'public.posts', 'boost_until', 'UPDATE'),
  'posts.boost_until NO es escribible (el boost se paga, no se declara)'
);

-- ── refugios ────────────────────────────────────────────────────────────────
select ok(
  not has_column_privilege('authenticated', 'public.refuges', 'member_count', 'UPDATE'),
  'refuges.member_count NO es escribible ni por el creador'
);
select ok(
  not has_column_privilege('authenticated', 'public.refuges', 'message_count', 'UPDATE'),
  'refuges.message_count NO es escribible'
);
select ok(
  not has_column_privilege('authenticated', 'public.refuges', 'last_message_at', 'UPDATE'),
  'refuges.last_message_at NO es escribible'
);
select ok(
  has_column_privilege('authenticated', 'public.refuges', 'archived_at', 'UPDATE'),
  'refuges.archived_at SÍ es editable (por el creador, vía política)'
);

select ok(
  not has_column_privilege('authenticated', 'public.refuge_members', 'is_host', 'UPDATE'),
  'refuge_members.is_host NO es auto-concedible'
);

-- El ciphertext es INMUTABLE: editar un mensaje ya leído reescribiría el
-- recuerdo que la otra persona tiene de la conversación.
select ok(
  not has_column_privilege('authenticated', 'public.refuge_messages', 'ciphertext', 'UPDATE'),
  'refuge_messages.ciphertext es INMUTABLE'
);
select ok(
  not has_table_privilege('authenticated', 'public.refuge_messages', 'DELETE'),
  'refuge_messages: DELETE revocado (borrar rompería el hilo de la otra persona)'
);
select ok(
  has_column_privilege('authenticated', 'public.refuge_messages', 'state', 'UPDATE'),
  'refuge_messages.state SÍ es editable (retirar el propio mensaje)'
);

-- ── kindred y blocks ────────────────────────────────────────────────────────
select ok(
  has_column_privilege('authenticated', 'public.kindred', 'note', 'UPDATE'),
  'kindred.note SÍ es editable'
);
select ok(
  not has_column_privilege('authenticated', 'public.kindred', 'kindred_id', 'UPDATE'),
  'kindred.kindred_id NO es editable'
);
select ok(
  not has_table_privilege('authenticated', 'public.blocks', 'UPDATE'),
  'blocks: UPDATE revocado entero (un bloqueo se quita y se vuelve a poner)'
);

-- ── REGRESIONES R2 y R3 · farmeo de karma por content_views ─────────────────
-- R2: `grant update (watched_seconds, completed, completed_at)` era karma
-- gratis — un PATCH con completed = true sobre 120 contenidos distintos agotaba
-- el tope diario entero sin ver un segundo de vídeo. La PK solo impide repetir
-- el MISMO contenido; no impide barrer el catálogo.
select ok(
  not has_column_privilege('authenticated', 'public.content_views', 'completed', 'UPDATE'),
  'R2 · content_views.completed NO es escribible (era karma gratis vía PATCH)'
);
select ok(
  not has_column_privilege('authenticated', 'public.content_views', 'watched_seconds', 'UPDATE'),
  'R2 · content_views.watched_seconds NO es escribible'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_views', 'DELETE'),
  'content_views: DELETE revocado'
);
-- Afirmaba INSERT a nivel de TABLA. 0004 lo revocó justo para cerrar R3 —nacer
-- ya `completed = true` era karma gratis— y lo sustituyó por un grant de
-- COLUMNA sobre `(content_id, user_id)`. `has_table_privilege` devuelve false
-- ante un grant por columna, así que la prueba llevaba en rojo desde entonces
-- afirmando algo MÁS DÉBIL de lo que el esquema hace: pedía que la puerta
-- estuviera abierta del todo cuando lo correcto es que solo pasen dos columnas.
select ok(
  not has_table_privilege('authenticated', 'public.content_views', 'INSERT'),
  'content_views: INSERT de tabla revocado (R3: nacer completado era karma gratis)'
);
select ok(
  has_column_privilege('authenticated', 'public.content_views', 'content_id', 'INSERT'),
  'content_views: INSERT permitido SOLO por columna — content_id'
);
select ok(
  has_column_privilege('authenticated', 'public.content_views', 'user_id', 'INSERT'),
  'content_views: INSERT permitido SOLO por columna — user_id'
);
select ok(
  not has_column_privilege('authenticated', 'public.content_views', 'completed', 'INSERT'),
  'content_views: `completed` NO es insertable (es la mitad de R3 que se olvida)'
);

-- ── Encuestas · el voto es definitivo ───────────────────────────────────────
select ok(
  not has_table_privilege('authenticated', 'public.poll_votes', 'UPDATE'),
  'poll_votes: UPDATE revocado (no se cambia de opción esquivando la PK)'
);
select ok(
  not has_table_privilege('authenticated', 'public.poll_votes', 'DELETE'),
  'poll_votes: DELETE revocado (no se vota, se borra y se vuelve a votar)'
);
select ok(
  not has_column_privilege('authenticated', 'public.polls', 'total_votes', 'UPDATE'),
  'polls.total_votes NO es escribible'
);
select ok(
  not has_table_privilege('authenticated', 'public.poll_options', 'UPDATE'),
  'poll_options: UPDATE revocado (incluye vote_count)'
);

-- ── Economía · el cliente no escribe NADA ───────────────────────────────────
select ok(
  not has_table_privilege('authenticated', 'public.crystal_ledger', 'INSERT'),
  'crystal_ledger: INSERT revocado'
);
select ok(
  not has_table_privilege('authenticated', 'public.crystal_ledger', 'UPDATE'),
  'crystal_ledger: UPDATE revocado'
);
select ok(
  not has_table_privilege('authenticated', 'public.boosts', 'INSERT'),
  'boosts: INSERT revocado (el cobro y el registro van en la misma transacción del servidor)'
);
select ok(
  not has_table_privilege('authenticated', 'public.gifts', 'INSERT'),
  'gifts: INSERT revocado'
);
select ok(
  not has_table_privilege('authenticated', 'public.karma_events', 'INSERT'),
  'karma_events: INSERT revocado (ledger append-only escrito solo por award_karma)'
);
select ok(
  not has_table_privilege('authenticated', 'public.karma_weights', 'UPDATE'),
  'karma_weights: UPDATE revocado (pública para leer, intocable para escribir)'
);
select ok(
  has_table_privilege('authenticated', 'public.karma_weights', 'SELECT'),
  'karma_weights: SELECT permitido — la economía es auditable por diseño'
);
select ok(
  has_table_privilege('anon', 'public.karma_weights', 'SELECT'),
  'karma_weights: legible incluso sin sesión'
);

-- ── Infraestructura opaca al cliente ────────────────────────────────────────
select ok(
  not has_table_privilege('authenticated', 'public.identity_vault', 'SELECT'),
  '⚠ identity_vault: SELECT revocado (el único vínculo con la persona real)'
);
select ok(
  not has_table_privilege('anon', 'public.identity_vault', 'SELECT'),
  'identity_vault: tampoco para anon'
);
select ok(
  not has_table_privilege('authenticated', 'public.moderation_flags', 'SELECT'),
  'moderation_flags: SELECT revocado (quién reportó a quién)'
);
select ok(
  not has_table_privilege('authenticated', 'public.crisis_events', 'SELECT'),
  'crisis_events: SELECT revocado (quién está en la cola de riesgo)'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limits', 'SELECT'),
  'rate_limits: SELECT revocado'
);

-- ── B15 · NINGUNA `security definer` AL ALCANCE DE LA ANON KEY ──────────────
-- Este bloque no vigila una columna: vigila un ERROR DE CREENCIA, que es lo que
-- se repite. 0222_1 escribió `revoke all ... from public` convencida de que eso
-- alcanzaba a `anon` «porque hereda de PUBLIC». En Supabase no hereda: el
-- proyecto trae `alter default privileges ... grant execute on functions to
-- anon, authenticated, service_role`, así que cada función nueva de `public`
-- nace con una línea `anon=X` PROPIA, y un revoke a PUBLIC retira otra distinta.
-- La migración quedó diciendo una cosa y el catálogo otra, y dos funciones
-- `security definer` —código que corre con los privilegios del dueño y sin
-- RLS— acabaron invocables con la anon key. 0225_1 las cerró nombrando el rol.
--
-- Por eso esto se comprueba BARRIENDO el catálogo entero y no función por
-- función: escribir el caso de `previos_del_autor` a mano habría cazado la de
-- ayer y ninguna de las de mañana, que es exactamente lo que pasó. Cualquier
-- migración futura que cree una definer y se olvide de nombrar a `anon` sale
-- aquí, con su firma, sin que nadie tenga que acordarse de añadir una línea.
--
-- La lista blanca nace VACÍA y esa es la postura: si algún día una definer debe
-- ser alcanzable sin sesión, que el coste sea escribir su firma aquí y el porqué
-- al lado, no relajar la regla.
select is_empty(
  $$
    select p.oid::regprocedure::text as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       -- Lista blanca (vacía a propósito). Firmas exactas, como las imprime
       -- `oid::regprocedure`: 'mi_funcion(uuid, integer)'.
       and p.oid::regprocedure::text <> all (array[]::text[])
  $$,
  'B15 · ninguna función SECURITY DEFINER de public es ejecutable por anon'
);

-- El barrido de arriba pasa solo con no encontrar nada, y «no encuentro nada»
-- es también lo que diría si el `where` estuviera mal escrito o si el esquema
-- llegara vacío. Esta línea le pone suelo: que haya definers que recorrer.
select cmp_ok(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  '>=', 50,
  'B15 · el barrido anterior recorre de verdad las definer de public (no es un conjunto vacío)'
);

select * from finish();
rollback;
