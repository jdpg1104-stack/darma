-- ============================================================================
-- Darma · 0121_1 · B12 · Economía premium: cristales, boosts, regalos
--
-- Rango 0121–0129 (PARALELO.md §3). La ficha B12 decía `0012_b12_economia.sql`,
-- pero ese número pertenece a los cimientos y ya está ocupado; manda PARALELO.
--
-- ── QUÉ AÑADE Y POR QUÉ ─────────────────────────────────────────────────────
-- 0002 dejó las TABLAS de la economía (crystal_ledger, boosts, gifts) y el
-- gasto atómico (spend_crystals). Lo que faltaba es lo que no se puede hacer
-- desde la app sin abrir un agujero: **cobrar y registrar en la MISMA
-- transacción**. `boosts` y `gifts` no tienen política de INSERT justamente
-- para forzar que pase por aquí.
--
-- Las cuatro funciones nuevas son `security definer` y están concedidas SOLO a
-- `service_role` (salvo las dos de lectura del propio saldo, que van a
-- `authenticated`). Ninguna acepta una cantidad de cristales decidida por el
-- cliente: `acreditar_compra` recibe el delta que el SERVIDOR resolvió contra
-- el catálogo de `lib/billing/catalogo.ts`, y la RPC solo la puede llamar el
-- service_role.
--
-- ── 🔴 LÍNEA ROJA ───────────────────────────────────────────────────────────
-- Ninguna función de este archivo llama a `award_karma()`, ni escribe en
-- `profiles.karma_reputation`, ni SUMA a `profiles.karma_spendable`. El dinero
-- entra por `profiles.crystals`, que es una moneda separada precisamente para
-- que la conversión no sea expresable. `impulsar_post` resuelve, en este orden:
-- cupo gratuito → karma → cristales. El dinero es el ÚLTIMO recurso.
-- El bono de feed (`lib/feedRanking.ts`, +1.0 aditivo) es idéntico se pague
-- como se pague, y ninguna de estas funciones toca `crisis_events`.
--
-- ── UNA POLÍTICA RLS NUEVA: NINGUNA ─────────────────────────────────────────
-- Y las que se tocan no llevan subconsulta (regla de 0005: una política que
-- consulta otra tabla se rompe en silencio el día que se revoca una columna de
-- esa tabla). Aquí solo se recortan PRIVILEGIOS DE COLUMNA, que es la mitad que
-- RLS no cubre.
-- ============================================================================

-- ============================================================================
-- 1 · CORRECCIÓN DE UN CHECK QUE HACE INEXPRESABLE EL BOOST GRATUITO
--
-- ⚠️ ESTO NO ES ADITIVO Y MERECE REVISIÓN (anotado en ESTADO.md y PEDIDOS.md).
--
-- `0002` declaró `boosts.amount integer not null check (amount > 0)`, pero la
-- ficha B12 §7 exige que el boost del cupo gratuito se registre con
-- `currency: 'karma', amount: 0`. Las dos cosas no pueden ser verdad a la vez.
--
-- Alternativas descartadas:
--   (a) NO insertar fila para el boost gratuito. Rompe dos cosas: el techo de
--       3/día de `trg_boosts_daily_limit` dejaría de contarlos (boosts gratis
--       ilimitados) y la transparencia pública de `boosts_read` dejaría de
--       poder decir que un post está impulsado.
--   (b) Registrarlo con `amount = 50` y una columna `es_gratis`. Es mentir en
--       la columna que dice cuánto pagó la persona; el histórico económico
--       tiene que poder auditarse leyendo la tabla, no cruzando dos columnas.
--
-- Se RELAJA el CHECK a `>= 0`. Es una relajación, no un cambio de forma: nada
-- que fuera válido deja de serlo, y ningún otro bloque escribe en `boosts`
-- (no hay política de INSERT y los privilegios están revocados para el
-- cliente). `amount = 0` significa exactamente «esto no lo pagó nadie».
-- ============================================================================
alter table public.boosts drop constraint if exists boosts_amount_check;
alter table public.boosts
  add constraint boosts_amount_check check (amount >= 0);

comment on column public.boosts.amount is
  'Lo que PAGÓ la persona, en la moneda de `currency`. 0 = cupo gratuito diario (financiado con karma de la comunidad). Ver 0121_1 §1: el check original era > 0 y hacía inexpresable el cupo gratuito que exige la línea roja del producto.';

-- ============================================================================
-- 2 · IDEMPOTENCIA DE CLIENTE EN BOOST Y REGALO
--
-- Un doble toque en un móvil con red mala no puede cobrar dos veces. El ledger
-- de compras ya tiene `uq_crystal_ledger_external` para los webhooks de la
-- store; boost y regalo necesitan su propia clave, y la manda el cliente.
--
-- Único PARCIAL `where ... is not null`: las filas sin clave (backfills,
-- concesiones internas) no colisionan entre sí. Va con `user_id` / `sender_id`
-- dentro del índice para que la clave de una persona no bloquee la de otra:
-- el cliente genera un uuid, pero no se le concede autoridad sobre el espacio
-- de nombres global.
-- ============================================================================
alter table public.boosts add column if not exists idempotency_key text;
alter table public.gifts  add column if not exists idempotency_key text;

create unique index if not exists uq_boosts_idem
  on public.boosts (user_id, idempotency_key) where idempotency_key is not null;

create unique index if not exists uq_gifts_idem
  on public.gifts (sender_id, idempotency_key) where idempotency_key is not null;

-- ============================================================================
-- 3 · PRIVILEGIOS DE COLUMNA — LO QUE RLS NO CUBRE
--
-- `crystal_ledger_read_own` (0002) deja leer la FILA ENTERA al dueño. La fila
-- entera incluye `raw_receipt`, que es el recibo crudo de Apple o Google: lleva
-- identificadores de la cuenta de la tienda (`appAccountToken`, `originalId`,
-- correo de la Apple ID en algunos formatos). Es exactamente el tipo de dato
-- que CONTRATOS §2 declara inexistente en Darma, y hoy un cliente con la anon
-- key lo pide con `?select=raw_receipt` y lo recibe.
--
-- La ficha pedía anotarlo como PEDIDO. Se anota igualmente, pero se cierra aquí
-- porque la tabla es de este bloque y dejar un dato de identidad legible
-- mientras se tramita el pedido no es una opción.
-- ============================================================================
revoke select on public.crystal_ledger from anon, authenticated;
grant  select (id, user_id, delta, reason, source, created_at)
       on public.crystal_ledger to authenticated;

-- `boosts_read using (true)` publica el boost a toda la red, y eso es
-- deliberado (un post impulsado se marca como tal, igual que un anuncio). Pero
-- «este post está impulsado» no es lo mismo que «esta persona pagó 50 cristales
-- por él»: `user_id`, `currency` y `amount` convierten la transparencia del
-- post en el historial de gasto de una persona anónima. Fuera.
revoke select on public.boosts from anon, authenticated;
grant  select (id, post_id, expires_at, created_at) on public.boosts to authenticated;

-- Los regalos sí los ven las dos partes enteros (es el reconocimiento visible
-- que se compró), menos la clave de idempotencia, que es fontanería.
revoke select on public.gifts from anon, authenticated;
grant  select (id, sender_id, recipient_id, ref_type, ref_id, gift_kind,
               cost_crystals, fee_crystals, net_crystals, message, created_at)
       on public.gifts to authenticated;

-- ============================================================================
-- 4 · acreditar_compra — LA ÚNICA VÍA POR LA QUE ENTRAN CRISTALES COMPRADOS
--
-- El patrón entero de la idempotencia frente a webhooks está en tres líneas:
--
--     insert ... on conflict (external_id) where external_id is not null
--       do nothing returning id
--
-- Si NO devuelve fila, la notificación era un reintento — Apple y Google
-- reenvían durante DÍAS ante un 5xx o un timeout — y entonces `profiles.crystals`
-- NO se toca. Actualizar el caché fuera del `if found` es, literalmente, cómo
-- se duplican los cristales de un reintento.
--
-- `p_delta` lo resuelve el SERVIDOR contra `lib/billing/catalogo.ts` a partir
-- del SKU; el cliente nunca manda una cantidad. Esta función solo la puede
-- llamar `service_role`, así que no hay superficie desde el navegador.
-- ============================================================================
create or replace function public.acreditar_compra(
  p_user        uuid,
  p_external_id text,
  p_delta       integer,
  p_reason      text,
  p_source      text,
  p_receipt     jsonb default null
) returns table (acreditado boolean, saldo integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      bigint;
  v_saldo   integer;
begin
  if p_delta <= 0 then
    raise exception 'importe inválido' using errcode = 'DA006';
  end if;
  if p_external_id is null or length(p_external_id) = 0 then
    -- Sin external_id no hay idempotencia posible, y una compra sin
    -- idempotencia es una compra que se acredita dos veces. Fail-closed.
    raise exception 'compra sin identificador externo' using errcode = 'DA006';
  end if;
  if p_source not in ('iap_apple', 'iap_google') then
    raise exception 'origen inválido' using errcode = 'DA006';
  end if;

  insert into public.crystal_ledger (user_id, delta, reason, source, external_id, raw_receipt)
  values (p_user, p_delta, p_reason, p_source, p_external_id, p_receipt)
  on conflict (external_id) where external_id is not null do nothing
  returning id into v_id;

  if v_id is not null then
    -- SOLO dentro de esta rama. Ver la cabecera.
    update public.profiles
       set crystals = crystals + p_delta
     where id = p_user
    returning crystals into v_saldo;

    if v_saldo is null then
      raise exception 'perfil inexistente' using errcode = 'DA002';
    end if;

    return query select true, v_saldo;
  else
    select p.crystals into v_saldo from public.profiles p where p.id = p_user;
    return query select false, coalesce(v_saldo, 0);
  end if;
end;
$$;

revoke all on function public.acreditar_compra(uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.acreditar_compra(uuid, text, integer, text, text, jsonb)
  to service_role;

-- ============================================================================
-- 5 · impulsar_post — COBRO Y REGISTRO EN LA MISMA TRANSACCIÓN
--
-- Orden de resolución del medio de pago (ficha B12 §7), y no es negociable:
--   1. cupo gratuito del día     → amount 0. Lo financia el karma que la
--                                  persona ya ganó escuchando; el dinero NUNCA
--                                  es la barrera para ser escuchado.
--   2. karma gastable (50)       → spend_karma()
--   3. cristales                 → spend_crystals()
--
-- ATOMICIDAD: todo ocurre dentro de esta función, luego dentro de una sola
-- transacción. Si `trg_boosts_daily_limit` rechaza el cuarto boost del día, el
-- `raise` revierta también el cobro. Un usuario al que se le cobran 50 de karma
-- por un boost que nunca se aplicó no vuelve. Hay un test que lo comprueba
-- leyendo el saldo antes y después.
--
-- LÍNEA ROJA: un post `hidden`/`removed` o con riesgo `high`/`critical` NO se
-- puede impulsar, y se rechaza ANTES de cobrar nada. Promocionar la angustia de
-- alguien sería convertirla en inventario (lib/feedRanking.ts, «LÍNEA ROJA DEL
-- BOOST»). El boost tampoco toca `crisis_events`: la cola de crisis se ordena
-- por `created_at` y por nada más.
-- ============================================================================
create or replace function public.impulsar_post(
  p_user  uuid,
  p_post  uuid,
  p_medio text default null,     -- null = automático; 'gratis'|'karma'|'cristales'
  p_idem  text default null
) returns table (
  aplicado             boolean,
  medio                text,
  expira_en            timestamptz,
  cupo_gratis_restante integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- SSOT en SQL. `lib/billing/boosts.ts` los replica y hay un test que lee
  -- este archivo y compara literal a literal (mismo patrón que
  -- lib/economySync.test.ts para los pesos de karma).
  v_cupo_gratis  constant integer := 1;
  v_horas        constant integer := 12;
  v_max_dia      constant integer := 3;
  v_coste_karma  constant integer := 50;
  v_coste_crist  constant integer := 50;

  v_state       public.entry_state;
  v_risk        public.risk_level;
  v_autor       uuid;
  v_gratis_hoy  integer;
  v_restante    integer;
  v_hoy         integer;
  v_medio       text;
  v_amount      integer;
  v_currency    public.boost_currency;
  v_expira      timestamptz;
  v_ok          boolean;
  v_prev        boosts%rowtype;
begin
  -- ── 0. Idempotencia de cliente ────────────────────────────────────────────
  -- Un doble toque devuelve EL MISMO boost, no uno nuevo. Se resuelve antes de
  -- mirar nada más para que el reintento no consuma cupo ni cuente al techo.
  if p_idem is not null then
    select * into v_prev from public.boosts b
     where b.user_id = p_user and b.idempotency_key = p_idem;
    if found then
      select count(*) into v_gratis_hoy from public.boosts b
       where b.user_id = p_user and b.amount = 0
         and b.created_at >= date_trunc('day', now());
      return query select
        true,
        case when v_prev.amount = 0 then 'gratis' else v_prev.currency::text end,
        v_prev.expires_at,
        greatest(0, v_cupo_gratis - v_gratis_hoy);
      return;
    end if;
  end if;

  -- ── 1. ¿Es un post impulsable? ────────────────────────────────────────────
  select p.state, p.risk, p.author_id into v_state, v_risk, v_autor
    from public.posts p where p.id = p_post;

  if not found then
    raise exception 'post inexistente' using errcode = 'DA002';
  end if;
  if v_state <> 'active' then
    raise exception 'post no impulsable' using errcode = 'DA004';
  end if;
  if v_risk in ('high', 'critical') then
    -- Ver la cabecera. Y no se cobra: se rechaza antes.
    raise exception 'post no impulsable' using errcode = 'DA004';
  end if;

  -- ── 2. Techo diario ───────────────────────────────────────────────────────
  -- Se comprueba aquí para poder devolver un error limpio, pero la AUTORIDAD
  -- sigue siendo `trg_boosts_daily_limit`: si dos peticiones simultáneas pasan
  -- este count, el trigger rechaza la segunda y revierte su cobro.
  select count(*) into v_hoy from public.boosts b
   where b.user_id = p_user and b.created_at >= date_trunc('day', now());

  if v_hoy >= v_max_dia then
    raise exception 'límite de % boosts por día alcanzado', v_max_dia
      using errcode = 'DA005';
  end if;

  select count(*) into v_gratis_hoy from public.boosts b
   where b.user_id = p_user and b.amount = 0
     and b.created_at >= date_trunc('day', now());
  v_restante := greatest(0, v_cupo_gratis - v_gratis_hoy);

  -- ── 3. Medio de pago ──────────────────────────────────────────────────────
  if p_medio is null then
    -- Automático: gratis → karma → cristales. El dinero, el último.
    if v_restante > 0 then
      v_medio := 'gratis';
    else
      v_ok := public.spend_karma(p_user, v_coste_karma, 'boost');
      if v_ok then
        v_medio := 'karma';
      else
        v_ok := public.spend_crystals(p_user, v_coste_crist, 'boost');
        if not v_ok then
          raise exception 'saldo insuficiente' using errcode = 'DA001';
        end if;
        v_medio := 'cristales';
      end if;
    end if;
  elsif p_medio = 'gratis' then
    if v_restante <= 0 then
      raise exception 'sin cupo gratuito' using errcode = 'DA001';
    end if;
    v_medio := 'gratis';
  elsif p_medio = 'karma' then
    if not public.spend_karma(p_user, v_coste_karma, 'boost') then
      raise exception 'saldo insuficiente' using errcode = 'DA001';
    end if;
    v_medio := 'karma';
  elsif p_medio = 'cristales' then
    if not public.spend_crystals(p_user, v_coste_crist, 'boost') then
      raise exception 'saldo insuficiente' using errcode = 'DA001';
    end if;
    v_medio := 'cristales';
  else
    raise exception 'medio de pago inválido' using errcode = 'DA006';
  end if;

  if v_medio = 'gratis' then
    v_amount := 0; v_currency := 'karma';
  elsif v_medio = 'karma' then
    v_amount := v_coste_karma; v_currency := 'karma';
  else
    v_amount := v_coste_crist; v_currency := 'crystals';
  end if;

  -- ── 4. Registro + ventana ─────────────────────────────────────────────────
  -- La ventana se ENCADENA: impulsar dos veces suma horas en vez de tirar la
  -- primera compra. `greatest(..., now())` evita que un boost_until viejo y
  -- pasado descuente tiempo del nuevo.
  v_expira := greatest(coalesce(
      (select p.boost_until from public.posts p where p.id = p_post), now()
    ), now()) + make_interval(hours => v_horas);

  insert into public.boosts (post_id, user_id, currency, amount, expires_at, idempotency_key)
  values (p_post, p_user, v_currency, v_amount, v_expira, p_idem);

  -- `boost_until` NO está en el `grant update` de `authenticated` (0004): esta
  -- es la única vía. Por eso la función es definer y no la hace el cliente.
  update public.posts set boost_until = v_expira where id = p_post;

  return query select
    true,
    v_medio,
    v_expira,
    greatest(0, v_cupo_gratis - v_gratis_hoy - (case when v_medio = 'gratis' then 1 else 0 end));
end;
$$;

revoke all on function public.impulsar_post(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.impulsar_post(uuid, uuid, text, text) to service_role;

-- ============================================================================
-- 6 · enviar_regalo — comisión, reparto y las dos puntas del ledger
--
-- `gifts_amounts check (cost = fee + net)` es una restricción del motor: la
-- aritmética no puede crear cristales de la nada aunque la app tenga un bug.
-- El reparto lo calcula el servidor con enteros (`floor` en la comisión, el
-- resto al neto) y lo VERIFICA aquí.
--
-- El regalo NO da karma al receptor. Da su reconocimiento visible en el hilo y
-- sus cristales netos, y nada más. Si diera karma, comprar cristales compraría
-- reputación por interpuesta persona — que es la línea roja con un rodeo.
-- ============================================================================
create or replace function public.enviar_regalo(
  p_sender    uuid,
  p_recipient uuid,
  p_kind      text,
  p_cost      integer,
  p_fee       integer,
  p_net       integer,
  p_ref_type  text default null,
  p_ref_id    uuid default null,
  p_message   text default null,
  p_idem      text default null
) returns table (regalo_id uuid, saldo integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_saldo integer;
  v_prev  gifts%rowtype;
begin
  if p_sender = p_recipient then
    -- `gifts_no_self` lo impediría igual; se adelanta para devolver un código
    -- propio en vez de un check_violation que hay que adivinar por el mensaje.
    raise exception 'regalo a uno mismo' using errcode = 'DA003';
  end if;
  if p_cost <= 0 or p_fee < 0 or p_net < 0 or p_cost <> p_fee + p_net then
    raise exception 'reparto inválido' using errcode = 'DA006';
  end if;

  if p_idem is not null then
    select * into v_prev from public.gifts g
     where g.sender_id = p_sender and g.idempotency_key = p_idem;
    if found then
      select p.crystals into v_saldo from public.profiles p where p.id = p_sender;
      return query select v_prev.id, coalesce(v_saldo, 0);
      return;
    end if;
  end if;

  -- spend_crystals devuelve FALSE cuando falta saldo; no lanza. Ignorar el
  -- booleano es insertar el regalo sin haber cobrado.
  if not public.spend_crystals(p_sender, p_cost, 'gift:' || p_kind) then
    raise exception 'saldo insuficiente' using errcode = 'DA001';
  end if;

  insert into public.gifts (
    sender_id, recipient_id, ref_type, ref_id, gift_kind,
    cost_crystals, fee_crystals, net_crystals, message, idempotency_key
  ) values (
    p_sender, p_recipient, p_ref_type, p_ref_id, p_kind,
    p_cost, p_fee, p_net, p_message, p_idem
  ) returning id into v_id;

  -- La punta receptora: el neto entra como cristales, NUNCA como karma.
  if p_net > 0 then
    update public.profiles set crystals = crystals + p_net where id = p_recipient;
    if not found then
      raise exception 'perfil inexistente' using errcode = 'DA002';
    end if;
    insert into public.crystal_ledger (user_id, delta, reason, source)
    values (p_recipient, p_net, 'gift:' || p_kind, 'gift');
  end if;

  select p.crystals into v_saldo from public.profiles p where p.id = p_sender;
  return query select v_id, coalesce(v_saldo, 0);
end;
$$;

revoke all on function public.enviar_regalo(uuid, uuid, text, integer, integer, integer, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.enviar_regalo(uuid, uuid, text, integer, integer, integer, text, uuid, text, text)
  to service_role;

-- ============================================================================
-- 7 · Lecturas del propio saldo y del propio historial
--
-- Son `security definer` y filtran por `auth.uid()` dentro, igual que
-- `mi_perfil_privado()` de 0001: `authenticated` ya no tiene el privilegio de
-- columna sobre `raw_receipt`/`external_id`, así que no hay consulta directa
-- que los devuelva ni sobre la propia fila.
--
-- Keyset por `id`, que es un bigint monótono. Es la única tabla donde el cursor
-- es un entero interno, y por eso se codifica dentro del cursor opaco y NO se
-- devuelve como campo (CONTRATOS §1: los bigint de ledger no salen de la API).
-- Usa `idx_crystal_ledger_user (user_id, id desc)`.
-- ============================================================================
create or replace function public.mi_historial_cristales(
  p_cursor bigint default null,
  p_limite integer default 20
) returns table (
  id         bigint,
  delta      integer,
  reason     text,
  source     text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.delta, c.reason, c.source, c.created_at
    from public.crystal_ledger c
   where c.user_id = (select auth.uid())
     and (p_cursor is null or c.id < p_cursor)
   order by c.id desc
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

-- El `grant` a `authenticated` NO quita el EXECUTE que PUBLIC (y por tanto
-- `anon`) hereda por defecto. Con `anon`, `auth.uid()` es null y la función
-- devuelve cero filas, así que no filtra nada — pero «no filtra porque el
-- filtro de dentro salva la situación» es exactamente el razonamiento que deja
-- de ser cierto el día que alguien añade un parámetro. Detectado por el linter
-- de Supabase (0028) y cerrado: fail-closed.
revoke all on function public.mi_historial_cristales(bigint, integer) from public, anon;
grant execute on function public.mi_historial_cristales(bigint, integer) to authenticated, service_role;

-- Lo que la UI necesita para ofrecer KARMA ANTES QUE DINERO: cuánto cupo
-- gratuito queda hoy y con qué saldo cuenta la persona. Sin esto la tienda
-- tendría que adivinar y acabaría enseñando el botón de comprar primero.
create or replace function public.mi_cupo_boost()
returns table (
  cupo_gratis_restante integer,
  boosts_hoy           integer,
  karma_spendable      integer,
  crystals             integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    greatest(0, 1 - (
      select count(*)::integer from public.boosts b
       where b.user_id = (select auth.uid()) and b.amount = 0
         and b.created_at >= date_trunc('day', now())
    )),
    (select count(*)::integer from public.boosts b
      where b.user_id = (select auth.uid())
        and b.created_at >= date_trunc('day', now())),
    p.karma_spendable,
    p.crystals
  from public.profiles p
  where p.id = (select auth.uid());
$$;

revoke all on function public.mi_cupo_boost() from public, anon;
grant execute on function public.mi_cupo_boost() to authenticated, service_role;

-- ============================================================================
-- 8 · Boosts vivos de un post (transparencia pública)
-- Usa `idx_boosts_active (post_id, expires_at desc)`. Sin índice parcial
-- `where expires_at > now()`: Postgres exige predicados IMMUTABLE y `now()` no
-- lo es — se congelaría en el instante de crear el índice (explicado en 0002).
-- ============================================================================
create or replace function public.boost_vivo(p_post uuid)
returns table (id uuid, expires_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select b.id, b.expires_at
    from public.boosts b
   where b.post_id = p_post and b.expires_at > now()
   order by b.expires_at desc
   limit 1;
$$;

revoke all on function public.boost_vivo(uuid) from public, anon;
grant execute on function public.boost_vivo(uuid) to authenticated, service_role;
