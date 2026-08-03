# Handoff · cómo trabajar en Darma en paralelo

Este directorio existe para una sola cosa: que **muchas sesiones de Claude Code
trabajen en Darma a la vez sin pisarse**. Cada bloque es una ficha autocontenida
—`B01.md` … `B20.md`— que se puede pegar tal cual en una sesión nueva.

## La regla que lo sostiene todo

> **Cada archivo tiene exactamente un dueño.** Si tu ficha no lista un archivo en
> «Archivos que posees», no lo edites. Ni para un import, ni para "un arreglito".

Cuando dos sesiones editan el mismo archivo, el merge no es el problema: el
problema es que la segunda revierte decisiones de la primera sin enterarse. Por
eso la propiedad es exclusiva y por directorio, no por archivo suelto.

¿Necesitas que cambie algo de otro bloque? No lo cambies: **anótalo en
`HANDOFF/PEDIDOS.md`** (una línea: qué necesitas, de qué bloque, por qué) y sigue
con un stub local. Alguien lo integra después.

## Antes de empezar cualquier bloque

1. Lee `HANDOFF/CONTRATOS.md` entero. Es la fuente de verdad de tipos, rutas de
   API, tablas y convenciones. **No lo edites** (dueño: el bloque B00).
2. Lee `supabase/migrations/0001_core.sql` y `0002_comunidad.sql`. El esquema
   manda; si tu código y el SQL discrepan, el SQL tiene razón.
3. Lee `ARCHITECTURE.md` en la raíz.
4. Lee tu ficha `HANDOFF/Bxx.md`.

## Los cuatro principios que ningún bloque puede romper

1. **Anonimato por diseño.** Nunca cara, nombre real, email ni teléfono en una
   respuesta de API ni en un componente. Si tu consulta devuelve una columna que
   no existe en `profiles`, párate y pregunta.
2. **La autoridad está en Postgres, no en la app.** Reciprocidad, karma, límites
   y permisos se aplican con triggers, funciones `security definer` y RLS. La UI
   pinta el estado; no lo decide. Un gate que solo vive en una ruta de Next se
   salta con un `curl` a PostgREST usando la anon key.
3. **Escala desde el primer commit.** Cero `count(*)` en lecturas, cero `OFFSET`
   en paginación (siempre keyset), cero N+1, contadores desnormalizados por
   trigger. Un índice nuevo va acompañado del `WHERE` real de su consulta.
4. **La crisis gana siempre.** Ninguna optimización, caché, boost o experimento
   puede retrasar, ocultar o desordenar la detección y atención de un post de
   riesgo. Ante la duda, escala hacia arriba: un falso positivo molesta; un falso
   negativo es irreversible.

## Estado de la base (bloques ya cerrados o en curso)

| Bloque | Qué | Estado |
|---|---|---|
| F1 | `supabase/migrations/0001_core.sql` — identidad, karma, reciprocidad, RLS | ✅ hecho |
| F2 | `supabase/migrations/0002_comunidad.sql` — refugios, contenido, encuestas, moderación, cristales | 🟡 en curso |
| F3 | `lib/**` núcleo — karma, ranking, crisis, moderación, anonimato, rate-limit | 🟡 en curso |
| F4 | Configuración raíz + `app/layout.tsx`, `globals.css`, landing, CSP | 🟡 en curso |

**No empieces un bloque de la ola 1 hasta que F2–F4 estén en verde.** Si están en
curso, puedes leer las fichas y preparar el plan, pero no escribir código que
importe de `lib/`.

## Olas

Las olas son de **dependencia**, no de prioridad. Dentro de una ola, todos los
bloques corren a la vez.

### Ola 1 — se pueden lanzar los 6 a la vez, en cuanto F2–F4 cierren
| Bloque | Título | Dueño de |
|---|---|---|
| B01 | Auth anónima y onboarding | `app/(auth)/**`, `app/api/auth/**`, `components/auth/**`, `lib/auth/**` |
| B16 | Sistema de diseño y accesibilidad | `components/ui/**`, `app/styles/**` |
| B08 | Ingesta de contenido curado (crons) | `lib/ingest/**`, `app/api/cron/content/**`, `scripts/ingest/**` |
| B14 | Observabilidad y pruebas de carga | `app/api/health/**`, `lib/observability/**`, `scripts/load/**` |
| B15 | Seguridad: auditoría de RLS y CI | `.github/workflows/**`, `scripts/security/**`, `supabase/tests/**` |
| B17 | Internacionalización (es/en) | `i18n/**`, `messages/**` |

### Ola 2 — el producto. Los 6 en paralelo, tras B01 y B16
| Bloque | Título | Dueño de |
|---|---|---|
| B02 | Feed «Para ti» y paginación keyset | `app/(app)/feed/**`, `app/api/feed/**`, `components/feed/**` |
| B03 | Publicar: composer y gate de reciprocidad | `app/(app)/publicar/**`, `app/api/posts/**`, `components/composer/**` |
| B04 | Hilo: escuchar, validar, «me ayudó» | `app/(app)/post/**`, `app/api/comments/**`, `components/thread/**` |
| B05 | Perfil, karma y niveles | `app/(app)/perfil/**`, `app/api/karma/**`, `components/perfil/**` |
| B07 | Nivel 1 · feed vertical de video | `app/(app)/animo/**`, `app/api/content/**`, `components/video/**` |
| B11 | Moderación e IA de crisis | `lib/ai/**`, `app/api/moderation/**`, `app/(admin)/moderacion/**` |

### Ola 3 — la comunidad. Los 5 en paralelo, tras la ola 2
| Bloque | Título | Dueño de |
|---|---|---|
| B06 | Ranking y reconocimiento | `app/(app)/ranking/**`, `app/api/ranking/**`, `components/ranking/**` |
| B09 | Encuestas del feed | `app/api/polls/**`, `components/polls/**` |
| B10 | Refugios (chat cifrado) y Almas Afines | `app/(app)/refugios/**`, `app/api/refuges/**`, `components/refuge/**`, `lib/crypto/**` |
| B13 | Notificaciones push y PWA | `app/api/push/**`, `components/pwa/**`, `public/sw.js`, `public/manifest.json` |
| B20 | Privacidad, RGPD y legales | `app/(legal)/**`, `app/api/privacy/**`, `lib/privacy/**` |

### Ola 4 — negocio y operación. Los 3 en paralelo
| Bloque | Título | Dueño de |
|---|---|---|
| B12 | Economía: cristales, boosts, regalos, IAP | `app/api/billing/**`, `components/economia/**`, `lib/billing/**` |
| B18 | E2E con Playwright | `e2e/**`, `playwright.config.ts` |
| B19 | Centro de mando (admin) | `app/(admin)/**` salvo `moderacion`, `app/api/admin/**` |

## Cómo lanzar un bloque en una sesión nueva

```bash
claude "Lee HANDOFF/README.md, HANDOFF/CONTRATOS.md y HANDOFF/B02.md, y ejecuta el bloque B02 completo."
```

## Definición de «terminado» (aplica a todos los bloques)

Un bloque no está cerrado hasta que **las seis** se cumplen:

1. `npx tsc --noEmit` pasa sin errores.
2. `npm run lint` pasa sin errores.
3. Los tests del bloque pasan (`node --test`), y cubren el camino de fallo, no
   solo el feliz.
4. Ningún archivo fuera de tu lista de propiedad ha cambiado (`git status` lo
   confirma).
5. Toda ruta de API nueva tiene: validación de entrada con zod, rate limiting,
   comprobación de sesión y un error que no filtra detalle interno.
6. Has actualizado la fila de tu bloque en `HANDOFF/ESTADO.md` y anotado en
   `HANDOFF/PEDIDOS.md` lo que necesitas de otros bloques.
