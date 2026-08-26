# Presupuesto de rendimiento · medición real

> Documento hermano de `EXPLAIN.md`, y con su misma regla: **cero números
> inventados**. Lo que no se midió pone `PENDIENTE` y dice por qué. Un hueco
> marcado como pendiente se ve; un número falso, no.

**Fecha de la medición:** 2026-08-09 · **rama:** `fragmentos-animo` ·
**commit:** `2a8c8c7` · **Next.js 16.2.12 (Turbopack)**

---

## Titular

**Las 22 rutas medidas superan el presupuesto de JS de CONTRATOS §11.** No es un
problema de una pantalla concreta: **180,5 KB comprimidos (gzip) son base
compartida que se descarga en todas**, incluidas la landing, `/ayuda` y las
páginas legales. El presupuesto son 120 KB, así que la ruta más ligera ya nace
63 KB por encima sin haber cargado una sola línea de producto.

El LCP, en cambio, **cumple con holgura en las 20 rutas donde el navegador lo
reporta**: mediana de 540 a 1388 ms contra un presupuesto de 2500 ms.

Y hay un hallazgo aparte que no estaba en el encargo: **`/entrar` y
`/onboarding` no emiten FCP ni LCP en Chromium**. La causa está demostrada más
abajo. No es que sean lentas: es que Chrome no las mide, y por tanto tampoco las
mide CrUX ni ningún panel de Web Vitals de campo.

---

## El presupuesto, tal y como lo fija CONTRATOS.md §11

> - **JS de cliente:** 120 KB comprimidos por ruta.
> - **LCP:** < 2,5 s en 4G simulado.

(Las otras dos líneas de §11 —3 consultas por render y feed < 50 ms en
`EXPLAIN ANALYZE`— son de base de datos y viven en `EXPLAIN.md`. Este documento
no las toca.)

---

## Por qué esto no sale de la tabla de `next build`

El impedimento que bloqueaba estas filas en `ESTADO.md` («exigen `next build`,
prohibido en el árbol compartido») **ya no existe**:
`scripts/security/gateTelefonos.ts` solo detiene el build cuando
`VERCEL_ENV === 'production'` o `DARMA_EXIGIR_TELEFONOS === '1'`. En local
informa y sale con 0. Se ejecutó `npm run build` y terminó en verde.

Pero apareció un impedimento nuevo, y conviene dejarlo escrito porque afecta a
cualquiera que intente repetir esto: **Next 16 con Turbopack ya no imprime las
columnas `Size` / `First Load JS`**. La tabla de rutas del build es solo una
lista de nombres con su marca de estático o dinámico. Los manifiestos por ruta
(`.next/server/app/**/page/build-manifest.json`) tampoco sirven: únicamente
listan `rootMainFiles`, idénticos para todas.

Así que el número no se leyó de ningún informe: **se midió el tráfico real** de
un servidor de producción (`next start`) con un navegador, sumando el JS que
llega antes del evento `load` de cada ruta. Es la misma definición que «First
Load JS», medida donde de verdad importa.

---

## Cómo se reproduce

```bash
npm run build                       # el gate de teléfonos informa y pasa
npx next start -p 3001              # servidor de PRODUCCIÓN, no `next dev`
node medir.mjs                      # ver «Método», más abajo
```

### Método

- **Navegador:** Chromium de Playwright 1.62.1, headless, contexto nuevo y
  **caché fría en cada pasada**. Viewport 390 × 844, DPR 2, `isMobile`.
- **Red:** estrangulada por CDP `Network.emulateNetworkConditions` con el perfil
  **Slow 4G** de Chrome DevTools: 1,6 Mbit/s de bajada, 750 kbit/s de subida,
  150 ms de RTT.
- **JS por ruta:** suma de `encodedBodySize` (es decir, **bytes comprimidos en
  el cable**) de todos los recursos `.js` cuyo `responseEnd` cae antes del
  `loadEventEnd`. Lo que llega después es prefetch del router y **no** se
  imputa a la ruta.
- **Columnas gzip y brotli:** recomprimidas desde los artefactos reales de
  `.next/static/chunks` (`zlib`, gzip nivel 9 y brotli calidad 11). `next start`
  sirve gzip; Vercel sirve brotli, así que la columna brotli es la que aplica en
  producción.
- **LCP:** `PerformanceObserver` sobre `largest-contentful-paint` con
  `buffered: true`, leído tras `networkidle` + 700 ms. **3 pasadas por ruta**;
  se reporta mediana, mínimo y máximo.
- **Sesión:** las rutas privadas se midieron con **una única** cuenta anónima
  (un solo `POST /api/auth/anonimo`) y su onboarding completado. **No se ejecutó
  la suite e2e** (`npx playwright test`), por el límite de GoTrue por IP.

### Lo que este método NO simula (léelo antes de citar los LCP)

1. **La CPU no está estrangulada.** Lighthouse móvil aplica 4× de ralentización;
   aquí se midió a la velocidad de una CPU de escritorio. Un teléfono de gama
   media tardará más, y con ~600 KB de JS **sin comprimir** que hidratar, ese
   coste no es despreciable. Los LCP de abajo son un **suelo optimista**.
2. **El origen es `localhost`.** El RTT de 150 ms se aplica, pero no hay
   latencia real de servidor, ni cold start de función, ni distancia geográfica.
3. Por eso el veredicto honesto del LCP es *«cumple en estas condiciones»*, no
   *«cumple en 4G»* a secas. Ver `PENDIENTE 4` al final.

---

## (a) JS por ruta contra el presupuesto de 120 KB

Ordenado de peor a mejor. `propio` = lo que la ruta añade sobre la base
compartida. **Ninguna ruta cumple.**

| ruta | chunks | crudo KB | **gzip KB** | brotli KB | propio (gz) | veredicto vs 120 KB |
|---|---:|---:|---:|---:|---:|---|
| `/refugios` | 16 | 947,7 | **276,0** | 236,0 | 95,4 | ⛔ **+156,0 KB** |
| `/perfil/[id]` | 16 | 947,7 | **276,0** | 236,0 | 95,4 | ⛔ **+156,0 KB** |
| `/post/[id]` | 17 | 919,2 | **267,1** | 228,2 | 86,5 | ⛔ **+147,1 KB** |
| `/feed` | 15 | 687,4 | **206,6** | 177,2 | 26,1 | ⛔ **+86,6 KB** |
| `/publicar` | 15 | 672,3 | **201,7** | 172,9 | 21,2 | ⛔ **+81,7 KB** |
| `/perfil` | 14 | 668,9 | **200,3** | 171,6 | 19,8 | ⛔ **+80,3 KB** |
| `/perfil/editar` | 14 | 668,8 | **200,1** | 171,4 | 19,5 | ⛔ **+80,1 KB** |
| `/ranking` | 14 | 667,6 | **199,9** | 171,2 | 19,3 | ⛔ **+79,9 KB** |
| `/animo` | 14 | 650,3 | **196,5** | 168,3 | 16,0 | ⛔ **+76,5 KB** |
| `/onboarding` | 13 | 620,6 | **185,4** | 158,4 | 4,8 | ⛔ **+65,4 KB** |
| `/entrar` | 13 | 617,5 | **184,7** | 157,7 | 4,1 | ⛔ **+64,7 KB** |
| `/` | 12 | 613,2 | **183,0** | 156,3 | 2,4 | ⛔ **+63,0 KB** |
| `/ayuda` | 12 | 613,2 | **183,0** | 156,3 | 2,4 | ⛔ **+63,0 KB** |
| `/offline` | 12 | 613,2 | **183,0** | 156,3 | 2,4 | ⛔ **+63,0 KB** |
| `/legal` y sus 7 subpáginas (`cookies`, `menores`, `no-es-terapia`, `privacidad`, `retencion`, `terminos`, `en`) | 12 | 613,2 | **183,0** | 156,3 | 2,4 | ⛔ **+63,0 KB** |

Con brotli —lo que sirve Vercel— el veredicto no cambia: el mejor caso son
156,3 KB, un 30 % por encima del presupuesto.

`/refugios` y `/perfil/[id]` cargan exactamente el mismo conjunto de chunks; la
diferencia entre ambas es cero.

### Dónde está el peso

**Base compartida — 11 chunks, en las 22 rutas: 607,6 KB crudos · 180,5 KB gzip
· 154,1 KB brotli.** Es decir: el presupuesto entero de §11 se agota, y se
rebasa, antes de que la ruta cargue nada suyo.

| chunk | crudo KB | gzip KB | brotli KB | qué es |
|---|---:|---:|---:|---|
| `0221vbwwh7ja9.js` | 227,1 | 70,8 | 60,6 | React DOM (runtime de Next) |
| `2vdiffh4q_30h.js` | 134,0 | 36,4 | 31,4 | cliente RSC / react-server-dom |
| `0pidzz95yzgwy.js` | 99,9 | 34,8 | 28,2 | **i18n de Darma + catálogos de mensajes** |
| `0ki31-boczgfy.js` | 40,6 | 9,1 | 7,9 | router de App Router |
| `0v23gu_jxs3jc.js` | 34,3 | 9,0 | 7,9 | runtime de Next |
| `2k1rc57z0aw93.js` | 33,4 | 7,3 | 6,3 | runtime de Next |
| `17ibq_m5i30zc.js` | 16,5 | 5,3 | 4,8 | runtime de Next |
| `turbopack-1xigsct5hmdp4.js` | 10,4 | 4,1 | 3,7 | runtime de Turbopack |
| `2-ldzzpc5qu2f.js` | 7,0 | 1,9 | 1,6 | runtime de Next |
| `2rnybmdiu29cf.js` | 2,5 | 1,1 | 0,9 | código de la app |
| `3mom73caugxj7.js` | 1,8 | 0,8 | 0,7 | código de la app |

Dos observaciones con nombre y apellidos, ambas verificadas sobre el artefacto:

1. **`0pidzz95yzgwy.js` lleva los DOS catálogos de idioma al cliente.**
   `messages/es.json` (65,9 KB) y `messages/en.json` (63,7 KB) están ambos
   dentro: se comprobó buscando literalmente cadenas de cada catálogo en el
   chunk y aparecen las de los dos. Todo el mundo descarga el idioma que no usa.
   Es el único trozo grande de la base compartida que es **código nuestro** y no
   framework.

2. **`2kct4ys1u2hki.js` — 244,9 KB crudos / 64,4 KB gzip — es
   `@supabase/supabase-js` con GoTrue y Realtime (phoenix/websocket) dentro.**
   No está en la base compartida, pero se carga en `/refugios`, `/perfil/[id]` y
   `/post/[id]`, y **es por sí solo el motivo de que esas tres rutas dupliquen el
   presupuesto**. Vale la pena comprobar si `/perfil/[id]` y `/post/[id]`
   necesitan de verdad el cliente de Realtime o si lo arrastran por un import
   compartido con refugios.

Chunks propios de ruta relevantes (ya descontada la base):

| chunk | crudo KB | gzip KB | rutas |
|---|---:|---:|---|
| `2kct4ys1u2hki.js` | 244,9 | 64,4 | `/refugios`, `/perfil/[id]`, `/post/[id]` |
| `2uqr8cfoz-wnl.js` | 40,9 | 12,2 | todas las privadas |
| `3jni1p20b0dwl.js` | 38,7 | 12,7 | `/refugios`, `/perfil/[id]` |
| `11jd-g-n1o60c.js` | 27,6 | 9,8 | `/feed` |

---

## (b) LCP medido (4G simulado, 3 pasadas, mediana)

Presupuesto: **< 2500 ms**.

| ruta | mín | **mediana** | máx | elemento LCP | veredicto |
|---|---:|---:|---:|---|---|
| `/` | 568 | **568** | 584 | `H1` | ✅ |
| `/ayuda` | 552 | **564** | 592 | párrafo de entrada | ✅ |
| `/offline` | 528 | **540** | 548 | mensaje | ✅ |
| `/legal` | 532 | **548** | 556 | `P` | ✅ |
| `/legal/cookies` | 588 | **592** | 592 | `DIV` | ✅ |
| `/legal/menores` | 544 | **580** | 592 | `DIV` | ✅ |
| `/legal/no-es-terapia` | 548 | **552** | 596 | `DIV` | ✅ |
| `/legal/privacidad` | 556 | **592** | 596 | `DIV` | ✅ |
| `/legal/retencion` | 576 | **576** | 588 | `DIV` | ✅ |
| `/legal/terminos` | 588 | **592** | 600 | `DIV` | ✅ |
| `/legal/en` | 536 | **588** | 592 | `P` | ✅ |
| `/perfil/[id]` | 684 | **700** | 768 | título de `EstadoVacio` | ✅ |
| `/publicar` | 756 | **772** | 824 | entradilla | ✅ |
| `/ranking` | 752 | **772** | 996 | `P` | ✅ |
| `/perfil/editar` | 764 | **768** | 1152 | pista del formulario | ✅ |
| `/post/[id]` | 772 | **776** | 1052 | cuerpo del hilo | ✅ |
| `/refugios` | 828 | **844** | 1224 | descripción de `EstadoVacio` | ✅ |
| `/feed` | 828 | **908** | 1244 | cuerpo de la tarjeta | ✅ |
| `/perfil` | 944 | **960** | **3080** | texto de insignia | ✅ mediana, ⚠️ ver abajo |
| `/animo` | 1196 | **1388** | **2968** | título de `FeedVertical` | ✅ mediana, ⚠️ ver abajo |
| `/entrar` | — | **NO REPORTADO** | — | — | ⚠️ ver abajo |
| `/onboarding` | — | **NO REPORTADO** | — | — | ⚠️ ver abajo |

**Las medianas cumplen todas.** Dos avisos honestos sobre esa afirmación:

- **`/animo` y `/perfil` tuvieron una pasada de 2968 ms y 3080 ms**, ambas por
  encima del presupuesto. Con solo 3 pasadas no se puede decir si es ruido de
  la máquina o una cola real, pero **`/animo` es la ruta más lenta de la app en
  mediana (1388 ms) y la que menos margen tiene**. Es la primera que se caerá
  del presupuesto cuando se añada CPU throttling o latencia de origen real.
- Recuerda el suelo optimista: sin estrangular CPU y con el servidor en la misma
  máquina. Estos números **no son** un LCP de campo.

### `/entrar` y `/onboarding` no emiten FCP ni LCP · causa demostrada

No es «no se pudo medir»: es que **Chromium no genera la entrada**. En esas dos
pantallas `performance.getEntriesByType('paint')` solo contiene `first-paint`,
nunca `first-contentful-paint`, y el `PerformanceObserver` de
`largest-contentful-paint` no recibe ninguna entrada, ni a los 2,5 s ni después.
El contenido está en el DOM, visible, dentro del viewport y con `opacity: 1`
computada al leerlo.

La causa es la clase **`fade-in`** de `app/globals.css`:

```css
@keyframes darma-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: darma-fade-in var(--dur) var(--ease) both; }
```

La animación arranca en `opacity: 0`, y Chromium descarta como «no contentful»
todo lo que se pinta con opacidad cero. Solo dos componentes la usan, y son
justo los dos que no reportan: `components/auth/PanelEntrada.tsx:128` y
`components/auth/AsistenteOnboarding.tsx:118`, ambos con
`className="card fade-in"`.

**Prueba A/B, mismo HTML servido, misma sesión, interceptando la respuesta para
quitar solo la clase:**

| caso | fade-in | FCP | LCP |
|---|---|---|---|
| `/onboarding` tal cual | sí | **NO REPORTADO** | **NO REPORTADO** |
| `/onboarding` con la clase quitada del HTML | no | **264 ms** | **264 ms** |
| `/entrar` con la clase quitada del HTML | no | **420 ms** | **420 ms** |
| `/ayuda` (referencia, nunca usa `fade-in`) | no | 168 ms | 168 ms |

Se descartó además que fuera cosa de `prefers-reduced-motion`: con
`reducedMotion: 'reduce'` (que deja la animación en 0,01 ms) el LCP **sigue sin
reportarse**. Lo que suprime la métrica es el fotograma inicial a `opacity: 0`,
no la duración.

Consecuencia práctica: la pantalla de entrada de Darma —la primera que ve todo
el mundo— **no aparece en ningún dato de campo de Web Vitals**. No es una
regresión de velocidad, es un agujero de instrumentación. Ambas pintan rápido
cuando se las deja medir: 420 ms y 264 ms.

---

## (c) Lo que quedó SIN medir, y por qué

| qué | estado | por qué |
|---|---|---|
| `/panel`, `/panel/activacion`, `/panel/crisis`, `/panel/curacion`, `/panel/economia`, `/panel/privacidad`, `/panel/reciprocidad`, `/panel/roles` | **PENDIENTE 1** | Exigen rol de administración. Sin sesión redirigen a `/entrar`; con la cuenta anónima devuelven 404 y el servidor registra `sin_permiso` (403 enmascarado). Lo que se midió en esas URLs era la pantalla de entrada o la de 404, **no la ruta**, así que no se apunta. Concederse el rol implicaba escribir en el Supabase compartido con otro agente y no se hizo. |
| `/moderacion` | **PENDIENTE 1** | Igual que las anteriores. |
| `/encuestas` | **PENDIENTE 1** | Igual que las anteriores (404 con cuenta normal). |
| `/refugios/[id]` | **PENDIENTE 2** | `GET /api/refuges` devuelve `items: []` en este entorno: no hay ningún refugio que abrir. Hace falta sembrar uno. |
| `/_not-found` | **PENDIENTE 3** | No se midió; no es pantalla principal de ningún bloque. |
| LCP en 4G **con CPU estrangulada** y origen remoto | **PENDIENTE 4** | Lo medido tiene la CPU libre y el servidor en `localhost`. Para un número que se pueda citar como «LCP en 4G» hace falta Lighthouse móvil (4× CPU) contra un despliegue de preview de Vercel. Los valores de arriba son un suelo, no el dato de campo. |
| LCP de `/entrar` y `/onboarding` **sin tocar el HTML** | **PENDIENTE 5** | Chromium no emite la métrica mientras `fade-in` esté puesta. Los 420 ms y 264 ms de la tabla A/B son con la clase retirada; sirven para probar la causa, **no** para dar por cumplido el presupuesto de esas dos rutas. |
| Consultas por render (≤ 3) y feed < 50 ms | **fuera de alcance** | Son las otras dos líneas de §11 y viven en `EXPLAIN.md`, que sigue en PENDIENTE. |

Nota sobre un 500 que apareció por el camino y no es del presupuesto: con una
sesión anónima **recién creada y sin onboarding completado**, `/perfil` y
`/perfil/editar` devuelven **HTTP 500**, no una redirección al onboarding. El
log del servidor lo dice claro:

```
content_views_user_id_fkey · Key (user_id)=(…) is not present in table "profiles"
```

Tras completar el onboarding las dos rutas devuelven 200 y son las que están
medidas en la tabla. Se apunta aquí porque se encontró midiendo, pero no se ha
tocado nada.

---

## (d) Lo que de verdad importa

1. **El presupuesto de 120 KB de §11 no lo cumple ninguna ruta, y no puede
   cumplirlo tal y como está montada la app.** 180,5 KB gzip / 154,1 KB brotli
   de base compartida ya lo rebasan solos. Cerrar un bloque «si su pantalla
   principal no excede 120 KB» es hoy una condición que nadie puede satisfacer
   tocando su propia pantalla. O se ataca la base, o el número de §11 deja de
   ser un presupuesto y pasa a ser un adorno.

2. **La palanca más grande que es código nuestro:** los dos catálogos de idioma
   completos (`es` + `en`, 129,7 KB crudos entre ambos) viajan al cliente en
   todas las rutas. Servir solo el idioma activo es el único recorte de la base
   compartida que no depende de Next.

3. **Las tres rutas que doblan el presupuesto lo hacen por una sola causa:**
   `@supabase/supabase-js` con Realtime, 64,4 KB gzip, en `/refugios`,
   `/perfil/[id]` y `/post/[id]`. Que un perfil ajeno y un hilo carguen el
   cliente de websockets merece una mirada.

4. **`/animo` es la ruta con menos margen de LCP** (mediana 1388 ms, con una
   pasada en 2968 ms). Es la que primero se saldrá del presupuesto en cuanto se
   mida en condiciones realistas de CPU.

5. **`/entrar` y `/onboarding` son invisibles para Web Vitals.** Se arregla
   cambiando el arranque de la animación (por ejemplo, animando solo
   `transform`, o partiendo de una opacidad no nula) sin renunciar al efecto.
