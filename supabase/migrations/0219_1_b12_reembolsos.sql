-- ============================================================================
-- Darma · 0219_1 · B12 · Reembolsos: el apunte inverso con suelo en cero
--
-- Cierra el pendiente que B12 dejó anotado (ESTADO.md, fila B12): «REFUND /
-- voidedPurchase se registran pero NO generan el apunte inverso; falta decidir
-- qué hacer cuando el saldo ya se gastó». La decisión de producto ya está
-- tomada y es esta, entera:
--
--   · Al llegar un reembolso se RESTA del saldo lo reembolsado HASTA dejar el
--     saldo en 0. **Nunca negativo**: un saldo negativo castigaría compras
--     legítimas posteriores — la persona pagaría un paquete nuevo y lo vería
--     evaporarse contra una deuda de un reembolso viejo, que es la clase de
--     sorpresa que convierte una compra en una reclamación.
--   · El apunte inverso queda SIEMPRE en el ledger, por el delta EFECTIVAMENTE
--     revertido (que puede ser 0 si el saldo ya se gastó entero).
--   · Si el saldo ya se gastó, la pérdida SE ASUME y SE AUDITA: el apunte lleva
--     en `raw_receipt` cuánto reembolsó la store (`reembolsado`), cuánto se
--     recuperó (`revertido`) y cuánto no (`perdido`). Preferimos perder dinero
--     nosotros a dejar a alguien con saldo negativo; el mismo criterio que «EL
--     ORDEN IMPORTA» en lib/billing/google.ts.
--
-- ── IDEMPOTENCIA: LA MISMA DE acreditar_compra (0121_1 §4) ──────────────────
-- Apple y Google reintentan sus notificaciones durante días. El apunte inverso
-- lleva `external_id = 'refund:' || external_id_original`, cae bajo el mismo
-- índice único parcial `uq_crystal_ledger_external` (0002), y el insert es el
-- patrón especulativo de siempre:
--
--     on conflict (external_id) where external_id is not null do nothing
--     returning id
--
-- Si NO devuelve fila, el reembolso ya se procesó: `profiles.crystals` NO se
-- toca y se devuelven las cifras del primer procesado (leídas del apunte).
-- Restar fuera de esa rama es, literalmente, cómo un reintento descontaría dos
-- veces. El prefijo `refund:` no puede colisionar con `apple:` ni `google:`,
-- así que un reembolso jamás «ocupa» el hueco de una compra ni al revés.
--
-- La carrera entre dos reintentos simultáneos la serializa el lock de fila
-- (`select ... for update` sobre `profiles`): el segundo espera, ve el
-- conflicto en el insert y cae en la rama de reintento.
--
-- ── EL TRIGGER APPEND-ONLY NO SE TOCA ───────────────────────────────────────
-- `trg_crystal_ledger_immutable` (0002) sigue prohibiendo UPDATE y DELETE,
-- también a service_role. Un apunte NUEVO con delta negativo no es una edición:
-- es exactamente la corrección contable que la cabecera de ese trigger manda
-- («para corregir, inserta un movimiento inverso con source = 'refund'»).
-- Esta migración solo INSERTA; ni desactiva ni redefine el trigger.
--
-- ── ⚠️ NO ADITIVO Y MERECE REVISIÓN: SE RELAJA EL CHECK DE delta ────────────
-- 0002 declaró `delta integer not null check (delta <> 0)`. Pero «el apunte
-- inverso queda SIEMPRE en el ledger» incluye el caso saldo-ya-gastado, donde
-- el delta efectivamente revertido es 0 y el apunte es pura auditoría de la
-- pérdida. Las dos cosas no pueden ser verdad a la vez. Alternativas
-- descartadas:
--   (a) No insertar apunte cuando revertido = 0. La pérdida quedaría solo en
--       los logs, que caducan; el ledger es el histórico económico y un
--       reembolso que nos costó dinero es exactamente lo que hay que poder
--       auditar leyendo la tabla. Además rompería la idempotencia: sin fila,
--       cada reintento de la store volvería a evaluar el reembolso.
--   (b) Insertar delta = -reembolsado y compensar con un segundo apunte
--       positivo por lo no recuperable. Dos filas para un hecho, y una de
--       ellas «acuña» cristales que nunca existieron: mentir en el ledger para
--       cuadrar un check es peor que relajar el check.
-- Se relaja a `delta <> 0 OR source = 'refund'`: nada que fuera válido deja de
-- serlo, y el delta 0 queda acotado al único source donde significa algo
-- («no se recuperó nada»). Mismo criterio que la relajación razonada de
-- `boosts.amount` en 0121_1 §1.
--
-- ── LOS DOS BORDES, DECIDIDOS Y ESCRITOS ────────────────────────────────────
--   · Reembolso de una compra que NUNCA se acreditó (webhook perdido, compra
--     sin destinatario que nadie restauró): no hay nada que revertir ni nadie
--     a quien revertírselo → `estado = 'sin_compra'`, sin fila nueva. La ruta
--     lo registra para soporte. Si la acreditación llegara DESPUÉS del
--     reembolso (orden invertido, posible con los reintentos de la store), esa
--     compra se acreditaría y este apunte no existiría: es una pérdida que se
--     detecta en la reconciliación ledger↔caché ya pedida en PEDIDOS, no un
--     caso que este código pueda cerrar sin inventarse una lápida especulativa.
--   · Perfil borrado: imposible de observar aquí — el FK de `crystal_ledger`
--     es `on delete cascade`, así que si la compra original sigue en el
--     ledger, el perfil existe. El raise DA002 de abajo es defensa en
--     profundidad, no un camino esperado.
--
-- ── 🔴 LÍNEA ROJA ───────────────────────────────────────────────────────────
-- Nada de esta migración toca karma ni crisis: un reembolso mueve `crystals` y
-- el ledger, y nada más. La función es `security definer` y solo la ejecuta
-- `service_role` (los webhooks), con el mismo revoke disciplinado de 0215.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 · Relajación del CHECK de delta (ver cabecera: ⚠️ no aditivo)
-- ----------------------------------------------------------------------------
alter table public.crystal_ledger drop constraint if exists crystal_ledger_delta_check;
alter table public.crystal_ledger
  add constraint crystal_ledger_delta_check check (delta <> 0 or source = 'refund');

comment on column public.crystal_ledger.delta is
  'Positivo = compra o regalo recibido. Negativo = gasto o reversión de reembolso. 0 SOLO con source=''refund'': el saldo ya se había gastado y el apunte audita la pérdida (raw_receipt lleva reembolsado/revertido/perdido). Ver 0219_1 §1.';

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 · revertir_compra — la única vía por la que SALEN cristales
--             a causa de un reembolso de la store
-- ----------------------------------------------------------------------------
create or replace function public.revertir_compra(
  p_external_id text,   -- el de la compra ORIGINAL: 'apple:...' | 'google:...'
  p_motivo      text    -- 'REFUND' | 'REVOKE' | 'voidedPurchase' (para el apunte)
) returns table (
  estado    text,     -- 'revertida' | 'reintento' | 'sin_compra'
  revertido integer,  -- lo que se restó del saldo (el delta del apunte, en positivo)
  perdido   integer,  -- lo que la store reembolsó y ya no estaba: pérdida asumida
  saldo     integer   -- crystals tras la operación; null si estado='sin_compra'
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid;
  v_delta     integer;
  v_saldo     integer;
  v_revertido integer;
  v_perdido   integer;
  v_id        bigint;
begin
  if p_external_id is null or length(trim(p_external_id)) = 0 then
    -- Sin external_id no hay idempotencia posible; un reembolso sin ella se
    -- restaría dos veces. Fail-closed, igual que en acreditar_compra.
    raise exception 'reembolso sin identificador externo' using errcode = 'DA006';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'reembolso sin motivo' using errcode = 'DA006';
  end if;

  -- 1 · La compra original. `delta > 0` y source de compra: un apunte de
  -- gasto, un regalo o una reversión previa jamás son «lo reembolsado».
  -- `uq_crystal_ledger_external` garantiza que hay a lo sumo una fila.
  select l.user_id, l.delta
    into v_user, v_delta
    from public.crystal_ledger l
   where l.external_id = p_external_id
     and l.delta > 0
     and l.source in ('iap_apple', 'iap_google');

  if not found then
    return query select 'sin_compra'::text, 0, 0, null::integer;
    return;
  end if;

  -- 2 · Lock de la fila del perfil. Serializa este reembolso frente a un gasto
  -- concurrente y frente a su propio reintento: el suelo en 0 se calcula sobre
  -- un saldo que ya no puede moverse debajo.
  select p.crystals into v_saldo
    from public.profiles p
   where p.id = v_user
     for update;

  if not found then
    -- Inobservable (FK on delete cascade, ver cabecera). Defensa en profundidad.
    raise exception 'perfil inexistente' using errcode = 'DA002';
  end if;

  -- 3 · Suelo en cero: se revierte lo que quede, nunca más de lo reembolsado y
  -- nunca por debajo de 0. Lo que no está, se perdió — y se escribe.
  v_revertido := least(v_saldo, v_delta);
  v_perdido   := v_delta - v_revertido;

  -- 4 · El apunte inverso, SIEMPRE (delta 0 incluido: audita la pérdida).
  -- Insert especulativo: el conflicto ES la detección del reintento.
  insert into public.crystal_ledger (user_id, delta, reason, source, external_id, raw_receipt)
  values (
    v_user,
    -v_revertido,
    'refund:' || trim(p_motivo),
    'refund',
    'refund:' || p_external_id,
    jsonb_build_object(
      'external_id_original', p_external_id,
      'motivo',               trim(p_motivo),
      'reembolsado',          v_delta,
      'revertido',            v_revertido,
      'perdido',              v_perdido
    )
  )
  on conflict (external_id) where external_id is not null do nothing
  returning id into v_id;

  if v_id is not null then
    -- SOLO dentro de esta rama, como en acreditar_compra: tocar el caché fuera
    -- del `if` es cómo un reintento descontaría dos veces. No puede quedar
    -- negativo: v_revertido <= v_saldo bajo el lock, y el check
    -- `crystals >= 0` de 0001 lo reafirma como restricción del motor.
    update public.profiles
       set crystals = crystals - v_revertido
     where id = v_user
    returning crystals into v_saldo;

    return query select 'revertida'::text, v_revertido, v_perdido, v_saldo;
  else
    -- Reintento: las cifras verdaderas son las del PRIMER procesado y viven en
    -- el apunte. Recalcularlas contra el saldo de hoy mentiría en las dos
    -- direcciones.
    select -l.delta, coalesce((l.raw_receipt->>'perdido')::integer, 0)
      into v_revertido, v_perdido
      from public.crystal_ledger l
     where l.external_id = 'refund:' || p_external_id;

    return query select 'reintento'::text, coalesce(v_revertido, 0), coalesce(v_perdido, 0), v_saldo;
  end if;
end;
$$;

-- La disciplina de 0215: una función `security definer` nueva hereda el EXECUTE
-- que PUBLIC tiene por defecto y PostgREST la publica como endpoint RPC. Esta
-- resta saldo de cualquiera a partir de un external_id: solo los webhooks.
revoke all on function public.revertir_compra(text, text) from public, anon, authenticated;
grant execute on function public.revertir_compra(text, text) to service_role;

comment on function public.revertir_compra(text, text) is
  'Apunte inverso de un reembolso de la store (REFUND/REVOKE de Apple, voidedPurchase de Google) con suelo en 0 sobre profiles.crystals. Idempotente por external_id ''refund:''||original (mismo patrón que acreditar_compra, 0121_1 §4). El apunte queda SIEMPRE, delta 0 incluido, con la pérdida auditada en raw_receipt (reembolsado/revertido/perdido). Solo service_role. Ver cabecera de 0219_1.';
