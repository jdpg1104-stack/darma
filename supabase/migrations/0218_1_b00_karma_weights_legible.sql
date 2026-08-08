-- ============================================================================
-- B00 · `karma_weights` prometía ser pública y dependía de la suerte
--
-- 0001 declara la tabla «PÚBLICA Y AUDITABLE (valor Transparencia)», le pone una
-- política `karma_weights_read` y revoca insert/update/delete. Lo que nunca
-- concedió es el SELECT.
--
-- ── POR QUÉ FUNCIONABA IGUAL, Y POR QUÉ ESO ERA EL PROBLEMA ────────────────
-- Supabase fija `alter default privileges ... grant all on tables to anon,
-- authenticated` en su arranque, así que toda tabla creada después nace
-- legible. La lectura de `karma_weights` no venía de ninguna migración: venía
-- de un privilegio por defecto del entorno.
--
-- Y los entornos no coinciden. Comprobado el 2026-08-05, con las MISMAS
-- migraciones aplicadas:
--
--   · en `darma-dev`               → `has_table_privilege('anon', …, 'SELECT')` = true
--   · en un `supabase db reset`    → false, y la suite pgTAP falla
--
-- Es decir: la promesa de transparencia se sostenía sobre algo que no está
-- escrito en el repositorio y que ya diverge entre dos entornos. Producción se
-- aprovisiona desde estas migraciones, así que era una moneda al aire sobre si
-- la economía iba a ser auditable o iba a devolver 42501.
--
-- Una RLS `for select using (true)` no salva nada: los privilegios de tabla se
-- comprueban ANTES que las políticas. Sin el grant, la política es inalcanzable
-- y describe un permiso que no existe — el mismo fallo silencioso que 0004
-- documenta en el otro sentido.
--
-- Lo encontró la suite pgTAP el día que se cableó en CI: llevaba desde el 3 de
-- agosto en el repositorio sin ejecutarse ni una vez.
-- ============================================================================

-- Explícito, y por eso mismo idéntico en los tres entornos. Se conceden las dos
-- roles porque la tabla se lee sin sesión a propósito: quien se está planteando
-- entrar en Darma puede ver cuánto vale cada cosa ANTES de registrarse, que es
-- lo que hace que «auditable» signifique algo.
grant select on public.karma_weights to anon, authenticated;

-- Se re-afirma lo que 0001 ya revocaba. No es redundancia decorativa: deja el
-- permiso de escritura y el de lectura decididos en el mismo sitio, para que
-- quien lea este archivo no concluya que el grant de arriba abrió la tabla
-- entera.
revoke insert, update, delete on public.karma_weights from anon, authenticated;

comment on table public.karma_weights is
  'Tabla de pesos de la economia. Legible por anon y authenticated POR DISENO (valor Transparencia): el grant es explicito desde 0218 porque antes dependia de los privilegios por defecto de Supabase y eso ya divergia entre entornos. Escritura revocada: solo se cambia por migracion.';
