-- ============================================================================
-- Darma · 0217_1 · B12 · Cosméticos de perfil: la propiedad se persiste y la
--                        compra cobra y escribe en la MISMA transacción.
--
-- Cierra el pedido «De B12 → F2/B05 · faltan columnas para los cosméticos de
-- perfil» (HANDOFF/PEDIDOS.md): `lib/billing/cosmeticos.ts` tenía el catálogo y
-- la validación anti-imitación, pero la propiedad no vivía en ningún sitio y la
-- tienda los enseñaba como «próximamente». ADITIVA: dos columnas nuevas, sus
-- CHECK y una función; no modifica filas ni restringe nada que hoy sea válido.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--  1. `profiles.cosmetic_frame` y `profiles.cosmetic_palette` (text, NULL).
--     NULL = sin cosmético, que es el estado de todo el mundo hoy. El CHECK es
--     la LISTA CERRADA del catálogo de `lib/billing/cosmeticos.ts`
--     (IDS_MARCOS / IDS_PALETAS): espejo TS ≡ SQL con test que lee este archivo
--     (`lib/billing/cosmeticos.test.ts`, mismo patrón que `sincronia.test.ts`
--     con 0121 y que el guard de `compute_hot_score`). Un id que no está en el
--     catálogo no es escribible ni siquiera por un bug del servidor.
--
--     La categoría `tema` NO tiene columna a propósito: la ficha solo pide
--     marco y paleta, y una columna sin decisión de producto detrás es un
--     almacenamiento que luego hay que migrar. El tema sigue «próximamente».
--
--  2. `comprar_cosmetico()`: cobra con `spend_crystals()` y escribe la columna
--     en la MISMA transacción. El cliente NO puede escribirse un cosmético sin
--     pagar: las dos columnas quedan FUERA del `grant update` de `authenticated`
--     (0001 §privilegios: el grant es por columna y una columna nueva nace sin
--     privilegio), así que esta función, concedida solo a `service_role`, es la
--     única vía de escritura.
--
-- ── IDEMPOTENCIA POR (PERSONA, COSMÉTICO) ───────────────────────────────────
-- Un doble toque en un móvil con red mala no puede cobrar dos veces. Aquí no
-- hace falta clave de idempotencia del cliente (patrón de boosts/gifts): la
-- columna ES el estado, así que «¿ya lleva puesto exactamente este cosmético?»
-- se responde leyendo la fila. Se lee CON `for update` para que dos compras
-- simultáneas del mismo cosmético se serialicen: la segunda ve la columna ya
-- escrita y devuelve `comprado = false` sin cobrar.
--
-- Consecuencia asumida (anotada en PEDIDOS): la columna guarda el cosmético
-- PUESTO, no un armario. Cambiar de marco vuelve a cobrar, porque no hay tabla
-- de propiedad histórica; si producto quiere armario, es una tabla nueva
-- (`profile_cosmetics`), no un parche aquí.
--
-- ── 🔴 LÍNEA ROJA ───────────────────────────────────────────────────────────
-- Decoración, y solo decoración. Esta función no toca karma_* ni crisis_events;
-- cobra de `profiles.crystals` vía `spend_crystals()` (que deja el apunte en
-- `crystal_ledger` con `source = 'spend'`) y escribe UNA columna cosmética.
-- La regla anti-imitación de niveles vive en el catálogo TS y en su guard; la
-- lista cerrada del CHECK hace que nada fuera del catálogo pueda existir.
--
-- ── LECTURA ─────────────────────────────────────────────────────────────────
-- Las dos columnas son la cara pública del perfil (como `avatar_seed`): se
-- CONCEDEN en SELECT a `authenticated`, sumándose al grant por columnas de
-- 0001. Nada de RLS nuevo: `profiles_read using (true)` ya decide las filas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 · Las dos columnas y su lista cerrada
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists cosmetic_frame   text,
  add column if not exists cosmetic_palette text;

-- La lista cerrada = los ids de `CATALOGO_COSMETICOS` por categoría. El test de
-- espejo (`lib/billing/cosmeticos.test.ts`) extrae estas dos listas con una
-- expresión regular y las compara con IDS_MARCOS / IDS_PALETAS literal a
-- literal: un cosmético nuevo se añade en los DOS lados o el test no deja.
alter table public.profiles drop constraint if exists profiles_cosmetic_frame_check;
alter table public.profiles
  add constraint profiles_cosmetic_frame_check
  check (cosmetic_frame is null or cosmetic_frame in ('marco_niebla', 'marco_marea'));

alter table public.profiles drop constraint if exists profiles_cosmetic_palette_check;
alter table public.profiles
  add constraint profiles_cosmetic_palette_check
  check (cosmetic_palette is null or cosmetic_palette in ('paleta_amanecer', 'paleta_musgo'));

comment on column public.profiles.cosmetic_frame is
  'Marco de avatar PUESTO (id del catálogo de lib/billing/cosmeticos.ts, lista cerrada en el CHECK). NULL = ninguno. Solo lo escribe comprar_cosmetico(): la columna queda fuera del grant update de authenticated a propósito.';

comment on column public.profiles.cosmetic_palette is
  'Paleta de perfil PUESTA (id del catálogo de lib/billing/cosmeticos.ts, lista cerrada en el CHECK). NULL = ninguna. Solo la escribe comprar_cosmetico().';

-- Cara pública del perfil: se ven, como el alias o la semilla del avatar. El
-- grant por columnas de 0001 no las incluye (no existían), así que se suman
-- aquí. UPDATE, deliberadamente, NO: pagar es la única vía de ponérselos.
grant select (cosmetic_frame, cosmetic_palette) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 · comprar_cosmetico — cobro y escritura en la misma transacción
-- ----------------------------------------------------------------------------

-- `p_coste` lo resuelve el SERVIDOR contra el catálogo TS (patrón de
-- `enviar_regalo`, que recibe el reparto ya resuelto): el cliente manda solo un
-- id, y esta función únicamente la puede llamar `service_role`. La columna de
-- destino se deriva del PREFIJO del id (`marco_…` / `paleta_…`); la pertenencia
-- a la lista cerrada la impone el CHECK de la Sección 1 en el propio UPDATE,
-- dentro de esta transacción: si el id no existe en el catálogo, el UPDATE
-- revienta y el cobro SE REVIERTE con él. Nunca hay cobro sin cosmético.
create or replace function public.comprar_cosmetico(
  p_user      uuid,
  p_cosmetico text,
  p_coste     integer
) returns table (comprado boolean, saldo integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_frame   text;
  v_palette text;
  v_actual  text;
  v_saldo   integer;
begin
  if p_coste is null or p_coste <= 0 then
    raise exception 'importe inválido' using errcode = 'DA006';
  end if;

  if p_cosmetico is null
     or (p_cosmetico not like 'marco\_%' and p_cosmetico not like 'paleta\_%') then
    -- Ni marco ni paleta (p. ej. un tema): no hay columna donde vivir, así que
    -- se rechaza ANTES de cobrar nada.
    raise exception 'cosmético inválido' using errcode = 'DA006';
  end if;

  -- Lock de la fila del perfil: dos compras simultáneas se serializan y la
  -- segunda ve lo que escribió la primera (ver la cabecera).
  select p.cosmetic_frame, p.cosmetic_palette
    into v_frame, v_palette
    from public.profiles p
   where p.id = p_user
     for update;

  if not found then
    raise exception 'perfil inexistente' using errcode = 'DA002';
  end if;

  v_actual := case when p_cosmetico like 'marco\_%' then v_frame else v_palette end;

  if v_actual = p_cosmetico then
    -- Idempotencia por (persona, cosmético): el reintento del doble toque
    -- devuelve `comprado = false` con el saldo INTACTO. Esta rama va ANTES del
    -- cobro; cobrar y luego mirar sería, literalmente, cobrar dos veces.
    select p.crystals into v_saldo from public.profiles p where p.id = p_user;
    return query select false, coalesce(v_saldo, 0);
    return;
  end if;

  -- spend_crystals devuelve FALSE cuando falta saldo; no lanza. Ignorar el
  -- booleano sería regalar el cosmético (mismo aviso que en enviar_regalo).
  if not public.spend_crystals(p_user, p_coste, 'cosmetico:' || p_cosmetico) then
    raise exception 'saldo insuficiente' using errcode = 'DA001';
  end if;

  -- Mismo statement transaccional que el cobro: o hay cobro y cosmético, o no
  -- hay ninguno de los dos. Aquí es donde el CHECK de la lista cerrada actúa.
  if p_cosmetico like 'marco\_%' then
    update public.profiles set cosmetic_frame = p_cosmetico where id = p_user;
  else
    update public.profiles set cosmetic_palette = p_cosmetico where id = p_user;
  end if;

  select p.crystals into v_saldo from public.profiles p where p.id = p_user;
  return query select true, coalesce(v_saldo, 0);
end;
$$;

-- La disciplina de 0215, repetida para lo nuevo: una función `security definer`
-- nueva hereda el EXECUTE que PUBLIC tiene por defecto y PostgREST la publica
-- como endpoint RPC. Fuera de todo el mundo salvo del servidor.
revoke all on function public.comprar_cosmetico(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.comprar_cosmetico(uuid, text, integer) to service_role;

comment on function public.comprar_cosmetico(uuid, text, integer) is
  'Cobra p_coste con spend_crystals() y escribe cosmetic_frame o cosmetic_palette en la MISMA transacción. Idempotente por (persona, cosmético): si la columna ya lleva ese id, devuelve comprado=false sin cobrar. Solo service_role; p_coste lo resuelve el servidor contra lib/billing/cosmeticos.ts. Ver 0217_1.';
