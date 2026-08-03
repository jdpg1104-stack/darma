# Pedidos entre bloques

Aquí se anota lo que necesitas **de otro bloque** en vez de editarlo tú. Añade
líneas al final; no reescribas las de otros. Quien sea dueño del bloque destino
las recoge y las cierra.

Formato: `- [ ] **De B0X → B0Y** · qué necesitas · por qué · quién lo pidió`

## Abiertos

- [ ] **De B07 → B00** · la RPC de latidos de reproducción es ahora la ÚNICA vía
      de escritura en `content_views`: la migración `0002` ya no concede UPDATE
      al cliente ni deja insertar filas con `completed = true`. Sin esa RPC, el
      karma de `content_completed` no se otorga nunca · 2026-08-03
- [ ] **De B01 → B00** · `/api/me` debe leer los campos privados con la función
      `mi_perfil_privado()` de `0001_core.sql`, no con un `select` sobre
      `profiles`: `authenticated` ya no tiene privilegio de columna sobre
      `karma_spendable`, `crystals` ni `listen_credits`, ni siquiera sobre su
      propia fila · 2026-08-03
- [ ] **De B11 → B19** · nadie escribe `crisis_events.human_reviewed` todavía;
      la métrica de cobertura del 100 % del panel depende de que B11 lo marque
      al cerrar cada caso · 2026-08-03

### B17 · Internacionalización

- [ ] **De B17 → HUMANO (producto / clínico / legal)** · **VERIFICAR LOS 24
      TELÉFONOS DE CRISIS** de `i18n/recursosCrisis.ts` contra la `fuente`
      oficial de cada uno antes de producción. **Ninguno está confirmado por una
      persona**: los de `lib/crisis.ts` se escribieron de memoria y B17 los ha
      reorganizado por país, no verificado. La lista exacta la da
      `recursosPendientesDeVerificacion()`; el gate es `tablaListaParaProduccion()`,
      que hoy devuelve `false`. Para registrar una verificación: poner nombre en
      `verificadoPor`, fecha de hoy en `verificadoEn` y quitar la línea de
      `PENDIENTES_DECLARADOS`. Un número equivocado en una pantalla de crisis es
      peor que no mostrar número · 2026-08-03
- [ ] **De B17 → F4** · envolver `next.config.ts` con el plugin de next-intl.
      Diff exacto (dos líneas, sin tocar nada más):
      ```diff
      +import createNextIntlPlugin from 'next-intl/plugin'
       import type { NextConfig } from 'next'
       ...
      -export default nextConfig
      +export default createNextIntlPlugin('./i18n/request.ts')(nextConfig)
      ```
      Mientras no llegue, B17 cierra en verde con `obtenerTraductor()` de
      `i18n/index.ts` · 2026-08-03
- [ ] **De B17 → F4** · `app/layout.tsx`: (a) el `lang` del `<html>` está
      **fijado a `"es"`**, así que un usuario en inglés recibe HTML mal
      etiquetado (afecta a lectores de pantalla y a la traducción automática);
      (b) falta el provider. Diff propuesto:
      ```diff
      +import { NextIntlClientProvider } from 'next-intl'
      +import { resolverLocale } from '@/i18n'
      +import { configuracionDePeticionParcial } from '@/i18n/request'
      ...
      -export default function RootLayout({ children }: ...) {
      -  return (
      -    <html lang="es" suppressHydrationWarning>
      -      <body>
      +export default async function RootLayout({ children }: ...) {
      +  const { locale, messages } = await configuracionDePeticionParcial(['comun', 'crisis', 'errores'])
      +  return (
      +    <html lang={locale} suppressHydrationWarning>
      +      <body>
      +        <NextIntlClientProvider locale={locale} messages={messages}>
       ...
      +        </NextIntlClientProvider>
      ```
      Cada ruta amplía el subárbol con `subarbolDeMensajes(locale, [...])`:
      mandar el catálogo entero al cliente se come el presupuesto de 120 KB de
      CONTRATOS §11 él solo · 2026-08-03
- [ ] **De B17 → B15** · `package.json` (que B17 no toca porque lo comparten seis
      sesiones): (a) añadir la dependencia `next-intl` (^4); (b) ampliar el glob
      del script `test`, que hoy es `"lib/**/*.test.ts"` y **no ejecuta las
      pruebas de `i18n/`** — propuesta:
      `node --test --experimental-strip-types "lib/**/*.test.ts" "i18n/*.test.ts"`;
      (c) opcional pero recomendado: un paso de CI que falle el despliegue a
      producción si `tablaListaParaProduccion()` devuelve `false` · 2026-08-03
- [ ] **De B17 → F3** · `lib/reciprocity.ts`: `reciprocityMessage()` devuelve una
      **frase en español ya resuelta** (incluido el plural), así que la UI no
      puede traducirla. Debería devolver **clave + parámetros**, p. ej.
      `{ clave: 'publicar.faltan', params: { n } }`. Las cuatro claves ya existen
      en los dos idiomas: `publicar.faltan` (plural ICU), `publicar.primeraVez`,
      `publicar.listo`, `publicar.enPausa` y `publicar.rechazoServidor`. La
      palabra «crédito»/«credit» no aparece en ninguna de las dos versiones y hay
      una prueba que lo vigila · 2026-08-03
- [ ] **De B17 → B00 / F3** · **los `ErrorCode` de CONTRATOS §4 y los de
      `lib/apiErrors.ts` no son los mismos**. El contrato dice
      `no_autenticado | sin_permiso | reciprocidad | no_encontrado |
      entrada_invalida | demasiadas_peticiones | contenido_bloqueado |
      saldo_insuficiente | error_interno` (9, en español); el código exporta
      `ApiErrorCode` con 12 valores en inglés (`unauthorized`, `pii_detected`,
      `crisis_intervention`…). `messages/*.json` sigue **el contrato**, así que
      hoy la UI no puede traducir lo que devuelve el servidor. Hace falta decidir
      cuál manda y alinear el otro; B17 adapta `messages/errores.*` en cuanto se
      decida · 2026-08-03
- [ ] **De B17 → B00** · extensión de contrato: `RecursoCrisis` lleva un campo
      más que el de la ficha B17, `verificadoPor: string | null`. Sin él,
      `verificadoEn` miente (una fecha reciente se lee como una verificación
      reciente, y no lo es). Es aditivo y no rompe a nadie · 2026-08-03
- [ ] **De B17 → F4 / B01 / B16** · seis archivos tienen copy escrito a pelo y no
      se puede traducir: `app/layout.tsx`, `app/page.tsx`,
      `components/auth/AsistenteOnboarding.tsx`, `components/auth/AvatarSemilla.tsx`,
      `components/auth/PanelEntrada.tsx`, `components/ui/MedidorKarma.tsx`
      (37 literales). Están anotados como deuda conocida en
      `i18n/literales.test.ts`; el guard ya falla ante cualquier archivo NUEVO.
      El catálogo con las 15 raíces de dominio está listo en `messages/` · 2026-08-03

## Cerrados

- [x] **B00** · Definir contratos compartidos antes de abrir las olas · sin esto
      dos bloques declaran el mismo tipo con formas distintas · 2026-08-03

---

## Bugs vistos fuera de tu bloque

No los arregles: el arreglo de otro es un conflicto de merge garantizado. Anótalos.

- **`lib/crisis.ts` (F3) · el país se deriva del idioma.** El JSDoc de
  `HELP_RESOURCES` dice que el país sale de `identity_vault.country_code` «o, en
  su defecto, **del locale del navegador**». Eso es exactamente el fallo que B17
  existe para impedir: con `Accept-Language: es-ES` un usuario en Estados Unidos
  recibiría el 024 en vez del 988. Nadie ha implementado todavía esa derivación
  —solo está escrita en el comentario—, así que el arreglo es barato: borrar esa
  frase y usar `recursosParaPais(await resolverPais())` de `@/i18n`.
  Visto por B17 · 2026-08-03
- **`lib/crisis.ts` (F3) · tabla de teléfonos duplicada y sin verificar.**
  `HELP_RESOURCES` / `INTERNATIONAL_FALLBACK` / `helpResourcesFor()` cubren lo
  mismo que `i18n/recursosCrisis.ts`, con datos escritos de memoria, con
  `verifiedAt: '2026-08-03'` (la fecha en que se escribieron, no en que se
  verificaron), sin `fuente`, sin idiomas de atención y **sin número de
  emergencias en PE, US ni GB**. Dos tablas de teléfonos de crisis en un repo
  significa que un día se corrige una y no la otra. Propuesta: `lib/crisis.ts`
  se queda con la detección (`assessCrisisRisk`, `escalate`) y reexporta
  `recursosParaPais` de `@/i18n`, o simplemente borra su tabla. B17 no lo toca
  porque `lib/` es de F3 · 2026-08-03
- **`components/ui/index.ts` (B16) · `tsc` roto en `main`:** importa
  `./BotonCrisis.tsx`, que no existe (2 errores TS2307). Visto por B17 mientras
  verificaba su bloque · 2026-08-03
- **`lib/ingest/fuentes.ts` (B08) · `tsc` roto en `main`:** 5 errores TS2741,
  falta `fallosConsecutivos` en las semillas de fuente. Visto por B17 · 2026-08-03

## Pedidos añadidos por B01 (2026-08-03)

- [ ] **De B01 → F4** · `proxy.ts` debe declarar `/api/auth/` como ruta pública.
      Hoy `PUBLIC_ROUTES` solo lleva `/auth/`, así que `POST /api/auth/anonimo`,
      `POST /api/auth/magic-link` y `GET /api/auth/callback` reciben un 401 del
      proxy ANTES de llegar al handler: entrar en Darma es imposible. Las tres
      llegan por definición sin sesión. `/api/auth/salir`, `/api/auth/perfil`,
      `/api/auth/alias-libre`, `/api/auth/2fa/*` y `/api/me` sí exigen sesión y
      deben seguir cerradas · 2026-08-03
- [ ] **De B01 → F4** · `.env.example` necesita `IDENTITY_PEPPER` (HMAC del
      contacto en `identity_vault`) y `TOTP_ENC_KEY` (32 bytes hex, AES-256-GCM
      del secreto de 2FA). Hoy solo está `IDENTITY_HASH_SALT`, que ningún módulo
      lee. ⚠️ `IDENTITY_PEPPER` NO se rota sin plan de re-hash: cambiarla pone a
      cero la detección de multicuenta en silencio (razonado en
      `lib/auth/identidad.ts`) · 2026-08-03
- [ ] **De B01 → B00** · CONTRATOS §4 y `lib/apiErrors.ts` (F3) discrepan: el
      contrato fija `{ ok, code, message, retryAfter }` con códigos en español
      (`no_autenticado`…) y el helper de F3 devuelve `{ error, message, traceId }`
      con códigos en inglés (`unauthorized`…). B01 no puede editar ninguno de los
      dos, así que ha implementado CONTRATOS §4 en `lib/auth/errores.ts` +
      `respuestas.ts` + `http.ts`. Hay que unificar antes de la ola 2, o cada
      bloque elegirá una forma distinta · 2026-08-03
- [ ] **De B01 → B00** · `PerfilPublico` y `Yo` viven provisionalmente en
      `lib/auth/perfil.ts` porque no existe un módulo de tipos compartido.
      Deberían subir a `lib/tipos.ts` (dueño B00) para que B02–B20 importen el
      mismo y no cada uno el suyo · 2026-08-03
- [ ] **De B01 → B15** · `lib/supabase/database.types.ts` debe regenerarse
      DESPUÉS de aplicar `0101_b01_auth.sql`: hasta entonces no contiene
      `profiles.entry_level`, ni `auth_totp`, ni las funciones `mi_sesion()`,
      `crear_perfil()` y `alias_disponible()`. Mientras tanto, `FilaSesion` está
      declarada a mano en `lib/auth/session.ts` (con el comentario que dice por
      qué y qué sustituirla) · 2026-08-03
- [ ] **De B01 → F3** · `lib/anonymity.ts` exporta `deriveAlias` /
      `deriveAvatarSeed` / `createAnonymousIdentity`, no `generarAlias()` ni
      `generarSemillaAvatar()` como dice la ficha B01. B01 usa los nombres reales;
      solo hay que corregir la ficha o renombrar (no ambas) · 2026-08-03
- [ ] **De B01 → B16** · `/entrar` y `/onboarding` usan HTML plano con las
      variables CSS de `globals.css` porque `components/ui/*` aún no existe
      (además hoy `components/ui/index.ts` no compila). Cuando B16 cierre, hay
      que sustituir por `Boton`, `Tarjeta`, `Chip` y `Avatar` — el avatar
      generado está en `components/auth/AvatarSemilla.tsx` y es SVG puro sin
      dependencias, listo para moverse a `components/ui` si B16 lo prefiere ·
      2026-08-03
- [ ] **De B01 → B02** · tras el onboarding y tras el callback se redirige a
      `/feed`, que todavía no existe. Sin esa ruta, terminar el alta acaba en un
      404 · 2026-08-03
- [ ] **De B01 → B15** · el paquete `server-only` no está en `package.json`, así
      que `lib/auth/identidad.ts` y `lib/auth/totp.ts` (que leen secretos) usan
      una guarda de runtime `typeof window !== 'undefined'` en vez de
      `import 'server-only'`, como ya hace `lib/supabase/admin.ts`. Si se añade
      la dependencia, conviene poner la directiva en los tres · 2026-08-03
- [ ] **De B08 → F4** · las tres entradas de cron para `vercel.json` (B08 no lo
      edita). Minutos distintos y no en punto a propósito: no deben solaparse
      entre sí ni competir con el pico global de la hora en punto ·
      `{"path":"/api/cron/content/videos","schedule":"17 */6 * * *"}`,
      `{"path":"/api/cron/content/articulos","schedule":"37 */6 * * *"}`,
      `{"path":"/api/cron/content/reverificar","schedule":"23 4 * * *"}` ·
      2026-08-03
- [ ] **De B08 → B07** · ya hay catálogo: `content_items` se llena por
      `/api/cron/content/*` con `state='approved'` solo si el cribado dice
      `seguro` Y el oEmbed dice `embebible`. `topic` sale de una taxonomía
      CERRADA (`ansiedad`, `duelo`, `sueño`, `soledad`, `autoestima`,
      `respiración`, `relaciones`, `trabajo`, o `null`): los chips del feed
      vertical deben filtrar por esa lista exacta, exportada en
      `lib/ingest/clasificar.ts` como `TAXONOMIA`. `duration_seconds` llega
      `null` en vídeo (el feed Atom no lo trae) y `thumbnail_url` solo puede ser
      de `i.ytimg.com` o Supabase Storage · 2026-08-03
- [ ] **De B08 → B00** · discrepancia entre `CONTRATOS.md` §4 y el
      `lib/apiErrors.ts` que existe: el documento define
      `{ ok:false, code, message, retryAfter? }` con códigos en español
      (`no_autenticado`, `error_interno`), y el archivo devuelve
      `{ error, message, traceId }` con códigos en inglés (`unauthorized`,
      `internal`). Las rutas de B08 usan los helpers REALES, como manda §4 («los
      helpers viven en lib/apiErrors.ts, úsalos»). Hay que alinear una de las dos
      cosas · 2026-08-03
- [ ] **De B08 → B15** · `lib/supabase/database.types.ts` debe regenerarse
      DESPUÉS de aplicar `0108_1_ingesta.sql`: hoy no contiene `ingest_sources`,
      `ingest_log`, `ingest_state`, `ingest_model_budget` ni la función
      `ingest_consume_model_budget()`. Mientras tanto, `lib/ingest/almacen.ts`
      declara a mano `FilaFuente` y `FilaContenido` (con el comentario que dice
      por qué y qué las sustituye) · 2026-08-03
- [ ] **De B08 → B00 / F4** · la capa 2 del filtro de seguridad necesita saber
      CONTRA QUÉ PROVEEDOR habla. `.env.example` define `MODERATION_API_KEY`
      pero no un endpoint, así que `lib/ingest/seguridad.ts` usa
      `MODERATION_API_URL` (POST JSON, `Authorization: Bearer`, respuesta
      `{seguro:boolean, confianza:number}`). Sin esa variable el sistema falla
      CERRADO —todo queda en `pending`, nada se aprueba—, que es lo correcto
      pero deja el feed vacío. Hay que fijar el proveedor y añadir la variable a
      `.env.example` (que B08 no edita) · 2026-08-03
- [ ] **De B08 → B19** · la cola de curación humana (`state='pending'`,
      `idx_content_pending`) hoy solo se puede leer con
      `scripts/ingest/revisar-pendientes.ts`. Aprobar o rechazar exige
      `service_role`: el panel de admin necesita una pantalla para esto, o la
      cola crecerá sin que nadie la vacíe · 2026-08-03
