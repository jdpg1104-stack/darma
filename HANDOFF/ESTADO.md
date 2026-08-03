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
| B01 | Auth anónima y onboarding | ⬜ pendiente | | Ola 1 |
| B02 | Feed «Para ti» | ⬜ pendiente | | Ola 2 |
| B03 | Publicar y gate de reciprocidad | ⬜ pendiente | | Ola 2 |
| B04 | Hilo: escuchar y validar | ⬜ pendiente | | Ola 2 |
| B05 | Perfil, karma y niveles | ⬜ pendiente | | Ola 2 |
| B06 | Ranking y reconocimiento | ⬜ pendiente | | Ola 3 |
| B07 | Nivel 1 · feed vertical de video | ⬜ pendiente | | Ola 2 |
| B08 | Ingesta de contenido curado | ⬜ pendiente | | Ola 1 |
| B09 | Encuestas del feed | ⬜ pendiente | | Ola 3 |
| B10 | Refugios y Almas Afines | ⬜ pendiente | | Ola 3 |
| B11 | Moderación e IA de crisis | ⬜ pendiente | | Ola 2 |
| B12 | Economía premium | ⬜ pendiente | | Ola 4 |
| B13 | Push y PWA | ⬜ pendiente | | Ola 3 |
| B14 | Observabilidad y carga | ⬜ pendiente | | Ola 1 |
| B15 | Seguridad y CI | ⬜ pendiente | | Ola 1 |
| B16 | Sistema de diseño | ⬜ pendiente | | Ola 1 |
| B17 | Internacionalización | ⬜ pendiente | | Ola 1 |
| B18 | E2E Playwright | ⬜ pendiente | | Ola 4 |
| B19 | Centro de mando (admin) | ⬜ pendiente | | Ola 4 |
| B20 | Privacidad y RGPD | ⬜ pendiente | | Ola 3 |

Leyenda: ⬜ pendiente · 🟡 en curso · ✅ hecho · 🔴 bloqueado (di por qué en Notas)
