# E2E de Darma · bloque B18

Los seis recorridos de `e2e/specs/` son la **definición ejecutable de «Darma
funciona»**: la reciprocidad 3:1, la privacidad del karma gastable y la tarjeta
de crisis atraviesan navegador, rutas de API, RLS y triggers de Postgres, y
ninguna prueba unitaria puede verificarlas de extremo a extremo.

> ## ⛔ ESTAS PRUEBAS NUNCA SE APUNTAN A PRODUCCIÓN
>
> La suite **crea y borra usuarios con `service_role`**. Apuntada a producción,
> borra gente de verdad — gente que escribió aquí lo que no le cuenta a nadie.
>
> El fusible de `e2e/utils/admin.ts` solo deja pasar Supabase local o el
> proyecto declarado en `E2E_SUPABASE_PROJECT_REF`, y salta en el *global
> setup*, antes de tocar nada. Su prueba está en
> `e2e/specs/07-fusible-antiproduccion.spec.ts` y se ejecuta siempre.

---

## Ejecutar

```bash
# 1 · Base de datos
npm run db:reset                      # Supabase local
# …o apuntar al proyecto de desarrollo remoto (ver «Variables»)

# 2 · Toda la suite, los dos proyectos (chromium + Mobile Safari)
E2E_SUPABASE_PROJECT_REF=<ref-de-tu-proyecto-de-desarrollo> npx playwright test

# Un solo recorrido
npx playwright test 02-bucle-reciprocidad

# Un solo proyecto
npx playwright test --project=chromium

# Depurar
npx playwright test --ui
npx playwright test --headed --project=chromium 04-crisis
npx playwright show-trace test-results/**/trace.zip
```

El servidor lo levanta Playwright solo (`webServer`), en el **puerto 3018**:
`next dev` en local y `npm run build && npm run start` en CI. En CI se usa el
build de producción a propósito — `next dev` compila cada ruta bajo demanda la
primera vez que se visita, y ese retardo variable es *flakiness* pura.

## Variables

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | contra qué base se ejecuta. La lee el fusible. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | login de los usuarios de prueba y llamadas directas a PostgREST. |
| `SUPABASE_SERVICE_ROLE_KEY` | **crear/borrar usuarios, sembrar y validar comentarios.** Sin ella la mayoría de la suite queda en `test.fixme()`. |
| `E2E_SUPABASE_PROJECT_REF` | **obligatoria contra una base remota.** El ref del proyecto de PRUEBAS. Sin ella el fusible corta. |
| `E2E_PORT` / `E2E_BASE_URL` | puerto y URL base (por defecto 3018). |

`e2e/utils/entorno.ts` carga `.env.local` en el proceso de Playwright (que no es
el de Next). **Nunca sobrescribe** lo que ya venga del entorno: en CI mandan los
secretos del runner.

## Estado actual de este entorno

- **`SUPABASE_SERVICE_ROLE_KEY` ya sirve** (2026-08-05: los recorridos corren de
  verdad contra `darma-dev`). El *global setup* la sigue **comprobando de
  verdad** con una lectura mínima —no se fía de que la variable exista— y
  propaga el veredicto a los workers por `E2E_ADMIN_OK`: si un día deja de
  servir, los recorridos que la necesitan vuelven solos a `test.fixme()` con el
  motivo visible en el informe, sin tocar una línea.
- **El Auth de Supabase limita los logins POR IP.** Cada test crea y loguea su
  usuario; varias pasadas de la suite completa seguidas agotan el límite y los
  fixtures fallan con `429 over_request_rate_limit` ANTES de tocar la app. No
  es un fallo de nada: espera unos minutos. (Y no subas los workers: ver
  «Paralelismo y rate limiting».)
- **No hay `MODERATION_API_KEY`**, así que el clasificador corre siempre
  degradado y **ningún comentario se valida solo**. Es diseño: el sistema falla
  cerrado. Por eso los comentarios se escriben **por la UI** (que es lo que se
  prueba) y se validan después desde el fixture con
  `update comments set is_validated = true`, que dispara `trg_comments_validated`
  — la cadena real: crédito de escucha, `award_karma()` y `reply_count`.
  **Nunca se toca `profiles.listen_credits` a mano**: eso se saltaría justo el
  trigger que hay que verificar.

## Cómo está montado

```
e2e/
  specs/      los recorridos. CERO selectores aquí dentro.
  paginas/    Page Object Model. Todos los selectores viven aquí.
  fixtures/   `test` extendido; ÚNICO import de un spec.
  utils/      fusible, prefijo de ejecución, sesión, limpieza, textos.
```

Reglas que sostienen la suite:

- Un spec **nunca** importa `@playwright/test` ni `@supabase/supabase-js`.
- Un spec **nunca** contiene un selector, un número de la economía ni una frase
  de copy: se importan de `lib/karma.ts` y `lib/reciprocity.ts`.
- Un spec **nunca** depende del orden de ejecución ni de otro spec.
- **Un usuario nuevo por test.** Nada de `storageState` compartido: dos tests que
  compartan usuario compiten por `listen_credits` y el fallo será intermitente.
- **Cero `waitForTimeout`.** Se espera por estado observable.
- **Cero `page.route()`.** Mockear el gate de reciprocidad haría que la prueba
  pasara siempre sin probar nada.

## El reproductor en headless: el stub

El widget de youtube-nocookie **no responde en Chromium headless**: acepta el
handshake `{event:'listening'}` y no emite jamás `onReady` ni `onStateChange`
(verificado con sondeos aislados fuera de la app — iframe directo, red con
200s, cero eventos en 15 s, también con `channel:'chrome'`). Sin
`onStateChange: REPRODUCIENDO` el flujo de acreditación de `TarjetaVideo`
(latidos → `/sesion`, `/latido`, `/completado`) no tiene disparador y el
recorrido (f) no puede existir.

Por eso `webServer` declara `NEXT_PUBLIC_E2E_STUB_PLAYER=1` y la app, **solo
bajo ese fusible**, sustituye el iframe del widget por un `srcdoc` que habla su
mismo protocolo (`lib/video/stubE2E.ts`). Lo que hay que saber:

- **Lo que se deja de probar es el widget de YouTube, nada más.** La barrera de
  `parsearMensaje` (origen exacto + `source === contentWindow`), la suscripción,
  los latidos, las RPC y el karma se ejercen de verdad: el `srcdoc` hereda
  nuestro origen y los mensajes cruzan un `postMessage` real.
- **El fusible tiene dos cerrojos**: la bandera se inlina en build (solo la
  declara el `webServer`, nunca `.env.local` ni Vercel) y en runtime se exige
  `hostname` local. `scripts/security/guardStubReproductor.ts` vigila que la
  bandera solo se lea en el fusible, que el stub solo lo importe
  `TarjetaVideo` y que ninguno de los dos cerrojos se borre.
- **Ojo con `reuseExistingServer`**: un `next dev` ya levantado en el 3018 SIN
  la bandera hace fallar la suite de vídeo (el widget real no responde en
  headless). Mata ese servidor y deja que Playwright levante el suyo.

## Aislamiento y limpieza

Todo lo que la suite crea lleva el prefijo `e2e_<8hex>_` de la ejecución. El
teardown borra **por prefijo, no por lista de ids**: los ids se pierden si un
test revienta a mitad, el prefijo no. Además hay un barrido de arranque que
elimina restos de ejecuciones de más de 24 h.

`darma-dev` es un plan gratuito de **500 MB compartido con los demás bloques**;
ya se quedó en solo lectura una vez por datos de prueba acumulados. La limpieza
no es estética.

## Paralelismo y rate limiting

`workers: 4` en local y `2` en CI, y no más. `check_rate_limit()` guarda su
contador en una tabla de Postgres **común a todos los workers**: las claves por
usuario no colisionan (cada test crea el suyo), pero las de por IP sí. Si
aparecen 429 esporádicos **no subas el límite de la app**: baja los workers y
anótalo.

## Artefactos

Trazas, vídeos y capturas **contienen texto**: los fixtures de crisis y los
alias quedan grabados. Solo se guardan cuando algo falla y todo el contenido es
sintético (`e2e/utils/textos.ts`). Configura la retención al mínimo en CI.

La `service_role key` vive **solo en el proceso de Node** de Playwright: nunca en
un `NEXT_PUBLIC_*`, nunca dentro de un `page.evaluate()` —eso la metería en el
navegador y en la traza—, y nunca en un archivo importado desde `app/`.
