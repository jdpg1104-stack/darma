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
- [ ] **De B11 → B00 / F4** · `@anthropic-ai/sdk` NO está en `package.json` y
      B11 no lo edita. Mientras tanto `lib/ai/cliente.ts` define un puerto
      estructural (`ClienteIA`) y carga el SDK con `import()` de especificador
      variable, de modo que `tsc` pasa sin el paquete y sin clave. Al añadirlo:
      (a) el import puede volverse estático y `obtenerCliente()` síncrona —
      ningún llamante cambia, todos ya hacen `await`—, y (b) se puede sustituir
      el JSON Schema escrito a mano de `lib/ai/esquemas.ts` por
      `zodOutputFormat()` + `client.messages.parse()`. `interpretarVeredicto`
      debe seguir siendo la última palabra en cualquier caso · 2026-08-03
- [ ] **De B11 → B00 / F4** · faltan tres variables en `.env.example`:
      `MODERATION_MODEL` (opcional, por defecto `claude-opus-5`),
      `MODERATION_BUDGET_USD_DAY` (opcional, por defecto 600) y
      `MODERATION_ADMIN_IDS` (allowlist de uuids de moderador, separada por
      comas). NINGUNA lleva prefijo `NEXT_PUBLIC_`. Sin `MODERATION_ADMIN_IDS`
      el panel `/moderacion` no lo abre nadie, que es el fallo correcto · 2026-08-03
- [ ] **De B11 → B19** · el rol de moderador es hoy una allowlist de uuids en
      variable de entorno (`lib/ai/acceso.ts`). En cuanto B19 defina el rol en
      la base de datos, `esModerador()` debe pasar a leerlo de ahí; la firma
      pura (`esModeradorSegun(userId, allowlist)`) está pensada para que el
      cambio sea de una línea · 2026-08-03
- [ ] **De B11 → B08 / B14 / F4** · falta el cron de reproceso
      `/api/cron/moderacion-pendiente`, que debe releer los flags
      `signal='ai_unavailable'` en estado `pending` y volver a pasarlos por
      `evaluarContenido()` (con `omitirLimiteUsuario: true`). Sin él, todo lo
      que se publique mientras el clasificador esté caído se queda sin validar
      para siempre: la voz se abre pero el karma no se recupera nunca. La
      entrada de `vercel.json` no la escribe B11 · 2026-08-03
- [ ] **De B11 → F2 / B19** · la auditoría de cada decisión automática se
      escribe hoy en `moderation_flags` con `state='dismissed'` cuando no es
      accionable (para no ensanchar `idx_moderation_queue`, que es parcial
      sobre `state='pending'`). Funciona, pero a 100 000 clasificaciones/día
      esa tabla mezcla dos cosas distintas. Convendría una tabla
      `ai_decisions` con columnas tipadas (modelo, prompt_version, tokens,
      latencia, coste) y su propia política de retención · 2026-08-03
- [ ] **De B11 → B17 (recordatorio, no bloqueante)** · los 24 recursos de
      `i18n/recursosCrisis.ts` siguen con `verificadoPor: null` y
      `tablaListaParaProduccion()` devuelve `false`. B11 los muestra igualmente
      (una tarjeta de crisis vacía es un callejón sin salida) pero añade el
      aviso «si alguno no responde, prueba con el siguiente» al mensaje y marca
      `SIN_VERIFICACION_HUMANA` en `crisis_events.resources_shown`. Ese marcador
      desaparece solo cuando alguien con nombre y apellidos verifique la tabla · 2026-08-03
- [ ] **De B11 → B03 / B04** · `evaluarContenido()` de `lib/ai/pipeline.ts` es
      el único punto de entrada. Contrato del flujo obligatorio en comentarios
      (trampa 3 de la ficha): insertar SIEMPRE con `is_validated = false`,
      llamar a `evaluarContenido()`, y solo si devuelve `validado: true` hacer
      un `UPDATE is_validated = true` **con el cliente admin** (la migración
      0004 cerró esa columna al cliente). Ese `UPDATE` puede violar
      `uq_comments_one_listen_per_post`: hay que capturarlo y tratarlo como «ya
      escuchaste a esta persona aquí», no como error interno · 2026-08-03

### B03 · Publicar y gate de reciprocidad

- [ ] **De B03 → F3 (crítico, afecta a B02/B04/B05)** · la política `posts_read`
      de `0001_core.sql` consulta `profiles.shadow_banned`, y ese mismo archivo
      revoca el `select` sobre `profiles` y lo reconcede sin esa columna. Las
      expresiones de una política se evalúan con los privilegios de quien
      consulta, así que **`authenticated` no puede leer `posts` en absoluto**:
      cualquier `select`, cualquier `insert ... returning` y cualquier
      `update ... where` sobre `posts` devuelve `42501 permission denied for
      table profiles`. Verificado contra `darma-dev` con una sesión real. Rompe
      el feed entero, no solo B03. El arreglo natural es una función
      `security definer` (p. ej. `esta_en_shadow_ban(uuid)`) usada dentro de la
      política, pero rehacer la política de lectura de `posts` es un cambio que
      usan otros bloques y no se hace unilateralmente. B03 lo sortea con las RPC
      de `0103_1_b03_publicar.sql` · 2026-08-03
- [ ] **De B03 → B01** · `codigoDesdePostgres()` de `lib/auth/errores.ts` traduce
      **todo** `23514` a `reciprocidad`. En `posts` hay DOS 23514 distintos: el
      del trigger `trg_posts_reciprocity` (mensaje `reciprocidad: …`) y el CHECK
      `char_length(body) between 20 and 5000` (mensaje `new row for relation
      "posts" violates check constraint "posts_body_check"`, capturado literal de
      la base). Con esa función, a quien escribe tres palabras se le dice que le
      faltan escuchas. B03 traduce con su propia
      `codigoDesdeErrorDePost()`; conviene arreglarlo en el común antes de que
      otro bloque lo reutilice · 2026-08-03
- [ ] **De B03 → F3** · partir `lib/anonymity.ts` en dos. `detectPii()` /
      `assertNoPii()` son puros e isomorfos, pero el módulo hace
      `import { randomBytes } from 'node:crypto'` para `createIdentitySeed()`, así
      que un componente `'use client'` que lo importe arrastra `node:crypto` al
      bundle del navegador. Mientras tanto, `components/composer/avisoPii.ts`
      duplica los cuatro patrones **solo para el aviso de cortesía**; la barrera
      real sigue siendo `assertNoPii()` en el servidor · 2026-08-03
- [ ] **De B03 → F3** · `lib/crisis.ts` exporta `assessCrisisRisk()`, pero las
      fichas de bloque (B03 §6, CONTRATOS §9) hablan de `evaluarRiesgo()`. B03
      usa un adaptador local en `app/api/posts/_dominio/publicar.ts` que no
      reimplementa ni una regla. Igual con `assertNoPii`, que la ficha B03 sitúa
      en `lib/moderation.ts` y en realidad vive en `lib/anonymity.ts` ·
      2026-08-03
- [ ] **De B03 → F3** · `RATE_LIMITS.createPost` de `lib/rateLimit.ts` fija 10/h;
      la ficha B03 exige 5/h y su prueba nº 7 comprueba la sexta publicación.
      B03 usa sus propios números en `app/api/posts/_dominio/servidor.ts`. Hay
      que unificar el valor en un solo sitio · 2026-08-03
- [ ] **De B03 → B15** · regenerar `lib/supabase/database.types.ts` DESPUÉS de
      `0103_1_b03_publicar.sql`: hoy no contiene `b03_publicar_post`,
      `b03_editar_post` ni `b03_retirar_post`. Mientras tanto las rutas declaran
      a mano la fila que devuelven, con el comentario que dice por qué ·
      2026-08-03
- [ ] **De B03 → F4** · `SUPABASE_SERVICE_ROLE_KEY` está VACÍA en `.env.local`.
      `POST/PATCH/DELETE /api/posts` la necesitan (igual que `/api/me` de B01):
      sin ella las rutas devuelven `error_interno`. Se copia a mano desde el
      panel de Supabase · 2026-08-03
- [ ] **De B03 → F4/B00** · `app/(app)/layout.tsx` todavía no existe. B03 monta
      `BotonCrisis` en `app/(app)/publicar/layout.tsx` para cumplir CONTRATOS §9.
      Cuando exista el layout común, el de `publicar` sobra y se retira en una
      línea · 2026-08-03
- [ ] **De B03 → F4** · `/publicar` debe estar en las rutas privadas de
      `proxy.ts` (exige sesión) y `/ayuda` en las públicas, que es a donde apunta
      la acción inmediata de la tarjeta de recursos · 2026-08-03
- [ ] **De B04 → B11** · el punto de extensión está listo: `ValidadorComentario`
      en `app/api/comments/tipos.ts` y la implementación por defecto
      (`ValidadorHeuristico`, sobre `lib/moderation.ts`) en
      `app/api/comments/validador.ts`. Para enchufar el clasificador basta con
      sustituir `validadorPorDefecto`; ninguna ruta cambia. La firma del
      contrato es `validar(texto)`; se le ha añadido un segundo parámetro
      OPCIONAL `contexto?: { postBody?, previosDelAutor? }` porque dos señales
      reales de `lib/moderation.ts` —`echoes_post` y `self_repetition`— no se
      pueden calcular mirando solo el texto. Una implementación con la firma
      exacta de la ficha sigue siendo asignable, así que B11 puede ignorarlo ·
      2026-08-03
- [ ] **De B04 → B03** · `components/thread/BotonApoyo.tsx` llama a
      `POST/DELETE /api/posts/[id]/voto`, que todavía no existe. El componente
      es optimista y revierte si la respuesta no es 2xx, así que no rompe la
      pantalla mientras tanto. Recordatorio del contrato: ese voto solo mueve
      `posts.upvote_count`; **un apoyo no da karma y no cuenta como escucha** ·
      2026-08-03
- [ ] **De B04 → F4 / el dueño de `app/(app)/layout.tsx`** · ese layout no
      existe aún y CONTRATOS §9 exige `BotonCrisis` en todos los de `app/(app)`.
      B04 lo ha puesto en `app/(app)/post/layout.tsx` para no dejar el hilo sin
      él. Cuando llegue el layout del grupo con su propio `BotonCrisis`, borrad
      el de `post/` o saldrán dos · 2026-08-03
- [ ] **De B04 → B00 / F3** · dos límites para la misma acción:
      `RATE_LIMITS.createComment` de `lib/rateLimit.ts` dice 30/h y la ficha B04
      dice 20/h. Manda `app/api/comments/limites.ts` (20/h) para las rutas de
      este bloque. Hay que decidir cuál es el bueno y dejar uno solo ·
      2026-08-03
- [ ] **De B04 → B00** · misma discrepancia que ya anotó B08 entre CONTRATOS §4
      (`{ ok, code, message }`, códigos en español) y `lib/apiErrors.ts`
      (`{ error, message, traceId }`, códigos en inglés). B04 usa los helpers de
      B01 (`lib/auth/http.ts` + `lib/auth/respuestas.ts`), que implementan §4 al
      pie de la letra, para que el hilo hable el mismo idioma que `/api/me` ·
      2026-08-03
- [ ] **De B04 → cimientos (F1)** · `posts.reply_count` no baja nunca. El
      trigger `comments_on_validated()` solo suma al validar y no hay ninguno
      para el borrado blando, así que `DELETE /api/comments/[id]`
      (`state = 'removed'`) deja el contador alto y el `hot_score` inflado. No
      se toca 0001 desde aquí; necesita una migración de cimientos con un
      trigger `after update of state` · 2026-08-03
- [ ] **De B04 → B15** · `0104_1_hilo.sql` añade la política `comments_update_own`
      que faltaba: 0001 concedía `grant update (body, state) on comments` sin
      ninguna política de UPDATE, de modo que editar o retirar un comentario
      devolvía 200 sin escribir nada (el mismo fallo silencioso que 0004
      documenta para el INSERT, en el otro sentido). Verificado contra la base:
      el autor edita su fila, un tercero edita 0 filas. Conviene un caso en
      `supabase/tests/*.sql` · 2026-08-03
- [ ] **De B04 → B15** · `lib/supabase/database.types.ts` sigue sin la función
      `marcar_comentario_util()` de `0104_2_marcar_util.sql`. Mientras tanto,
      `app/api/comments/[id]/util/route.ts` declara a mano la fila que devuelve
      (`FilaMarca`) · 2026-08-03
- [ ] **De B04 → B07** · `npx tsc --noEmit` falla hoy en
      `components/video/TarjetaVideo.tsx(73,36)`: `ItemVideo` no es asignable a
      `CandidatoEmbed` (le faltan `platform` y `external_id`). No es de B04 y no
      se ha tocado; el resto del árbol compila · 2026-08-03
- [ ] **De B05 → B00 / F1** · `authenticated` no tiene privilegio de SELECT
      sobre `profiles.listens_given` ni `profiles.posts_published`, así que el
      **perfil ajeno no puede mostrarlos** (comprobado contra `darma-dev` con
      dos sesiones reales: 403 `42501 permission denied`). La ficha B05 los
      declaraba «contadores públicos» y el contrato `PerfilAjeno` los incluía;
      B05 los ha QUITADO del tipo en vez de devolverles el `grant`, porque
      reconceder desde el bloque que quiere pintarlas unas columnas que el
      endurecimiento quitó a propósito deshace una decisión de seguridad sin que
      nadie lo relacione después. Hace falta decidir: (a) son públicos de verdad
      y el sitio de arreglarlo es el esquema, o (b) no lo son y la ficha B05 y
      `CONTRATOS.md` deben decirlo. Afecta a B06 (ranking de escuchas) · 2026-08-03
- [ ] **De B05 → B00** · el presupuesto de «3 consultas para el perfil propio»
      de la ficha ya no es alcanzable: son 4 (`profiles` público +
      `mi_perfil_privado()` + `mi_resumen_karma()` + primera página del ledger).
      La cuarta existe porque el endurecimiento partió en dos lo que antes era
      un solo `select`. Se puede volver a 3 si `mi_perfil_privado()` (dueño F1)
      devuelve además `streak_days` y `streak_last_date`; B05 no la edita porque
      es de 0001 y otro bloque podría reemplazarla a la vez · 2026-08-03
- [ ] **De B05 → F3 / B00** · `check_rate_limit()` está concedida solo a
      `service_role`, así que la capa 2 del rate limiting exige el cliente
      ADMIN. La ficha B05 prohíbe el admin en todo el bloque, de modo que
      `components/perfil/limites.ts` se queda en la capa de memoria (por
      instancia): con N instancias en Vercel el límite efectivo es N × el
      configurado. Hace falta una vía de rate limiting que no obligue a
      `service_role` — conceder la RPC a `authenticated` es defendible, porque
      cuenta y no lee datos de nadie · 2026-08-03
- [ ] **De B05 → F4 / B02** · no existe `app/(app)/layout.tsx`. B05 no lo crea
      (crear el layout del grupo desde un bloque impone navegación a las cinco
      rutas hermanas), así que ha puesto un `app/(app)/perfil/layout.tsx` con
      `BotonCrisis` para cumplir CONTRATOS §9. Cuando exista el del grupo, los
      dos se anidan y basta con borrar el `<BotonCrisis>` del de B05 · 2026-08-03
- [ ] **De B05 → B15** · regenerar `lib/supabase/database.types.ts` DESPUÉS de
      `0105_1_b05_perfil.sql`: hoy no contiene `profiles.streak_days`,
      `profiles.streak_last_date`, `mi_resumen_karma()` ni
      `mi_historial_karma()`. Mientras tanto `components/perfil/tipos.ts`
      declara a mano `FilaPerfilPublica`, `FilaPerfilPrivada`, `FilaResumenKarma`
      y `FilaEventoKarma`, con el comentario que dice por qué y qué las
      sustituye · 2026-08-03
- [ ] **De B05 → B00** · los módulos puros de `components/perfil/` importan
      `../../lib/karma.ts` con ruta relativa de dos niveles, que CONTRATOS §1
      desaconseja. Es obligado: `node --test` no resuelve el alias `@/` del
      tsconfig, y la alternativa —copiar los umbrales de nivel— la prohíbe
      CONTRATOS §8, que es la regla más fuerte de las dos. Mismo precedente que
      `scripts/security/guardEconomia.ts` (B15). Si B00 monta un `imports` de
      package.json o un loader para los tests, se cambia en un sitio · 2026-08-03
- [ ] **De B05 → B00** · B05 usa los helpers de `lib/auth/**` (`manejarRuta`,
      `sobreOk`, `ErrorApi`) y no `lib/apiErrors.ts`, porque son los que
      implementan la forma `{ ok, code, message, retryAfter }` de CONTRATOS §4
      que exige el contrato de la ficha. Es la misma divergencia que ya anotó
      B08 desde el otro lado; al resolverla, B05 tiene tres rutas y una Server
      Action que cambiar · 2026-08-03
- [ ] **De B07 → F4** · `app/(app)/layout.tsx` no existe todavía. CONTRATOS §9
      exige `BotonCrisis` en TODOS los layouts de `app/(app)`, así que
      `app/(app)/animo/page.tsx` lo monta él mismo. Cuando exista el layout, hay
      que quitarlo de la página para que no salga duplicado · 2026-08-03
- [ ] **De B07 → B01 / B17** · el feed de `/animo` filtra por `content_items.language`
      y hoy usa `'es'` fijo (parámetro `?idioma=` opcional). Hace falta un
      `idiomaDeSesion()` —o un campo de idioma en `mi_sesion()`— para servir el
      catálogo en el idioma real de la persona. Mientras tanto, quien no tenga
      español ve un feed vacío · 2026-08-03
- [ ] **De B07 → B08** · `duration_seconds` llega NULL en los vídeos ingeridos por
      feed Atom. B07 supone 60 s (`DURACION_POR_DEFECTO_S` en
      `lib/video/acreditacion.ts`, y el mismo `coalesce(..., 60)` en la migración
      `0107_1`). Es una suposición conservadora, no una medida: con un vídeo real
      de 8 minutos el +1 se concede a los 54 s. Si la ingesta pudiera traer la
      duración (oEmbed no la da; `videos.list` sí, pero gasta cuota), el umbral
      del 90 % sería exacto · 2026-08-03
- [ ] **De B07 → B15** · `lib/supabase/database.types.ts` debe regenerarse tras
      `0107_1_b07_reproduccion.sql`: hoy no contiene `content_sessions` ni las
      funciones `abrir_sesion_contenido`, `latido_contenido`,
      `completar_contenido`, `barrer_sesiones_contenido` ni `feed_animo`.
      Mientras tanto `lib/video/tipos.ts` declara `FilaFeed` a mano · 2026-08-03
- [ ] **De B07 → B15** · añadir a `supabase/tests/*.sql` la prueba de regresión
      del farmeo de contenido, que hoy solo está verificada a mano contra
      `darma-dev`: con rol `authenticated` y un JWT real, deben fallar con 42501
      el `insert into content_views (..., completed)`, el `update content_views
      set completed`, el `select from content_sessions` y el
      `select completar_contenido(...)`. Es la invariante entera del bloque:
      si un día alguien concede `update (completed)` "para arreglar algo", toda
      la validación de tiempo pasa a ser decorativa · 2026-08-03
- [ ] **De B07 → B14** · falta el `EXPLAIN ANALYZE` del feed con 1 M de filas en
      `content_views`. Con el catálogo real (500 ítems) y `content_views` vacía
      el plan ya es `Index Scan using idx_content_feed` + sonda por la PK de
      `content_views` (0,7 ms, sin `Seq Scan`), pero el número que pide
      CONTRATOS §11 exige la siembra de B14 · 2026-08-03
- [ ] **De B07 → B00** · `HANDOFF/B07.md` §1a pide `revoke update (completed,
      completed_at) on content_views from authenticated`. Ya no aplica: la
      corrección de auditoría de `0002` + `0004` dejó a `authenticated` sin
      NINGÚN privilegio de UPDATE sobre esa tabla y sin política de UPDATE, así
      que `0107_1` no revoca nada (repetirlo sería ruido) y solo aporta la RPC de
      latidos que la ficha da por hecha. Conviene actualizar la ficha para el
      próximo que la lea · 2026-08-03
- [ ] **De B07 → B00** · la firma real es `completar_contenido(p_user, p_content,
      p_session)`, no la `(p_content, p_session)` de la ficha: bajo `service_role`
      —la única identidad que puede ejecutarla— `auth.uid()` es NULL, así que el
      usuario tiene que entrar por parámetro. El `p_user` sale SIEMPRE de
      `requireSesion()`, nunca del cuerpo de la petición · 2026-08-03
- [ ] **De B07 → B05 / B13** · lo que exporta este bloque está en
      `lib/video/index.ts` (tipos, `urlEmbed`/`urlEmbedDeItem`, `urlMiniatura`,
      `objetivoCompletado`) y en `components/video/index.ts` (`TarjetaVideo` para
      abrir un vídeo suelto desde una push). `lib/video/servidor.ts` NO está en
      el barril a propósito: importa el cliente `service_role` · 2026-08-03

## Pedidos añadidos por B02 · Feed «Para ti» (2026-08-03)

- [x] **De B02 → F1 / B00** · **`posts_read` era imposible de ejecutar para
      `authenticated`, y con ella el feed entero.** La política de `0001_core.sql`
      llevaba en el `USING` un `not exists (select 1 from public.profiles p where
      p.id = posts.author_id and p.shadow_banned)`, pero ese mismo archivo hace
      `revoke select on public.profiles` y vuelve a conceder solo las columnas
      públicas — `shadow_banned` NO está entre ellas. Una expresión de política
      RLS se evalúa con los privilegios de QUIEN CONSULTA, así que **cualquier
      `select` sobre `posts` desde una sesión real moría con
      `42501: permission denied for table profiles`**. Comprobado en vivo contra
      `darma-dev` con `set role authenticated` + `request.jwt.claims`. No es un
      caso raro: era el 100 % de las lecturas del feed, del hilo y del perfil.
      **CERRADO durante esta misma sesión por otro bloque**, que añadió
      `public.esta_silenciado(uuid)` (`stable security definer`, el mismo patrón
      que `is_refuge_member` de `0002`) y reescribió la política. Se deja anotado
      porque explica por qué la medición de B02 se hizo en dos tandas y porque la
      lección general merece quedar escrita: **una política RLS no puede leer una
      columna que el rol consultante no tiene concedida; si necesita una, va
      dentro de una función `security definer`** · 2026-08-03
- [ ] **De B02 → B15 / B14** · `esta_silenciado(author_id)` se evalúa **una vez
      por fila devuelta** en el `Filter` del index scan del feed (se ve en el
      `EXPLAIN` de B02). Con `profiles` sano son 20 lookups por PK y no se nota
      (2,3 ms de página). Pero durante la siembra, con `profiles` inflada
      (90 000 tuplas muertas sobre 21 vivas), el planificador metió un **seq scan
      dentro de la función** y la misma consulta pasó de 2,3 ms a **34 ms con
      17 694 buffers**. A escala real eso significa dos cosas: (a) `profiles`
      necesita autovacuum agresivo, porque el trigger de reciprocidad la
      actualiza en CADA publicación; (b) conviene un índice parcial
      `on profiles (id) where shadow_banned` para que la función sea un
      index-only scan diminuto en vez de depender del tamaño de la tabla.
      No lo añade B02: `profiles` no es suyo · 2026-08-03
- [ ] **De B02 → B03** · falta `POST/DELETE /api/posts/:id/voto`. El botón de
      voto de `components/feed/BotonVoto.tsx` es optimista y ya llama a esa ruta;
      mientras no exista recibe un 404, revierte y la tarjeta se queda como
      estaba (se degrada a «no se pudo votar», nunca a un contador que miente).
      El feed ya trae `heVotado` resuelto en la propia consulta de posts, así que
      la ruta solo tiene que insertar/borrar en `post_votes`: el contador lo
      mantiene el trigger `post_votes_sync` · 2026-08-03
- [ ] **De B02 → B03 / B04** · las tarjetas enlazan a `/post/{id}` (hilo, B04) y
      el estado vacío del feed a `/publicar` (B03). Ninguna de las dos rutas
      existe todavía: hoy son 404 · 2026-08-03
- [ ] **De B02 → B09** · el hueco de la encuesta está reservado y tipado:
      `ElementoFeed = { tipo: 'encuesta'; encuestaId }`, slot fijo 8 de cada
      página, y el placeholder es `components/feed/SlotEncuesta.tsx`. B09 debe
      sustituir **el cuerpo** de ese componente conservando la prop. ⚠️ Hidratar
      la encuesta NO puede añadir una consulta por tarjeta (sería un N+1 en la
      pantalla más cargada de la app): una sola consulta por página con
      `in (ids)`. El id ya viene resuelto por `feed_encuestas_keyset` · 2026-08-03
- [ ] **De B02 → B15** · `lib/supabase/database.types.ts` debe regenerarse
      DESPUÉS de `0102_1_feed_keyset.sql`: hoy no contiene `feed_keyset`,
      `feed_keyset_nuevo`, `feed_contenido_keyset` ni `feed_encuestas_keyset`.
      Mientras tanto, `app/api/feed/consulta.ts` declara a mano `FilaFeedPost`,
      `FilaFeedContenido` y `FilaFeedEncuesta`, con el comentario que dice por
      qué y qué las sustituye · 2026-08-03
- [ ] **De B02 → F4 / B00** · el layout de `app/(app)` no existe, así que B02 ha
      puesto `BotonCrisis` en `app/(app)/feed/layout.tsx` para no servir la
      pantalla más cargada de la app sin acceso a recursos de ayuda
      (CONTRATOS §9). Cuando exista `app/(app)/layout.tsx` con el botón, el
      layout del feed puede quedarse solo con el `<main>` · 2026-08-03
- [ ] **De B02 → B17 / B01** · el idioma del contenido curado sale hoy de la
      cabecera `Accept-Language` (`idiomaDeContenido()` en
      `app/api/feed/validacion.ts`). Debería salir de la preferencia GUARDADA de
      la persona: la cabecera del navegador es una conjetura, y en el feed de
      bienestar equivocarse significa servir un catálogo que no se entiende ·
      2026-08-03
- [ ] **De B02 → B00** · tercera confirmación de la divergencia ya abierta por
      B01 y B08 entre `CONTRATOS.md` §4 y `lib/apiErrors.ts`. B02 **no** ha
      escrito una cuarta implementación: consume la de B01
      (`lib/auth/errores.ts` + `respuestas.ts` + `http.ts`), que es la que
      implementa el contrato literal `{ ok, code, message, retryAfter }` que la
      propia ficha B02 exige en su §Contrato. Si B00 unifica hacia
      `lib/apiErrors.ts`, hay que tocar `app/api/feed/route.ts`,
      `consulta.ts` y `validacion.ts` · 2026-08-03
- [ ] **De B02 → B00** · nombre de migración: la ficha B02 pedía
      `supabase/migrations/0004_b02_feed.sql`, pero `0004_insert_columnas.sql` ya
      existe y está aplicada. Se ha usado `0102_1_feed_keyset.sql`, que es el
      rango que reserva `PARALELO.md` §3 para B02. Conviene corregir la ficha ·
      2026-08-03
- [ ] **De B02 → B15** · el script `test` de `package.json` sigue siendo
      `"lib/**/*.test.ts"`, así que **las 36 pruebas de B02 no se ejecutan en
      CI**: viven en `app/api/feed/*.test.ts`, donde manda la propiedad de
      archivos. Se suma al mismo pedido que ya abrió B17 para `i18n/`. Propuesta:
      `node --test --experimental-strip-types "lib/**/*.test.ts" "i18n/*.test.ts" "app/api/**/*.test.ts"` ·
      2026-08-03
