# Estado de los bloques

Cada sesión actualiza **solo su propia fila** al terminar. Añadir una fila nueva
está bien; reescribir la fila de otro, no.

| Bloque | Título | Estado | Sesión / fecha | Notas |
|---|---|---|---|---|
| F1 | Migración núcleo (`0001_core.sql`) | ✅ hecho | 2026-08-03 | Identidad, karma, reciprocidad por trigger, RLS |
| F2 | Migración comunidad (`0002_comunidad.sql`) | 🟡 en curso | 2026-08-03 | |
| F3 | Núcleo `lib/**` | 🟡 en curso | 2026-08-03 | |
| F4 | Configuración, CSP y `app/` base | 🟡 en curso | 2026-08-03 | |
| B00 | Integración y contratos | ✅ hecho | 2026-08-03 | `HANDOFF/**` |
| B01 | Auth anónima y onboarding | ✅ hecho | 2026-08-03 | `tsc`/`eslint` limpios en mis archivos, 49 tests verdes. Migración `0101_b01_auth.sql` **escrita pero NO aplicada** (sin Docker ni proyecto Supabase). Pedidos abiertos: `/api/auth/*` público en `proxy.ts` (F4) y `IDENTITY_PEPPER`/`TOTP_ENC_KEY` en `.env.example` (F4) |
| B02 | Feed «Para ti» | ⬜ pendiente | | Ola 2 |
| B03 | Publicar y gate de reciprocidad | ⬜ pendiente | | Ola 2 |
| B04 | Hilo: escuchar y validar | ⬜ pendiente | | Ola 2 |
| B05 | Perfil, karma y niveles | ⬜ pendiente | | Ola 2 |
| B06 | Ranking y reconocimiento | ⬜ pendiente | | Ola 3 |
| B07 | Nivel 1 · feed vertical de video | ⬜ pendiente | | Ola 2 |
| B08 | Ingesta de contenido curado | 🟡 en curso | 2026-08-03 | Código completo y verde (`tsc`, `eslint`, 80 tests). Migración `0108_1_ingesta.sql` escrita pero **SIN APLICAR** (no hay base levantada), así que la ejecución real contra fuentes reales queda pendiente. Catálogo semilla: 5 fuentes (OMS, CDC, OPS) comprobadas en vivo con HTTP 200. YouTube se lee por feed Atom, sin clave ni cuota. `vercel.json` lo pide a F4 en `PEDIDOS.md` |
| B09 | Encuestas del feed | ⬜ pendiente | | Ola 3 |
| B10 | Refugios y Almas Afines | ⬜ pendiente | | Ola 3 |
| B11 | Moderación e IA de crisis | ⬜ pendiente | | Ola 2 |
| B12 | Economía premium | ⬜ pendiente | | Ola 4 |
| B13 | Push y PWA | ⬜ pendiente | | Ola 3 |
| B14 | Observabilidad y carga | 🟡 casi | 2026-08-03 | La sesión murió por un error de la API con el código ya escrito: `/api/health`, `/api/health/deep`, `/api/metrics`, `lib/observability/**`, `scripts/seed/**` y `scripts/load/**` (k6 + `EXPLAIN.md`). Compila, lint limpio, tests verdes. **Nada medido**: sin base de datos no hubo siembra de 1 M de filas, ni k6, ni planes reales. `EXPLAIN.md` tiene los huecos marcados como pendientes, sin números inventados. **Revisar antes de dar por cerrado** |
| B15 | Seguridad y CI | 🟡 casi | 2026-08-03 | La sesión murió por un error de la API. En disco: `scripts/security/**` (guards de cliente admin, economía y cabeceras) y `supabase/tests/*.sql` + `rls.integracion.ts`. **`.github/workflows/ci.yml` lo escribió la sesión de integración**, no B15. Falta `lib/supabase/database.types.ts` (se genera contra una base real). Los tests de RLS **no se han ejecutado nunca**: es lo más importante que queda pendiente del proyecto |
| B16 | Sistema de diseño | ✅ hecho | 2026-08-03 | La sesión se colgó tras escribir 9 de los 10 componentes; **`BotonCrisis.tsx` + su CSS los completó la sesión de integración** siguiendo el contrato de la ficha. `tsc` y `eslint` limpios, tests verdes. Enlace real a `/ayuda` (funciona sin JS), sin pulso ni rojo de alarma, `--danger` solo en borde e icono |
| B17 | Internacionalización | ✅ hecho | 2026-08-03 | `i18n/**` + `messages/**`. 58 pruebas en verde, `tsc` y `eslint` limpios en lo propio. Recursos de crisis **por país** (ES MX AR CO CL PE US GB + INTERNACIONAL); `recursosParaPais()` rechaza un locale por tipos. ⚠️ **Los 24 teléfonos están SIN verificar por un humano** (`tablaListaParaProduccion() === false`): ver PEDIDOS. next-intl aún no instalado; se usa `obtenerTraductor()` propio hasta que F4 monte el plugin |
| B18 | E2E Playwright | ⬜ pendiente | | Ola 4 |
| B19 | Centro de mando (admin) | ⬜ pendiente | | Ola 4 |
| B20 | Privacidad y RGPD | ⬜ pendiente | | Ola 3 |

Leyenda: ⬜ pendiente · 🟡 en curso · ✅ hecho · 🔴 bloqueado (di por qué en Notas)
