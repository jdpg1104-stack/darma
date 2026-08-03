-- ============================================================================
-- Darma · 0009 · Cerrar `profiles_exige_auth_user()` a la API
--
-- Es una función de trigger, así que Postgres rechaza invocarla fuera de un
-- trigger y el riesgo práctico es nulo. Pero quedaba publicada en
-- /rest/v1/rpc/ como si fuera superficie legítima, y `0003` §3 ya había hecho
-- exactamente este barrido para todas las demás.
--
-- Por qué se escapó: la creó `0201_1_b20_privacidad.sql` DESPUÉS de aquel
-- barrido, y su propio `revoke` no llegó a aplicarse porque la base entró en
-- modo solo lectura por tamaño justo en ese momento. Un fallo de infraestructura
-- dejó media migración aplicada — que es precisamente por qué el linter se pasa
-- al final y no solo al principio.
-- ============================================================================

revoke all on function public.profiles_exige_auth_user() from public, anon, authenticated;
