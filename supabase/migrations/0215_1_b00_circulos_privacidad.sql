-- ============================================================================
-- Darma · 0215_1 · B00 · Círculos y privacidad: el karma de hostear un círculo,
--                        los índices que pidió /panel/privacidad y el barrido
--                        de solicitudes caducadas que le faltaba al cron RGPD.
--
-- Tres piezas pequeñas que la ola 2 dejó pedidas. ADITIVA: no modifica filas ni
-- restringe nada que hoy sea válido. Como sus vecinas, esta migración SOLO SE
-- ESCRIBE: no se aplica a ninguna base en esta sesión.
--
--   1. `circle_hosted` era INALCANZABLE. El peso existe en `karma_weights`
--      desde 0001 (+30, `counts_to_cap = true`), pero ningún camino lo pagaba:
--      `b10_crear_refugio()` (0110_1, sección 6) inserta la sala sin llamar a
--      `award_karma()` y no había trigger. Se acredita aquí con un trigger
--      AFTER INSERT sobre `refuges`, no editando la RPC, por el mismo motivo
--      por el que el karma de una escucha se paga en `comments_on_validated()`
--      (0001, reescrita en 0213): el trigger cubre TODOS los caminos de
--      inserción. 0110_1 §4 concede a `authenticated`
--      `insert (kind, title, topic, created_by, max_members)` sobre `refuges`,
--      así que una sala también puede nacer con un POST directo a PostgREST sin
--      pasar por la RPC — una acreditación dentro de `b10_crear_refugio()` se
--      esquivaría (o se perdería) por esa vía.
--
--      ── DECISIÓN · SIN RESTRICCIÓN DE NIVEL ────────────────────────────────
--      La descripción del peso en 0001 dice «Hostear un círculo grupal
--      (Guía/Mentor)». AQUÍ NO SE IMPONE ese requisito de nivel, a conciencia:
--      ni `b10_crear_refugio()` ni la API de refugios exigen nivel alguno para
--      crear un círculo, y levantar esa barrera nueva en el pago rompería el
--      flujo recién creado — la sala nacería igual y el +30 que la economía
--      pública promete se perdería en silencio, que es exactamente la clase de
--      mentira del ledger que 0001 documenta a propósito de `karma_spend`. Si
--      el producto decide algún día que hostear exige Guía/Mentor, esa regla va
--      en la CREACIÓN de la sala (RPC + política), no en el pago del karma. El
--      paréntesis de la descripción queda como aspiración de producto, no como
--      regla del motor.
--
--      El farmeo está acotado por lo que ya existe: `b10_limitar('refugio_crear')`
--      corta en 5 salas/hora (0110_1 §8) y `award_karma()` aplica el tope
--      diario de 120 con lock de fila — al quinto círculo del día ya no se
--      paga. Idempotencia: la clave `'circle_hosted:' || refuge_id` hace que un
--      reintento no pague dos veces (ON CONFLICT DO NOTHING en 0001).
--
--   2. ÍNDICES de `privacy_requests` para /panel/privacidad (pedido de la ola
--      2, anotado en la cabecera de `app/(admin)/panel/privacidad/logica.ts`):
--      `idx_privacy_requests_pendientes` (0201) cubre `confirmed`/`processing`
--      pero NO `pending_confirm` — con lo que `leerAbiertas` filtraba esa pata
--      sobre el heap — ni el historial de cerradas, que ordena y pagina por
--      `(requested_at desc, id desc)`. Se AÑADEN dos parciales; el de 0201 no
--      se toca porque sigue siendo exactamente la cola del cron de borrados.
--
--   3. BARRIDO de `pending_confirm` caducadas. Nada pasaba a `cancelled` las
--      solicitudes cuyo token de confirmación (24 h, `HORAS_CONFIRMACION` en
--      lib/privacy/borrado.ts) expiró: quedaban «abiertas» para siempre,
--      engordando `leerAbiertas` y la sección de caducadas del panel.
--      `barrer_solicitudes_caducadas()` las cierra por lotes (patrón de
--      `borrados_vencidos` en 0201: solo service_role, idempotente, tope de
--      lote). Se reutiliza el estado `cancelled` a propósito — el enum no
--      crece — y el panel ya trata esa madera muerta como terminal
--      (`cumplioPlazo = null`): caducar sin actuar no es un incumplimiento del
--      servicio, es la persona que no siguió. La llama el cron diario junto a
--      las otras dos piezas RGPD (lib/cron/trabajos/rgpd.ts).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 · El karma de hostear un círculo
-- ----------------------------------------------------------------------------

create or replace function public.refuges_acreditar_circulo() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Solo los círculos: un dúo es una conversación entre dos, no un espacio
  -- hosteado. El tope diario y la idempotencia los aplica `award_karma()`.
  if new.kind = 'circulo' then
    perform public.award_karma(
      new.created_by, 'circle_hosted', 'refuge', new.id,
      'circle_hosted:' || new.id::text
    );
  end if;
  return null;
end;
$$;

create trigger trg_refuges_circle_hosted
  after insert on public.refuges
  for each row execute function public.refuges_acreditar_circulo();

-- La disciplina de 0003, repetida para lo nuevo (mismo caso que
-- `profiles_exige_auth_user` en 0201): una función `returns trigger` nueva
-- hereda otra vez el EXECUTE que PUBLIC tiene por defecto y PostgREST la
-- publica como endpoint RPC. Hoy no es llamable fuera de un trigger, pero es
-- `security definer`, y la regla solo vale si cada migración la repite.
revoke all on function public.refuges_acreditar_circulo() from public, anon, authenticated;

comment on function public.refuges_acreditar_circulo() is
  'Paga circle_hosted (+30, con el tope diario de award_karma) a created_by al nacer un refugio kind=circulo. Idempotente por ''circle_hosted:''||refuge_id. Sin restricción de nivel a propósito: ver la cabecera de 0215_1.';

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 · Índices de privacy_requests para /panel/privacidad
-- ----------------------------------------------------------------------------

-- La pata que a `leerAbiertas` le faltaba: `pending_confirm` por requested_at.
-- Con este parcial más `idx_privacy_requests_pendientes` (0201), el filtro
-- `state in ('pending_confirm','confirmed','processing') order by requested_at`
-- se resuelve desde los índices (BitmapOr) en vez de recorrer el heap. También
-- es el subconjunto exacto que barre `barrer_solicitudes_caducadas()`.
create index if not exists idx_privacy_requests_por_confirmar
  on public.privacy_requests (requested_at)
  where state = 'pending_confirm';

-- El historial de cerradas (`leerHistorial`: done + cancelled) y la sección de
-- fallidas (`leerFallidas`), las dos con `order by requested_at desc, id desc`
-- y keyset por esa misma tupla. El `id` DENTRO del índice es lo que hace que el
-- desempate del cursor no caiga al heap — mismo criterio que
-- `idx_comments_post_keyset` en 0104_1.
create index if not exists idx_privacy_requests_historial
  on public.privacy_requests (requested_at desc, id desc)
  where state in ('done', 'failed', 'cancelled');

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 · barrer_solicitudes_caducadas — pending_confirm cuyo token murió
-- ----------------------------------------------------------------------------

-- `expires_at` es la única verdad sobre el TTL (24 h para el token de borrado;
-- `crear_solicitud_privacidad` admite hasta 7 días): aquí no se re-declara
-- ningún plazo, solo se ejecuta el que la fila ya lleva escrito.
--
-- Idempotente: una fila barrida deja de casar con el WHERE, así que repetir la
-- llamada devuelve 0 y no toca nada. Por lotes con tope, como
-- `borrados_vencidos`: la tabla es pequeña por naturaleza (una fila por
-- solicitud de privacidad, no por post), pero un cron no ejecuta jamás un
-- UPDATE sin tope.
--
-- NO toca `profiles`: una solicitud pendiente de confirmar nunca suspendió a
-- nadie (el shadow-ban lo pone `confirmar_borrado`, que exige el token vivo),
-- así que aquí no hay nada que revertir.
create or replace function public.barrer_solicitudes_caducadas(p_limite integer default 200)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_n integer;
begin
  update public.privacy_requests
     set state        = 'cancelled',
         completed_at = now()
   where id in (
     select r.id
       from public.privacy_requests r
      where r.state = 'pending_confirm'
        and r.expires_at < now()
      order by r.requested_at
      limit greatest(1, least(coalesce(p_limite, 200), 500))
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.barrer_solicitudes_caducadas(integer) from public, anon, authenticated;
grant execute on function public.barrer_solicitudes_caducadas(integer) to service_role;

comment on function public.barrer_solicitudes_caducadas(integer) is
  'Pasa a cancelled las solicitudes pending_confirm cuyo token expiró (expires_at). Por lotes, idempotente y solo service_role, como borrados_vencidos. La llama el cron diario: lib/cron/trabajos/rgpd.ts.';
