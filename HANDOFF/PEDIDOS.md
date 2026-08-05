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
      → **La lista lista para trabajar, con la fuente oficial de cada uno y
      agrupada por país, está en [`VERIFICACION-TELEFONOS.md`](./VERIFICACION-TELEFONOS.md).**
      Son 11 llamadas, no 24: los otros 13 son emergencias, SMS, chat y web, que
      se confirman leyendo la fuente · 2026-08-04

## Cerrados

- [x] **B00** · Definir contratos compartidos antes de abrir las olas · sin esto
      dos bloques declaran el mismo tipo con formas distintas · 2026-08-03

### Cierre de integración · 2026-08-04

Varios pedidos de i18n se habían quedado descritos como abiertos cuando ya no lo
estaban. Se verificaron uno a uno contra el código antes de moverlos aquí.

- [x] **B01 → B00** · `/api/me` lee los privados con `mi_perfil_privado()` ·
      ya estaba hecho: `app/api/me/route.ts` llama a la RPC, no a un `select`
- [x] **B17 → F4** · `app/layout.tsx`: `lang` del `<html>` y provider · hecho ·
      el `lang` sale de `resolverLocale()` y `ProveedorIdioma` envuelve el árbol
- [x] **B17 → B00** · `RecursoCrisis.verificadoPor` · hecho, el campo existe
- [x] **B17 → B15** · glob del script `test` · hecho: ya cubre `i18n/*.test.ts`,
      `components/**`, `app/**` y `scripts/**`
- [x] **B17 → F3** · `reciprocityMessage()` devuelve **clave + params**
      (`MensajeReciprocidad`) en vez de una frase en español ya resuelta, y
      `RECIPROCITY_SERVER_REJECTION` pasa a ser `CLAVE_RECHAZO_SERVIDOR`. El
      copy vive ahora solo en `messages/*.json`, que es donde lo vigila el guard
      de la palabra «crédito» —ampliado para cubrir también `publicar.enPausa`,
      que se le escapaba— · 2026-08-04
- [x] **B17 → B00 / F3** · divergencia de `ErrorCode` · **resuelta borrando
      `lib/apiErrors.ts`**. El inventario mostró que el sistema del contrato ya
      había ganado de facto (64 de 76 rutas y **todo** el cliente), y que el de
      los códigos en inglés era un residuo de 4 importadores, todos en el
      subárbol de crons, sin un solo test ni un solo consumidor de navegador —
      con dos de sus seis exportaciones muertas. Migradas esas 4 a `ErrorApi` /
      `manejarRuta`. Para que no pueda volver a abrirse, `CODIGOS_DE_ERROR` de
      `i18n/traductor.ts` ya no redeclara la lista: es un `Record` sobre el
      `CodigoError` del contrato, así que un código nuevo que no esté en los dos
      sitios no compila · 2026-08-04

**Descartado, no pendiente:**

- [x] **B17 → F4** · el plugin de `next-intl` en `next.config.ts` · **se decidió
      NO instalar next-intl**. El catálogo ya viaja en el bundle como JSON
      importado estáticamente, así que su provider solo habría añadido mandarlo
      otra vez por el cable contra el presupuesto de 120 KB por ruta de
      CONTRATOS §11. En su lugar está `i18n/Proveedor.tsx`, que publica solo el
      locale —una cadena de dos letras— y deja que `obtenerTraductor()` resuelva.
      El razonamiento largo está en ese archivo · 2026-08-04

### Cierre de documentación · 2026-08-05

Estos pedidos seguían descritos como abiertos cuando el código ya los resolvía
(la deriva llegó a contaminar dos análisis). Cada uno se verificó contra el
código antes de moverlo aquí; lo que no se pudo verificar desde esta sesión
sigue abierto donde estaba.

- [x] **B17 → CI** · gate de los teléfonos cableado · verificado: `package.json`
      ejecuta `scripts/security/gateTelefonos.ts` en `prebuild` (detiene el
      build de producción mientras `tablaListaParaProduccion()` siga en `false`)
      y `.github/workflows/ci.yml` deja el recuento a la vista en cada PR, con
      el porqué de que ese paso sea solo informativo escrito en el propio
      workflow · 2026-08-05
- [x] **B11 → B19** · `crisis_events.human_reviewed` ya se escribe · verificado:
      `POST /api/moderation/crisis/attend` (`app/api/moderation/crisis/attend/route.ts`)
      llama a `atenderCrisis()`, que escribe `attended_at`, `human_reviewed`,
      `outcome` y `reviewer_id`. Sigue abierto el matiz que anotó B19 más abajo:
      es el ÚNICO camino que lo escribe, así que la cobertura del 100 % depende
      de que la cola cierre cada caso · 2026-08-05
- [x] **B17 → F4 / B01 / B16** · los seis archivos con copy a pelo (37
      literales) ya están en el catálogo · verificado: `DEUDA_LITERALES_CONOCIDA`
      de `i18n/literales.test.ts` está VACÍA y el guard recorre `app/**` y
      `components/**` enteros · 2026-08-05
- [x] **migración i18n → `i18n/literales.test.ts`** · podar
      `DEUDA_LITERALES_CONOCIDA` · hecho: la lista quedó vacía, incluidas las
      cuatro entradas del falso positivo del ternario (el escáner aprendió a
      distinguir ese caso) · 2026-08-05
- [x] **B01 → F4** · `/api/auth/` es pública en `proxy.ts` · verificado:
      `PUBLIC_ROUTES` la incluye, con el razonamiento («las rutas que CREAN la
      sesión») en el propio archivo · 2026-08-05
- [x] **B13 → F4** · `manifest.json` excluido del matcher de `proxy.ts` ·
      verificado: va nombrado aparte en el `matcher`, y el comentario explica
      por qué no se excluye la extensión `.json` entera · 2026-08-05
- [x] **B13 → B15 / B00** · `web-push` instalado · verificado: `package.json`
      lo lleva en `dependencies` (`^3.6.7`) · 2026-08-05
- [x] **B02 y B04 → B03** · la ruta de voto existe · verificado:
      `app/api/posts/[id]/voto/route.ts` exporta `POST` y `DELETE`. Sigue
      vigente el contrato: ese voto solo mueve `posts.upvote_count` — un apoyo
      no da karma y no cuenta como escucha · 2026-08-05
- [x] **B02 / B03 / B04 / B05 / B06 / B07 / B10 / B18 → F4 / B00** ·
      `app/(app)/layout.tsx` existe · verificado: monta `BotonCrisis`,
      `RegistroServiceWorker` y `AvisoSinConexion`, con `app/(app)/layout.test.ts`
      vigilando los tres; y ningún layout ni página del grupo monta ya un
      `<BotonCrisis>` propio (solo quedan comentarios que apuntan al del grupo).
      Sigue vigente el aviso de B10: dentro de `/refugios/[id]` el acceso a
      recursos va DENTRO del redactor a propósito y no se quita · 2026-08-05
- [x] **B13 → F4** · `/offline` existe y es pública · verificado:
      `app/offline/page.tsx` existe, y `proxy.ts` lleva `/offline` y
      `/api/metrics` en `PUBLIC_ROUTES` · 2026-08-05

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
- ~~**`components/ui/index.ts` (B16) · `tsc` roto en `main`:** importa
  `./BotonCrisis.tsx`, que no existe (2 errores TS2307). Visto por B17 mientras
  verificaba su bloque · 2026-08-03~~
  ✅ **CERRADO 2026-08-04.** `BotonCrisis` existe y se importa desde
  `app/(app)/layout.tsx`; `tsc` limpio. Igual que la de abajo: se arregló y nadie
  cerró la nota.
- ~~**`lib/ingest/fuentes.ts` (B08) · `tsc` roto en `main`:** 5 errores TS2741,
  falta `fallosConsecutivos` en las semillas de fuente. Visto por B17 · 2026-08-03~~
  ✅ **CERRADO 2026-08-04.** `npx tsc --noEmit --incremental false` sale limpio en
  todo el repo, y `fuentes.ts` se editó ese día para añadir dos playlists sin un
  solo error. Se arregló en algún punto entre B17 y hoy sin que nadie cerrara la
  nota; se comprueba ejecutándolo, no leyendo.

## Pedidos añadidos por B01 (2026-08-03)

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

## Pedidos añadidos por B13 · Push y PWA (2026-08-03)

- [ ] **De B13 → F4** · faltan cinco variables en `.env.example`. **Ninguna
      salvo la última lleva prefijo `NEXT_PUBLIC_`**: `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY` (⚠️ **SECRETA**: una privada VAPID filtrada permite a
      un tercero enviar notificaciones que el navegador acepta como nuestras —
      en esta app, hacer sonar el teléfono de alguien con un texto que parece de
      su Alma Afín), `VAPID_SUBJECT` (`mailto:` o `https:`, RFC 8292),
      `PUSH_UA_SALT` (sal del HMAC del user-agent; sin ella `user_agent_hash` se
      guarda a `null` a propósito, porque un hash sin sal de un conjunto pequeño
      de user-agents se revierte con un diccionario) y, opcional,
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. **Cómo se generan las llaves está
      documentado en la cabecera de `lib/push/vapid.ts`**, con y sin `web-push`.
      ⚠️ Rotar la pareja INVALIDA todas las suscripciones existentes: hay que
      vaciar `push_subscriptions` y volver a pedir permiso, o cada envío dará
      403 (que no es 410, así que la limpieza automática no lo arregla) ·
      2026-08-03
- [ ] **De B13 → B01** · en el logout hay que avisar al service worker para que
      borre las cachés: `avisarCierreDeSesion()` de `@/components/pwa` (un
      `postMessage({tipo:'darma:logout'})`; el handler ya está en
      `public/sw.js`). Sin eso, el shell cacheado de una cuenta sigue vivo
      cuando otra persona entra en el mismo dispositivo — y compartir el móvil
      en una app de apoyo emocional es lo normal, no la excepción · 2026-08-03
- [ ] **De B13 → B04** · falta el disparador del aviso «te escucharon». El punto
      de entrada está listo y es uno solo:
      `await avisar({ destinatarioId: autorDelPost, tipo: 'te_escucharon',
      emisorId: userId, url: '/post/' + postId })` de `@/lib/push`, justo
      después del `UPDATE is_validated = true` de `app/api/comments/route.ts`.
      No lanza nunca y aplica sola la política entera (bloqueo, preferencias,
      silencio nocturno, techo, agrupación y alias del emisor). Igual para
      `te_ayudo` en `app/api/comments/[id]/util/route.ts` · 2026-08-03
- [ ] **De B13 → B10** · el aviso más importante del bloque necesita su
      disparador: `avisarAlmasAfines(userId)` de `@/lib/push`, cuando alguien
      pone `profiles.availability = 'necesito_hablar'`. Resuelve destinatarios
      con la RPC `destinatarios_alma_afin()` de `0131` (usa
      `idx_kindred_reverse` y ya filtra `blocks`). Y `mensaje_refugio` con
      `avisar({..., tipo: 'mensaje_refugio', refugeId })`, que respeta
      `refuge_members.muted` · 2026-08-03
- [ ] **De B13 → B16** · `public/icono-darma.svg` y
      `public/icono-darma-maskable.svg` son provisionales (SVG, con los tokens
      de `globals.css`, sin un solo hex inventado). Chrome acepta SVG en el
      manifiesto, pero un par de PNG reales 192/512 daría mejor resultado en
      Android. La variante *maskable* existe aparte a propósito: sin ella el
      icono sale con marco blanco en muchos lanzadores · 2026-08-03
- [ ] **De B13 → B00 (decisión de producto, no técnica)** · la ficha dice que
      `decidirEnvio` «devuelve SIEMPRE `{enviar:true}`» para
      `alma_afin_en_crisis`. La implementación se salta el techo, la agrupación
      y las horas de silencio **sin excepción**, pero respeta UNA sola cosa: que
      esa persona haya apagado explícitamente ese tipo en sus preferencias
      (`prefs.alma_afin_en_crisis === false`). Sostener el literal significaría
      mandar notificaciones de madrugada a alguien que dijo que no las quiere, y
      es la única forma de que este bloque acabe siendo el problema en vez de la
      solución. Quien no ha tocado nada lo tiene en ON por defecto, así que el
      camino normal es el de la ficha. Razonado en la cabecera de
      `lib/push/horario.ts` y fijado por la prueba `10c`. Si producto prefiere
      el literal, es una línea · 2026-08-03
- [ ] **De B13 → B15** · regenerar `lib/supabase/database.types.ts` DESPUÉS de
      aplicar `0131_b13_push.sql`: hoy no contiene `push_subscriptions`,
      `notification_prefs`, `push_dispatch_state` ni las funciones
      `is_blocked_between()` y `destinatarios_alma_afin()`. Mientras tanto,
      `app/api/push/prefs/route.ts` declara `FilaPrefs` a mano y
      `lib/push/tipos.ts` declara `Suscripcion`, con el comentario que dice por
      qué · 2026-08-03
- [ ] **De B13 → B15** · conviene un caso en `supabase/tests/*.sql` con la
      invariante entera de este bloque, hoy solo verificada a mano contra
      `darma-dev`: con rol `authenticated` y un JWT real deben fallar con 42501
      el `select p256dh, auth`, el `select endpoint`, el `insert` a nombre de
      otra persona, el `select push_dispatch_state` y las dos RPC nuevas; y un
      `delete from push_subscriptions` SIN `where` debe alcanzar exactamente 1
      fila. Si alguien concede `select (p256dh, auth)` «para pintar la lista de
      dispositivos», las claves de cifrado del navegador de toda la red pasan a
      ser legibles vía PostgREST · 2026-08-03
- [ ] **De B13 → B17** · toda la superficie de este bloque está en **español
      directo, sin catálogo**: las seis plantillas de notificación
      (`lib/push/plantillas.ts`, tres variantes cada una), el copy del opt-in
      (`components/pwa/OptInPush.tsx`), el banner de sin conexión y los campos
      `name`/`description` de `public/manifest.json`. Las plantillas son el caso
      delicado: al traducirlas hay que conservar (a) que el cuerpo NUNCA lleve
      texto de un post o de un comentario y (b) que no aparezca vocabulario de
      enganche — hay una prueba tosca (`plantillas.test.ts`, caso 11) con la
      lista de palabras prohibidas en español, que habrá que replicar por
      idioma · 2026-08-03
- [ ] **De B13 → B12 / B00** · `push_dispatch_state` (migración `0131`) guarda
      la memoria de la agrupación y de lo diferido en horas de silencio. Crece
      con (personas × tipos) y no la limpia nadie: hace falta un barrido
      periódico (`delete where pendientes = 0 and last_sent_at < now() -
      interval '30 days'`) y, sobre todo, **un cron que ENTREGUE lo diferido**
      —`idx_push_dispatch_pendiente` es un índice parcial hecho exactamente para
      esa consulta—. Hoy lo acumulado sale con el siguiente aviso del mismo
      tipo; si no hay siguiente, se queda ahí · 2026-08-03

### Bugs vistos fuera de B13 (no tocados)

- **`app/api/privacy/eliminar/route.ts(70)` y
  `app/api/privacy/exportar/route.ts(78)` (B20) · `tsc` roto:** dos TS2345.
  `manejarRuta` infiere el tipo del PRIMER `sobreOk` del cuerpo y después
  rechaza el segundo, que tiene otra forma. Se arregla anotando el genérico:
  `manejarRuta<UnionDeLasDosFormas>(...)`. Visto por B13 mientras verificaba su
  bloque; el resto del árbol compila · 2026-08-03
- [ ] **De B20 → B01** · el onboarding debe (a) pedir la **fecha de nacimiento
      declarada**, (b) llamar a `cumpleEdadMinima()` de `lib/privacy/avisos.ts`,
      (c) **descartar la fecha en el acto** —no se almacena en ninguna columna,
      es un identificador de más en una app que prohíbe justamente eso— y (d)
      registrar los cuatro consentimientos obligatorios
      (`terminos`, `privacidad`, `no_es_terapia`, `edad_minima`) con
      `POST /api/privacy/consentimientos`. Si la edad no llega a 16, **no se
      crea ni la fila de `profiles` ni la de `consents`** · 2026-08-03
- [ ] **De B20 → B16 / F4** · `AVISO_NO_TERAPIA` (`lib/privacy/avisos.ts`) tiene
      que renderizarse de forma **permanente** en el layout de `app/(app)` y en
      la tarjeta de recursos de crisis. Es una frase, sin JS. Hoy solo aparece
      en `/legal` y en `/legal/no-es-terapia`, que es donde menos falta hace ·
      2026-08-03
- [ ] **De B20 → B10** · al borrar una cuenta, `borrar_usuario()` marca los
      `refuge_messages` propios como `removed` y saca a la persona de todas las
      salas, pero **el `ciphertext` se conserva**: su destrucción real es asunto
      de las CLAVES, que no controla este bloque. B10 debe destruir las claves
      de refugio de la persona borrada. Mientras tanto, `ResultadoBorrado`
      declara la deuda en `pendienteDeOtrosBloques` en vez de darla por hecha
      (lección de `rgpdErase.ts`: lo que ninguna fila referencia sobrevive) ·
      2026-08-03
- [ ] **De B20 → B08 / B00** · falta el **cron que ejecuta los borrados
      vencidos**. Las piezas ya están en Postgres: `borrados_vencidos(limite)`
      devuelve los `user_id` cuyos 30 días de arrepentimiento han pasado y
      `borrar_usuario(user)` los ejecuta. Falta un handler bajo `/api/cron/…`
      (prefijo de B08 según CONTRATOS §7, por eso B20 no lo crea) que se
      autentique con `CRON_SECRET` y los recorra. **Sin ese cron, ningún borrado
      confirmado llega a ejecutarse nunca** — el art. 12.3 da un mes ·
      2026-08-03
- [ ] **De B20 → B08 / B00** · mismo caso para `purgar_retencion(lote)`: la
      función existe y borra por lotes acotados, pero nadie la invoca. Sin cron,
      `content_views`, `rate_limits`, `refuge_messages`, `moderation_flags` y
      `crisis_events` crecen sin límite y `/legal/retencion` promete plazos que
      no se cumplen · 2026-08-03
- [ ] **De B20 → B00 / B15** · ⚠️ **CAMBIO DE ESQUEMA QUE MERECE REVISIÓN**: la
      migración `0201_1_b20_privacidad.sql` **elimina la FK
      `profiles.id → auth.users(id) on delete cascade`**. Motivo: esa cascada
      convertía el ejercicio del derecho de supresión de UNA persona en la
      destrucción de datos de TERCEROS (los comentarios con los que acompañó a
      otros, y con ellos el `reply_count` de posts ajenos, que lo mantiene un
      trigger que no se dispara en el delete) y de registros de conservación
      obligatoria (`crystal_ledger`, 6 años; `crisis_events`, 5 años). No hay
      forma de desactivar una cascada «solo para este delete», y `profiles.id`
      es la PK, así que `on delete set null` no era opción. El lado del INSERT
      —lo que la FK protegía de verdad— lo ocupa ahora el trigger
      `trg_profiles_exige_auth_user`. Consecuencia asumida: tras el borrado, la
      fila de `profiles` queda huérfana a propósito (es una lápida). Verificado
      contra `darma-dev` · 2026-08-03
- [ ] **De B20 → B00** · la ficha B20 pide la migración
      `supabase/migrations/0020_b20_privacidad.sql`, pero el rango de B20 en
      `PARALELO.md` §3 es `0201`–`0209` y `0020` invadiría el de los cimientos.
      Se ha usado `0201_1_b20_privacidad.sql`. Conviene corregir la ficha
      (misma corrección que ya pidió B02) · 2026-08-03
- [ ] **De B20 → B00** · dos firmas del §Contrato de la ficha B20 no se pueden
      cumplir tal cual y se han resuelto así: (a) `consentimientosVigentes`,
      `registrarConsentimiento`, `construirExportacion` y `ejecutarBorrado`
      existen con la firma literal (construyen el cliente admin por dentro) y
      además en versión `…Con(supabase, …)`, que es la que usan las rutas y la
      que permite probarlas sin base de datos; (b) **`confirmarBorrado(solicitudId,
      token)` lanza siempre** — sin el `userId` de la sesión no hay forma de
      comprobar de quién es la solicitud, y aceptar la confirmación sin ese
      chequeo convertiría un id filtrado en el borrado de una cuenta ajena. La
      real es `confirmarBorradoCon(supabase, solicitudId, userId, token)` ·
      2026-08-03
- [ ] **De B20 → B15** · `lib/supabase/database.types.ts` debe regenerarse
      DESPUÉS de `0201_1_b20_privacidad.sql`: hoy no contiene `consents`,
      `privacy_requests`, `retired_aliases`, `profiles.deleted_at` ni las nueve
      funciones nuevas. Mientras tanto, `lib/privacy/exportar.ts` y
      `consentimientos.ts` declaran a mano las formas de fila, con el comentario
      que dice por qué · 2026-08-03
- [ ] **De B20 → B17** · deuda de traducción: las páginas de `app/(legal)/**`
      llevan el texto en **español directo**, no `t('…')`. El guard
      `ningún archivo NUEVO de app/** o components/** trae texto sin traducir`
      las señala (junto con `app/(app)/ranking`, `app/(app)/refugios` y
      `components/pwa`, que no son de B20 y ya lo rompían). Matiz importante
      para quien lo aborde: **los cuerpos de `lib/privacy/textos.ts` NO se deben
      traducir con el sistema de mensajes** — su `sha256` es la prueba de qué
      texto exacto se aceptó, así que cada idioma necesita su propio documento
      con su propia versión y su propia huella, no una interpolación ·
      2026-08-03
- [ ] **De B20 → B19** · el centro de mando necesita una vista de solicitudes de
      privacidad (cuántas pendientes, cuántas vencidas, cuántas fallidas) para
      poder demostrar el cumplimiento del plazo del art. 12.3. Los datos están
      en `privacy_requests`, que solo lee `service_role` · 2026-08-03
- [ ] **De B20 → revisión legal externa** · dos decisiones tomadas a conciencia
      que necesitan validación de un abogado antes de abrir al público: (a) **no
      recoger consentimiento parental** para 16–17 años allí donde una norma
      local lo exija en servicios de salud, restringiendo funciones en su lugar
      (recogerlo obligaría a vincular al menor con un adulto identificable y
      rompería el anonimato que le protege); (b) la **conservación de los
      comentarios** tras el borrado al amparo del art. 17.3.e. Las dos están
      escritas y razonadas en `/legal/menores` y `/legal/privacidad` ·
      2026-08-03
- [ ] **De B20 → quien opere `darma-dev`** · ⚠️ el proyecto de desarrollo
      ha entrado en **modo SOLO LECTURA** (`default_transaction_read_only = on`,
      750 MB de base) mientras otro bloque sembraba en masa. No es de B20 —los
      datos de prueba de este bloque se sembraron y se borraron, y el recuento
      final es 0—, pero tiene dos consecuencias: (a) hay una tabla huérfana de
      otro bloque, `public.b09_pruebas`, **con RLS desactivada** (el linter la
      marca como ERROR); (b) **la última línea de
      `0201_1_b20_privacidad.sql` está en el archivo pero NO aplicada**: el
      `revoke all on function public.profiles_exige_auth_user()`. Hay que
      liberar espacio y ejecutarla. Sin ella, esa función `security definer`
      queda publicada como endpoint RPC para `anon` (hoy no es explotable
      —Postgres rechaza llamar a una función `returns trigger` fuera de un
      trigger— pero es la misma superficie que `0003` §3 se molestó en cerrar) ·
      2026-08-03

## Pedidos añadidos por B10 · Refugios y Almas Afines (2026-08-03)

- [ ] **De B10 → B00 / F2** · el comentario de `refuge_messages.ciphertext` en
      `0002_comunidad.sql` sobre XChaCha20-Poly1305 **ya está corregido** en el
      árbol: dice AES-256-GCM con nonce de 12 bytes y explica que WebCrypto no
      implementa XChaCha. Se anota porque la ficha B10 lo pedía como pedido
      abierto y conviene que B00 lo dé por cerrado en vez de volver a abrirlo ·
      2026-08-03
- [ ] **De B10 → B13 (BLOQUEANTE PARA B13, LEER ENTERO)** · la notificación push
      de un mensaje de refugio **NO PUEDE LLEVAR CONTENIDO**. Ni el texto, ni un
      preview, ni un extracto, ni el alias de quien escribe, ni el título del
      refugio. El servidor **no puede** leer el mensaje —recibe un blob
      AES-256-GCM y no tiene la clave—, así que técnicamente no hay de dónde
      sacarlo; el riesgo real es que alguien «resuelva» ese hueco añadiendo un
      campo en claro al `POST /api/refuges/[id]/mensajes` para poder rellenar la
      push. El payload permitido es literalmente «Tienes un mensaje nuevo en un
      refugio» más el `refuge_id` para el enlace profundo. Una push aparece en la
      pantalla de bloqueo, que es exactamente el sitio donde alguien puede estar
      mirando el móvil de otra persona · 2026-08-03
- [ ] **De B10 → B11** · la moderación de refugios solo puede actuar sobre
      reportes **con el texto aportado por quien recibe el mensaje** desde su
      propio dispositivo: no hay ninguna vía para que el servidor lea un mensaje
      de refugio, y no debe haberla. `moderation_flags.ref_type =
      'refuge_message'` + `ref_bigint` ya existe en 0002 para eso · 2026-08-03
- [ ] **De B10 → B00 / F2 (SEGURIDAD · ya corregido por 0110_1)** · las cinco
      tablas de refugio conservaban el **INSERT íntegro** para `authenticated`:
      el mismo agujero que `0004` documenta para `posts` y `comments`, en cinco
      tablas más. Comprobado contra `darma-dev` antes de tocar nada. Lo que
      permitía con un solo POST a PostgREST:
      · `refuge_messages.created_at` falsificado — el trigger
        `refuge_messages_sync()` lo copia a `refuges.last_message_at`, que es la
        clave de orden de la bandeja, así que una fecha del año 2400 fija tu
        conversación arriba del todo **para siempre** en el móvil de la otra
        persona. Es acoso con un campo de fecha.
      · `refuge_messages.state = 'removed'` al nacer: invisible para la política
        de lectura pero contando en `message_count`.
      · `refuge_members.is_host`: autoascenderse a anfitrión es el permiso de
        invitar a terceros a una sala ajena.
      · `refuge_members.left_at` al insertar: ocupa una plaza que nadie usa.
      · `refuges.member_count` / `message_count` inventados: con
        `member_count = max_members` la sala nace llena y nadie puede entrar.
      · `blocks.created_at` / `kindred.created_at`: reescribir la cronología de
        un bloqueo es reescribir la prueba de cuándo alguien pidió que le dejaran
        en paz.
      `0110_1_b10_claves.sql` §4 lo cierra enumerando las columnas escribibles.
      **Conviene revisar con el mismo criterio toda tabla futura**: RLS decide
      filas, solo el privilegio de columna decide columnas · 2026-08-03
- [ ] **De B10 → B00 / F2 (SEGURIDAD · NO corregido, no es mi archivo)** · la
      política `refuge_members_join` de `0002` permite que **cualquiera se
      inserte a sí mismo en cualquier refugio**: `user_id = (select auth.uid())`
      es una de las dos ramas del OR. Hoy la explotación exige conocer el uuid de
      la sala, que solo se obtiene siendo miembro, así que no es explotable a
      ciegas; pero un uuid filtrado por un log, una captura de pantalla o un
      enlace compartido convierte a un tercero en miembro de una conversación
      privada, y a partir de ahí lee todo lo que se escriba después. El
      comentario de `0002` dice «o entras tú mismo (con invitación validada por
      el servidor)», pero **esa validación no existe en ninguna parte del
      repositorio**. B10 no edita `0002` y tampoco lo ha rodeado. El arreglo
      natural es una tabla de invitaciones con token de un solo uso, o exigir en
      esa rama que exista una invitación vigente · 2026-08-03
- [ ] **De B10 → B00** · desviación deliberada del contrato de la ficha:
      `envolverParaMiembro(claveRefugio, jwkDestino, privadaEmisor)` y
      `abrirSobre(sobre, jwkEmisor, privadaReceptor)` reciben la clave privada
      como **tercer parámetro explícito** en vez de sacarla de IndexedDB por
      dentro. Con la firma de la ficha, `lib/crypto/index.ts` dependería de
      IndexedDB y sería **imposible de probar con `node --test`** — justo el
      módulo donde las pruebas importan más. Además, ver en la llamada QUÉ clave
      se usa es lo que hace evidente un error de emisor/receptor. La firma de la
      ficha sigue siendo asignable si se envuelve · 2026-08-03
- [ ] **De B10 → B00** · `POST /api/refuges` recibe `sobres[]` **sin
      `refugeId`**: el contrato de la ficha lo incluía, pero el id de la sala no
      existe hasta que el servidor la crea, así que el cliente no puede
      conocerlo. Lo rellena el servidor · 2026-08-03
- [ ] **De B10 → B05 / F3 / B00** · `check_rate_limit()` sigue concedida solo a
      `service_role` y este bloque tiene prohibido el cliente admin (mismo pedido
      que ya abrió B05). B10 lo resuelve con `b10_limitar(p_accion text)`
      (`security definer`, concedida a `authenticated`), que **saca el sujeto de
      `auth.uid()` y lleva los límites dentro de la función**: el cliente elige
      la acción, nunca el número —si el límite viniera por parámetro bastaría
      pedir 1 000 000 para no tener límite—. Si se decide conceder
      `check_rate_limit` a `authenticated` (defendible: cuenta, no lee datos de
      nadie), esta función sobra. Mientras tanto es el patrón que recomiendo
      copiar en vez de dejar un bloque en la capa de memoria · 2026-08-03
- [ ] **De B10 → B15** · regenerar `lib/supabase/database.types.ts` DESPUÉS de
      `0110_1_b10_claves.sql`: hoy no contiene `user_keys`,
      `refuge_key_envelopes`, `identity_backups` ni las funciones
      `b10_crear_refugio`, `b10_bandeja`, `b10_limitar` y
      `b10_registrar_crisis_refugio`. Mientras tanto,
      `app/api/refuges/_dominio/servidor.ts` declara a mano `FilaRefugio`,
      `FilaMensaje`, `FilaClavePublica` y `FilaSobre`, con el comentario que dice
      por qué y qué las sustituye · 2026-08-03
- [ ] **De B10 → B15** · la suite de intrusión específica de refugios está
      escrita y ejecutada, pero vive en el **scratchpad de la sesión**, no en
      `scripts/security/` (que es de B15 y este bloque no edita). Son 30 casos
      con **tres sesiones reales** —Ana, Luis e Intrusa— que afirman que un no
      miembro no ve el refugio, ni sus mensajes, ni su pertenencia, ni los
      sobres; que el bloqueo hace desaparecer la sala para las dos partes; y que
      ninguna de las columnas cerradas en `0110_1` §4 se puede escribir. Merece
      entrar en `scripts/security/` junto a `intrusion.mjs` · 2026-08-03
- [ ] **De B10 → F4** · `/refugios` y `/refugios/[id]` deben estar en las rutas
      PRIVADAS de `proxy.ts`: exigen sesión · 2026-08-03
- [ ] **De B10 → B17 (deuda de traducción)** · todo el copy de
      `components/refuge/**` y `app/(app)/refugios/**` está escrito **en español
      directamente en el JSX**, sin pasar por `messages/`. Los tres textos que
      hay que traducir con más cuidado que el resto: (a) las **tres advertencias
      literales** de `ADVERTENCIAS_RESPALDO` en `lib/crypto/respaldo.ts` —tienen
      una prueba que las vigila, y suavizarlas al traducir sería perder la
      decisión, no la traducción—; (b) el texto de `AvisoSinClave` con
      `dispositivoNuevo`, que es lo que le explica a alguien que acaba de cambiar
      de móvil por qué no ve su historial y por qué eso no es un fallo; (c) la
      explicación del número de seguridad, que pide una acción concreta («leedlo
      en voz alta los dos»). La **lista de 256 palabras de `lib/crypto/frase.ts`
      NO se traduce jamás**: una frase escrita en un papel en 2026 tiene que
      seguir abriendo la copia en 2030 aunque la persona cambie el idioma de la
      app · 2026-08-03
- [ ] **De B10 → B05 / B01** · falta el punto de entrada para ABRIR un refugio.
      `POST /api/refuges` existe y funciona, pero nadie lo llama: hace falta un
      botón «Hablar en privado» en el perfil ajeno (B05) que use
      `prepararSobresDeSalaNueva()` de `components/refuge/identidad.ts` y luego
      la ruta. Igual con «Guardar como alma afín»
      (`POST /api/refuges/kindred`). Mientras tanto `/refugios` solo enseña lo
      que ya exista · 2026-08-03
- [ ] **De B10 → B01** · al **cerrar sesión** hay que llamar a
      `olvidarDispositivo(userId)` de `lib/crypto/almacen.ts`. Sin eso, dejar la
      cuenta cerrada en un ordenador prestado deja la clave de identidad y las de
      cada refugio en IndexedDB: la cookie ya no vale, pero **la clave es lo que
      abre las conversaciones, no la sesión**. Tiene que ejecutarse en el
      navegador, porque IndexedDB solo existe allí · 2026-08-03
- [ ] **De B10 → B20 (RGPD)** · el borrado de cuenta tiene un caso que no es
      obvio: `refuge_messages` **no se puede descifrar para borrar contenido
      selectivamente**, y borrar la sala entera borraría el historial de la otra
      persona sin su consentimiento (por eso 0002 revoca el DELETE). La vía
      correcta es `left_at` + borrado del perfil en cascada; los blobs quedan
      ilegibles para todo el mundo en cuanto desaparecen las claves. Conviene que
      la política de privacidad lo diga con estas palabras, y que la pantalla de
      borrado avise de que **la copia de seguridad opt-in
      (`identity_backups`) también se borra** y con ella la última vía de
      recuperar el historial · 2026-08-03
- [ ] **De B10 → B15 / B14 (INCIDENCIA DE ENTORNO, no de código)** · el proyecto
      `darma-dev` entró en **modo solo lectura** a mitad de esta sesión por
      superar la cuota de disco: 783 MB, con `poll_votes` (275 MB),
      `ranking_snapshots` (167 MB) y `listen_daily` (151 MB) sembradas por otros
      bloques y todavía sin limpiar. Con la base en solo lectura no se puede
      ejecutar ninguna suite de intrusión con sesiones reales, que es la única
      forma de probar RLS de verdad. Hace falta una regla operativa explícita en
      `PARALELO.md`: **quien siembra, borra antes de cerrar**, y B14 en instancia
      propia sí o sí · 2026-08-03
- [ ] **De B09 → B02** · punto de inserción de la encuesta en el feed. B09 no ha
      tocado `components/feed/**`. Lo que hay que hacer en `SlotEncuesta.tsx` es
      sustituir **el cuerpo** conservando la prop `encuestaId`, y pintar
      `<TarjetaEncuesta encuesta={…} />` de `@/components/polls`. La hidratación
      NO puede añadir una consulta por tarjeta: hoy la vía correcta es llamar a
      `siguienteEncuestaPara(supabase, { userId, posicion, idioma })` de
      `@/lib/polls/consulta` UNA vez por página —resuelve en ≤2 consultas y
      además aplica la cadencia—, o pedir a B09 una RPC `encuestas_por_ids(ids)`
      si se prefiere hidratar los ids que ya trae `feed_encuestas_keyset`. Ojo:
      `feed_encuestas_keyset` **no filtra por idioma ni excluye lo ya votado o
      descartado**, así que sus ids pueden ser encuestas que esa persona no
      debería volver a ver · 2026-08-03
- [ ] **De B09 → F4** · añadir el cron a `vercel.json`:
      `{"path":"/api/polls/reponer","schedule":"41 3 * * *"}`. Sin él, el pool de
      encuestas activas se agota y el carril del feed se apaga en silencio. El
      handler se autentica solo con `CRON_SECRET` (fail-closed, `timingSafeEqual`)
      · 2026-08-03
- [ ] **De B09 → B01** · reservar el alias `Darma` en el registro. La migración
      `0109_1_b09_encuestas.sql` crea el perfil de sistema con id fijo
      `0da12a00-0000-4000-8000-000000000009` y alias `Darma` (es el `author_id`
      de las encuestas del banco). Hoy nada impide que una persona se registre
      con ese alias… salvo el `unique` de `profiles.alias`, que le devolvería un
      error raro. Conviene una lista de alias reservados en `crear_perfil()` ·
      2026-08-03
- [ ] **De B09 → F3 / B11** · `lib/crisis.ts` está escrito para el DESAHOGO, que
      se redacta en primera persona (`es_ideation` busca «suicidarme», no
      «suicidarse»). Una **encuesta se formula en impersonal** —«¿alguien más ha
      pensado en suicidarse?»— y ese texto NO dispara nada hoy: verificado, hay
      un test en `lib/polls/validacion.test.ts` que fija la limitación para que
      falle el día que se arregle. Propuesta: añadir variantes impersonales
      (`suicidarse`, `quitarse la vida`, `no estar`, `dejar de existir` en 3ª
      persona) al matcher. Mientras tanto, una pregunta que sea una llamada de
      auxilio disfrazada puede pasar sin recursos · 2026-08-03
- [ ] **De B09 → F3** · la ficha B09 llama al helper de crisis `evaluarRiesgo()`
      y CONTRATOS §9 también; la función que existe en `lib/crisis.ts` se llama
      `assessCrisisRisk()`. B09 no ha renombrado nada de F3: consume la real
      desde `lib/polls/riesgo.ts`. Conviene alinear ficha y código · 2026-08-03
- [ ] **De B09 → B00** · **no existe ninguna ruta de creación de encuestas** en
      el contrato de B09 (las cinco de la ficha son siguiente/voto/resultados/
      descartar/reponer), pero la ficha exige que el texto de una encuesta con
      `origin = 'usuario'` pase por la evaluación de crisis. B09 deja listos
      `lib/polls/riesgo.ts` y `esquemaEncuestaNueva` en `lib/polls/validacion.ts`
      para quien la añada (¿el composer de B03?). Hay que decidir de quién es esa
      ruta · 2026-08-03
- [ ] **De B09 → B00** · nombre de migración: la ficha pedía
      `supabase/migrations/0009_b09_encuestas.sql`, pero `0009` cae en el rango
      de cimientos (`0001`–`0099`). Se ha usado `0109_1_b09_encuestas.sql` +
      `0109_2_b09_indice_descartes.sql`, que es el rango `0109x` que reserva
      `PARALELO.md` §3 para B09. Mismo caso que ya reportó B02 · 2026-08-03
- [ ] **De B09 → B00 / F2** · **tres agujeros del esquema de encuestas cerrados
      por `0109_1`**, y los tres nacieron en `0002`/`0004`. Merecen revisión
      porque el patrón se repite en otras tablas: (a) `0004_insert_columnas.sql`
      enumeró las columnas insertables de `comments`, `posts`, `post_votes`,
      `poll_votes` y `content_views` **pero se dejó `polls` y `poll_options`**,
      que tenían INSERT abierto sobre TODAS sus columnas para `anon` y
      `authenticated` — `total_votes` y `vote_count` incluidos; (b) `poll_votes`
      no ataba `option_id` a `poll_id`, así que un voto podía sumar en la opción
      de OTRA encuesta y descuadrar los contadores; (c) `poll_options.vote_count`
      era legible con la anon key, lo que dejaba el umbral de revelación en
      decorativo. Conviene pasar la misma revisión por `refuges`, `kindred` y
      `content_items` · 2026-08-03
- [ ] **De B09 → B00 / F2** · `0109_1` **reescribe tres políticas de `0002`**
      (`poll_options_read`, `poll_options_insert_author`, `poll_votes_insert_own`)
      para sacar las subconsultas contra `polls` a funciones `security definer`
      (`encuesta_visible`, `soy_autor_encuesta`, `encuesta_admite_voto`), que es
      la regla que dejó `0005_politica_posts_read.sql`. De paso,
      `poll_votes_insert_own` ahora comprueba que la encuesta esté activa y no
      cerrada: antes se podía votar en una encuesta oculta o caducada · 2026-08-03
- [ ] **De B09 → B06** · `public.ranking_snapshots` **no tiene ningún índice que
      empiece por `user_id`** (la PK es `(period, period_start, user_id)` y
      `idx_ranking_board` empieza por `period`). Consecuencia medida al limpiar
      los datos de prueba: cada borrado de una fila de `profiles` dispara un
      `Seq Scan` sobre `ranking_snapshots` por la FK en cascada, y borrar 100 000
      perfiles se vuelve imposible dentro del timeout. Hace falta
      `create index on public.ranking_snapshots (user_id)` · 2026-08-03
- [ ] **De B09 → B14 / B00** · `darma-dev` es un proyecto de **plan gratuito con
      500 MB**: al sembrar 1 000 007 `poll_votes` para el `EXPLAIN ANALYZE` que
      pide la ficha, la base llegó a 768 MB y Supabase la puso en **modo solo
      lectura**, lo que bloquea a TODAS las sesiones a la vez. Se recuperó
      borrando los datos y con `vacuum full` (52 MB ahora). Dos cosas: (1) las
      siembras de volumen necesitan instancia propia, como ya avisa
      `PARALELO.md` §3 opción B; (2) `posts` (35 MB) y `auth.users` seguían
      hinchados de siembras anteriores de otros bloques — conviene `vacuum full`
      tras cada medición · 2026-08-03
- [ ] **De B09 → B15** · las 67 pruebas de B09 viven en `lib/polls/*.test.ts`, que
      SÍ entra en el glob actual de `npm test`. Pero `lib/supabase/database.types.ts`
      todavía no contiene `encuesta_siguiente`, `encuesta_resultados` ni
      `reponer_encuestas`, así que `lib/polls/tipos.ts` declara a mano
      `FilaEncuesta`, `FilaOpcion` y `FilaCadencia` con el comentario que dice
      por qué y qué las sustituye · 2026-08-03
- [ ] **De B09 → B17 / B01** · el idioma del pool de encuestas sale hoy de
      `Accept-Language` (`idiomaDeEncuestas()` en `lib/polls/validacion.ts`),
      igual que el del contenido curado en B02. Debería salir de la preferencia
      GUARDADA de la persona: servir una encuesta de bienestar en un idioma que
      no se domina es peor que no servirla · 2026-08-03

- [ ] **De B06 → F4 · BLOQUEANTE del cron** · `proxy.ts` deja pasar sin sesión
      `/api/auth/`, `/api/cron/` y `/api/health`, pero **no** `/api/ranking/snapshot`.
      La ficha B06 prohíbe crear rutas bajo `/api/cron/*` (son de B08), así que el
      constructor vive en el prefijo de B06 y hoy el proxy le devuelve 401 antes
      de que el handler llegue a comprobar el Bearer. Hay que añadir
      `/api/ranking/snapshot` a la lista pública de `proxy.ts`: la ruta se
      autentica sola con `CRON_SECRET` en tiempo constante y fail-closed
      (`lib/ranking/cronAuth.ts`), igual que hacen los tres crons de B08 ·
      2026-08-03
- [ ] **De B06 → F4** · entrada de cron en `vercel.json` (no es de B06):
      `{"path":"/api/ranking/snapshot","schedule":"7 * * * *"}`. El minuto 7 y no
      el 0 es deliberado: a la hora en punto compiten los crons de medio
      internet. `maxDuration` 60 y presupuesto interno de 50 s; si un corte no
      cabe, la respuesta trae `completado:false` + `ultimoUsuario` y el disparo
      siguiente continúa desde ahí · 2026-08-03
- [ ] **De B06 → B05 y B13** · ya está disponible `obtenerPosicionDe(userId,
      periodo): Promise<FilaRanking | null>` en `lib/ranking/index.ts`. Usa el
      cliente RLS (no el admin) y lee por PK, así que sirve para «tu posición» en
      el perfil (B05) y para decidir el push «has entrado al podio» (B13) sin
      paginar. **`null` no es un error**: quien no ha acompañado a nadie en el
      periodo simplemente no está en la foto · 2026-08-03
- [ ] **De B06 → B15** · `lib/supabase/database.types.ts` debe regenerarse
      DESPUÉS de `0106_1/2/3`: hoy no contiene `ranking_tablero`, `ranking_fila`,
      `construir_ranking_snapshot`, `listen_daily` ni `ranking_snapshots`.
      Mientras tanto `lib/ranking/tipos.ts` declara a mano `FilaTableroSql`, con
      el comentario que dice por qué y qué la sustituye · 2026-08-03
- [ ] **De B06 → B00 · DOS BUGS EN EL SQL DE LA FICHA `B06.md`, encontrados
      midiendo, no leyendo. Conviene corregir la ficha antes de que alguien la
      copie.**
      (a) `dense_rank() over (order by a.listens desc, a.user_id)`: con
      `user_id` DENTRO de la ventana no hay empates jamás y `dense_rank()` se
      comporta como `row_number()`. Medido: 97 696 personas, `max(rank) =
      count(*)`, cero empates. Dos personas que acompañaron a la misma gente
      reciben puestos distintos decididos por su uuid. Corregido en
      `0106_3_b06_ranking_empates.sql`: la ventana ordena solo por escuchas.
      (b) El keyset `where rank > :cursor_rank` con `idx_ranking_board (period,
      period_start, rank)`: al empatar de verdad, ese predicado se come a los
      empatados que no cupieron en la página. Medido en un corte de 100 003
      personas: la página 1 cierra dentro del puesto 1 y **2 142 personas
      desaparecen del tablero** sin que nada lo indique. B06 pagina por la tupla
      `(rank, user_id)` y el índice es `(period, period_start, rank, user_id)` ·
      2026-08-03
- [ ] **De B06 → B00** · nombre de migración: la ficha pedía
      `supabase/migrations/0006_b06_ranking.sql`, pero `0006_cerrar_shadow_banned.sql`
      ya existe y está aplicada. Se ha usado el rango `0106x` que reserva
      `PARALELO.md` §3 (`0106_1`, `0106_2`, `0106_3`). Mismo caso que ya reportó
      B02 con `0004` · 2026-08-03
- [ ] **De B06 → B00** · cuarta confirmación de la divergencia entre
      `CONTRATOS.md` §4 y `lib/apiErrors.ts`. B06 **no** ha escrito otra
      implementación: consume la de B01 (`lib/auth/errores.ts` + `respuestas.ts`),
      que es la que da el `{ ok, code, message, retryAfter }` literal del
      contrato. Si B00 unifica, hay que tocar `app/api/ranking/{route,validacion,
      respuesta}.ts` y las dos rutas hijas · 2026-08-03
- [ ] **De B06 → B00 / F3** · `lib/ranking/cronAuth.ts` es funcionalmente
      idéntico a `lib/ingest/cronAuth.ts` (B08). No se importa el de B08 porque
      `lib/ingest/**` es propiedad exclusiva suya y atar el arranque del cron del
      ranking a los cambios de la ingesta de contenido no tiene ningún sentido.
      Es un candidato claro a subir a `lib/cronAuth.ts` compartido: es código de
      seguridad y tenerlo duplicado significa que un arreglo puede aplicarse solo
      en una de las dos copias · 2026-08-03
- [ ] **De B06 → B00** · desviación del contrato de tipos de la ficha:
      `TableroRanking.construidoEn` es `string | null`, no `string`. Una página
      vacía no tiene ninguna fila de la que leer `built_at`, y las dos
      alternativas eran peores: devolver `now()` afirma que la foto se acaba de
      construir cuando puede que no exista, y una consulta extra solo para datar
      un tablero vacío rompe el presupuesto de 2 consultas por render ·
      2026-08-03
- [ ] **De B06 → B17 · deuda de traducción.** Los textos de UI de B06 van en
      español directo (el catálogo i18n llegó en paralelo). Archivos a traducir:
      `components/ranking/{Podio,Tablero,InsigniaMovimiento,SelectorPeriodo,MiPosicion}.tsx`,
      `app/(app)/ranking/page.tsx` y `lib/ranking/tipos.ts` (`ETIQUETA_PERIODO`).
      Ojo con dos que NO son literales sueltos: el plural de «persona acompañada
      / personas acompañadas» y el de «sube N puesto / puestos» necesitan reglas
      de plural, no concatenación · 2026-08-03
- [ ] **De B06 → B14 / operaciones · el proyecto `darma-dev` se quedó SIN DISCO
      durante la medición** (`53100: No space left on device`), con la base en
      ~790 MB. No fue un bloque solo: coincidieron los 275 MB de `poll_votes` de
      B09 con la siembra de B06. Efectos observados: la construcción abortó a
      media faena, un `VACUUM FULL` tampoco cupo (necesita espacio para la copia)
      y solo se recuperó con `TRUNCATE`, que sí devuelve el espacio al sistema de
      ficheros. Dos peticiones: (1) subir el disco de `darma-dev` antes de que
      B14 haga su siembra de 1 M de filas, y (2) que cada bloque limpie al
      terminar — B06 dejó sus dos tablas a 0 filas y borró sus 100 006 perfiles y
      usuarios de prueba · 2026-08-03
- [ ] **De B06 → B14 · mejora de índice medida a medias, NO aplicada.** El
      agregado semanal del constructor usa `idx_listen_daily_day` como debe
      (`Index Cond: day >= .. AND day < ..`), pero necesita el heap para leer
      `listens`: 88 140 buffers para 109 098 filas. Un
      `(day, user_id) include (listens)` lo convertiría en index-only scan. No se
      ha aplicado porque **no cupo en disco para medirlo**, y no se sube un
      índice que no se ha comparado. Con espacio, la comparación es de cinco
      minutos · 2026-08-03
- [ ] **De B19 → F1 / B12 · `spend_karma()` escribe los GASTOS con un `kind` que
      miente.** En `0001_core.sql`, `spend_karma()` inserta en `karma_events`
      con `kind = 'comment_validated'` aunque sea un gasto. **Medido contra
      Postgres** con 30 000 eventos sembrados: agrupar por `kind` daba
      `sum(delta_spendable) = -175 000` para «comentario validado», un número
      que no significa nada; agrupando por el SIGNO de los deltas salen los dos
      valores reales (250 000 emitidos / 250 100 drenados). El rollup de B19 ya
      agrupa por signo, así que el panel es correcto — pero **cualquier otra
      consulta del repo que agrupe el ledger por `kind` está mal**, y el propio
      ledger deja de ser auditable por tipo de movimiento. No se ha tocado
      `0001` (ya está aplicada): hace falta un `kind` propio para el gasto en
      una migración nueva de F1, más un backfill · 2026-08-03
- [ ] **De B19 → B12 · catálogo de precios de los paquetes de cristales.**
      `crystal_ledger` guarda el delta de cristales, no el precio, así que el
      ingreso y el ARPPU no salen de ahí. B19 los deriva del `raw_receipt`
      cuando trae `price_cents` y, si no, de un **stub local** en
      `app/(admin)/_lib/precios.ts` (clave = tamaño del paquete, no nombre
      comercial: un nombre lo cambia marketing y rompe la serie histórica ya
      escrita en `admin_metrics_daily`). Se pide que `lib/billing/` exponga el
      catálogo real; en cuanto exista, `precios.ts` se reduce a un re-export.
      Mientras tanto el panel marca el ingreso como **estimado** en pantalla ·
      2026-08-03
- [ ] **De B19 → B11 · cerrar TODOS los casos de crisis, no solo los que se
      miran.** Corrección de un supuesto que circulaba: `human_reviewed` **sí**
      se escribe hoy — lo hace `atenderCrisis()` en `lib/ai/cola.ts` junto con
      `attended_at`, `reviewer_id` y `outcome`. Lo que queda abierto es otra
      cosa: ese es el **único** camino que lo escribe, así que la cobertura del
      100 % que exige B19 solo es real si la cola de `/moderacion` acaba
      cerrando cada evento de riesgo `high`/`critical`. Cualquier caso que se
      revise «de vista» sin pulsar atender cuenta como no revisado, y con razón.
      Petición concreta: que el panel de moderación no deje salir de un caso sin
      resolverlo, o que exista un motivo explícito de cierre («falso positivo»)
      que también marque `human_reviewed` · 2026-08-03
- [ ] **De B19 → B11 · sustituir la allowlist de moderadores por el rol de la
      base.** `lib/ai/acceso.ts` decide quién es moderador con
      `MODERATION_ADMIN_IDS`, una lista de uuids en una variable de entorno.
      B19 ya tiene lo que hacía falta: `public.admin_roles` +
      `tiene_rol_admin(p_user, 'moderador')`, `security definer`, concedida solo
      a `service_role`. Cambio propuesto para B11: `esModerador(userId)` pasa a
      ser `await tiene_rol_admin(userId, 'moderador')`. Motivo, además del
      obvio: una lista en el entorno se cambia desde un panel, sin revisión, sin
      registro y sin que nadie se entere; `admin_roles` deja `granted_by`,
      `granted_at` y `revoked_at`, y cada acceso queda en `admin_audit_log`.
      **Ojo, hay acoplamiento ya:** `app/(admin)/layout.tsx` (de B19) envuelve
      `/moderacion` y exige rol mínimo `soporte` en `admin_roles`, así que hoy
      un moderador que esté en la allowlist pero **no** en `admin_roles` recibe
      un 404 del layout antes de llegar a la página · 2026-08-03
- [ ] **De B19 → B02 · no existe registro de «lectura de un post».** El cuarto
      escalón del embudo de activación de B19 («primera lectura») se aproxima
      hoy con la primera **interacción** con un post (`post_votes`), porque en
      el esquema no hay ninguna tabla de lecturas. La aproximación **subestima**
      el escalón: mucha gente lee y no vota, y precisamente el perfil de quien
      llega a Darma a leer sin participar es el que más importa medir. Si B02
      añade alguna vez una señal de impresión o de lectura, B19 la consume desde
      el rollup sin tocar el panel · 2026-08-03
- [ ] **De B19 → B00 · tres desviaciones conscientes del contrato de la ficha
      B19.md.** (1) `Economia` lleva un campo extra `ingresoEstimado: boolean`:
      sin él la UI no puede distinguir el ingreso medido del estimado, y un
      número que no hace esa distinción acaba en una previsión. (2)
      `TiempoPrimeraRespuesta` y `CoberturaCrisis` llevan además una `serie`,
      igual que `SaludReciprocidad`, porque las páginas de detalle la necesitan
      y pedirla por separado costaría una consulta más. (3) Los imports de
      `app/(admin)/_lib/**` son **relativos** y no con el alias `@/`
      (CONTRATOS §1): `node --test --experimental-strip-types` no resuelve el
      alias y la ficha exige poder probar esos módulos sin arrancar Next. Mismo
      criterio que ya siguen las pruebas de B02 y B06 bajo `app/` · 2026-08-03
- [ ] **De B19 → B00 / operaciones · el PRIMER superadmin se siembra a mano, a
      propósito.** `admin_conceder_rol()` exige ya ser superadmin, así que no
      hay forma de crear el primero desde la aplicación — y es correcto que no
      la haya: un endpoint de «bootstrap» abierto cuando la tabla está vacía es
      una escalada de privilegios esperando a que alguien despliegue con la
      tabla vacía. El alta inicial es un `insert into public.admin_roles
      (user_id, role) values ('<uuid>','superadmin')` ejecutado con acceso
      directo a la base, y conviene que quede documentado en el runbook de
      despliegue · 2026-08-03
- [ ] **De B19 → B14 / B15 · ocho índices nuevos sobre tablas de otros
      bloques.** `0191_1_b19_admin.sql` añade (solo añade, no modifica nada):
      `idx_comments_rollup_dia`, `idx_posts_rollup_dia`,
      `idx_karma_events_rollup_dia`, `idx_crystal_ledger_rollup_dia`,
      `idx_crisis_rollup_dia`, `idx_profiles_rollup_dia`,
      `idx_profiles_karma_diario` (parcial) y `idx_post_votes_user`. Ninguno
      existía: todos los índices temporales del esquema son por (autor, fecha) o
      por (post, fecha), y el rollup corta por fecha GLOBAL. Sin ellos el rollup
      es un `Seq Scan` sobre `comments`. **Medido**: con 36 008 comentarios y
      9 002 posts sembrados, el rollup de un día tarda **20,5 ms** y usa
      `Index Only Scan` en `comments` (Heap Fetches: 3) y `Bitmap Index Scan` en
      `posts`. Coste: escritura marginalmente más cara en esas cinco tablas ·
      2026-08-03
- [ ] **De B19 → B17 · deuda de traducción.** Los textos de UI de B19 van en
      español directo. Archivos a traducir:
      `app/(admin)/panel/page.tsx`, `app/(admin)/panel/{reciprocidad,crisis,activacion,economia}/page.tsx`,
      `app/(admin)/_componentes/{TarjetaMetrica,TablaSerie,Sparkline,NavegacionAdmin}.tsx`,
      `app/(admin)/_componentes/Formato.ts` (unidades «s / min / h / d» y los
      `toLocaleString('es-ES')`) y `TABS_ADMIN` en
      `app/(admin)/_lib/navegacion.ts`. Ojo con dos cosas que no son literales
      sueltos: las unidades de duración necesitan reglas de plural, y el
      formato de número y moneda debe seguir al locale, no quedarse fijo en
      `es-ES` · 2026-08-03

### B18 · E2E con Playwright

- [x] **De B18 → F4 (`package.json`)** · **añadir Playwright a
      `devDependencies`.** Comando exacto:
      ```bash
      npm i -D @playwright/test@^1.62.1
      npx playwright install --with-deps chromium webkit
      ```
      Y dos scripts:
      ```json
      "e2e": "playwright test",
      "e2e:ui": "playwright test --ui"
      ```
      B18 **no ha editado `package.json` ni `package-lock.json`** (árbol
      compartido): instaló con `npm i --no-save --no-package-lock
      @playwright/test`, que deja los dos archivos intactos. Mientras no se
      integre, la suite solo corre en una máquina donde alguien haya repetido
      ese comando. Comprobado: `git status` limpio fuera de `e2e/**`,
      `playwright.config.ts`, `PEDIDOS.md` y `ESTADO.md` · 2026-08-03
      → **Resuelto 2026-08-05:** `@playwright/test@^1.62.1` ya está en
      `devDependencies` (llegó con una integración anterior) y los dos scripts
      `e2e` / `e2e:ui` se añaden hoy, tal cual se pedían
- [x] **De B18 → F4 (`.env.example`)** · documentar
      **`E2E_SUPABASE_PROJECT_REF`** (y opcionalmente `E2E_PORT`). Es el segundo
      cerrojo del fusible anti-producción de `e2e/utils/admin.ts`: contra una
      base remota, la suite se niega a ejecutarse si el ref del proyecto no está
      declarado a mano. Se pide una variable propia a propósito — si bastara con
      «la URL que hay en `.env.local`», apuntar la suite a producción sería
      cambiar una variable que ya existe · 2026-08-03
      → **Resuelto 2026-08-05:** las dos documentadas en `.env.example`
      (sección «Solo desarrollo y pruebas»), junto con
      `NEXT_PUBLIC_E2E_STUB_PLAYER`, la bandera del stub del reproductor que
      SOLO declara el `webServer` de `playwright.config.ts`

- [x] **De B18 → F4 / B11 · 🔴 BLOQUEANTE DE DESPLIEGUE: `/ayuda` NO EXISTE.**
      `components/ui/BotonCrisis.tsx` enlaza a `/ayuda`, `components/feed/TarjetaPost.tsx`
      también, la landing igual, y `proxy.ts:44` la declara ruta pública «por
      razones que no son técnicas». Pero **no hay ninguna `app/**/ayuda/page.tsx`**:
      el botón de crisis de TODA la app lleva a un 404. Es el hallazgo más grave
      de este bloque. Prueba escrita y en `test.fixme()` apuntando a esta línea:
      `e2e/specs/09-proxy-sin-sesion.spec.ts` › «/ayuda es alcanzable SIN sesión
      y existe de verdad». Quítale el `fixme` en cuanto la página exista ·
      2026-08-03
      → **Resuelto 2026-08-05:** `app/ayuda/page.tsx` existe y sigue pública en
      `proxy.ts`; el `fixme` queda retirado hoy y la prueba corre como prueba
      de verdad
- [x] **(Resuelto 2026-08-05: la clave ya sirve — el global setup la valida y
      los recorridos corren de verdad; `06-feed-video` 4/4 en chromium. La fila
      queda como historia.) De B18 → HUMANO · `SUPABASE_SERVICE_ROLE_KEY` no sirve contra `darma-dev`.**
      En `.env.local` está vacía; la que hay heredada del shell (`sb_secret_…`)
      la rechaza el proyecto con `Invalid API key … This API key might also be
      owned by another Supabase project` — **probablemente es de OTRO proyecto**,
      lo que además es un riesgo en sí mismo. Consecuencias medidas hoy: casi
      toda ruta de escritura devuelve `error_interno` (incluidas
      `POST /api/auth/anonimo`, `/api/posts`, `/api/comments`, `/api/content/*`
      y hasta `GET /api/me`, todas vía `createAdminClient()`), y los fixtures de
      B18 no pueden crear usuarios. Los recorridos (a)–(f) quedan en
      `test.fixme()` con el motivo y **se ejecutarán solos** en cuanto la clave
      correcta esté puesta: el global setup la PRUEBA de verdad con una lectura
      mínima en vez de fiarse de que la variable exista · 2026-08-03

- [ ] **De B18 → B03 · `data-testid` en el composer de `/publicar`.** Hacen falta
      dos: `data-testid="escuchas-hechas"` con el número de escuchas hechas, y
      uno en el `<p>` del mensaje de reciprocidad (hoy no tiene `id`, ni `role`,
      ni nada). Ojo: hoy `escuchas-hechas` es **inconstruible** sin cambiar el
      contrato de props — `app/(app)/publicar/page.tsx` pasa al `Composer` la
      FRASE de `reciprocityMessage()` y un booleano, nunca el número, y la
      cabecera del archivo lo justifica. Mientras tanto `PublicarPage.escuchasHechas()`
      DERIVA el número comparando el texto pintado con lo que produce
      `reciprocityMessage()` para cada estado; funciona, pero se rompe con
      cualquier cambio de copy · 2026-08-03
- [ ] **De B18 → B03 / B04 / B10 / B16 · unificar la tarjeta de recursos de crisis.**
      Hay **cuatro marcados distintos** para lo mismo y ninguno lleva
      `data-testid`: `components/composer/TarjetaRecursos.tsx`
      (`<section aria-labelledby="recursos-titulo">`, el único con ancla estable
      y el único con `tel:`), `components/thread/CompositorRespuesta.tsx`
      (sin id, sin `aria-live`, sin `h2`, **sin `tel:`** — el teléfono va como
      texto plano y no se puede marcar), `components/refuge/TarjetaCrisis.tsx`
      (`role="note" aria-label="Recursos de ayuda"`) y el pie de
      `components/feed/TarjetaPost.tsx`. Además los campos se llaman en español
      en un contrato (`nombre`, `telefono`, `horario`) y en inglés en el otro
      (`name`, `phone`, `hours`). Propuesta: un solo componente en `components/ui`
      con `data-testid="tarjeta-recursos"` y `tel:` siempre. **La pantalla de
      crisis es la que menos margen tiene para variar entre superficies** ·
      2026-08-03
- [ ] **De B18 → B05 · `data-testid` en `MedidorKarma` y en `PanelPrivado`.**
      El medidor solo se localiza por `role="progressbar"` sin nombre accesible
      propio o por `[data-nivel]`; el panel privado, por
      `section[aria-labelledby="titulo-panel-privado"]`. Funciona, pero son
      anclas de implementación · 2026-08-03
- [ ] **De B18 → B01 · el registro por API rechaza los dominios sintéticos.**
      Comprobado contra `darma-dev`: `signup` devuelve `email_address_invalid`
      para `.test`, `.local` y `.example.com`, y `over_email_send_rate_limit`
      para dominios reales. Los usuarios de prueba con sesión REAL solo se
      pueden crear con `auth.admin.createUser()` (service_role) o por SQL con
      `crypt()` y las columnas de token a cadena vacía. Anotado aquí porque
      afecta a cualquier bloque que quiera sesiones reales en sus pruebas ·
      2026-08-03
- [ ] **De B18 → B15 / F1 · la Trampa #1 de la ficha YA ESTÁ CERRADA (informativo).**
      La ficha avisaba de que `profiles_read ... using (true)` dejaba leer
      `karma_spendable` y `crystals` de cualquiera por PostgREST. Verificado hoy
      contra `darma-dev` con una sesión `authenticated` real: **devuelve 42501**.
      `0001_core.sql` ya lleva `revoke select on public.profiles from anon,
      authenticated` + `grant select (id, alias, avatar_seed, bio,
      karma_reputation, level, availability, created_at, last_seen_at)`, y la
      única puerta a los saldos es `mi_perfil_privado()`. Por eso el recorrido
      (e) de B18 va como prueba de verdad y **no** como `fixme`: dejarlo
      aparcado sería quitar la vigilancia justo de la línea que cierra el
      agujero. Que nadie «simplifique» ese `grant` por columnas · 2026-08-03

## Correcciones de integración (B00 · 2026-08-03)

- [x] **CERRADO — no era un fallo.** B19 anotó que `spend_karma()` escribe los
      gastos con `kind = 'comment_validated'` y midió −175 000 al agrupar por
      clase. **Verificado contra `darma-dev`: la función desplegada usa
      `karma_spend`** (`prosrc ilike '%''karma_spend''%'` → true,
      `'comment_validated'` → false). El arreglo entró en `0001_core.sql` antes
      de aplicar el esquema. La cifra de B19 sale de su propia siembra, que
      insertó eventos negativos con la clase antigua. **Agrupar por `kind` es
      correcto**; no hace falta agrupar por signo del delta. Si el panel lo hace
      por signo, se puede simplificar.
- [x] **CERRADO.** `crisis_events.human_reviewed` sí se escribe: lo hace
      `atenderCrisis()` de B11. Queda abierto solo que ese es el ÚNICO camino,
      así que la cobertura del 100 % depende de que la cola cierre cada caso.
- [ ] **De B19 → B11** · unificar la autorización de administración: el panel
      exige rol en `admin_roles` y `lib/ai/acceso.ts` usa la allowlist
      `MODERATION_ADMIN_IDS`. Un moderador que esté en la allowlist pero no en
      la tabla recibe hoy un 404. Debe mandar `tiene_rol_admin()`: una lista de
      identificadores en una variable de entorno es exactamente lo que la ficha
      de B19 prohibía.
- [ ] **De B12 → F4 · `proxy.ts` bloquea los dos webhooks de la tienda.**
      `PUBLIC_ROUTES` no incluye `/api/billing/`, así que una petición sin cookie
      a `/api/billing/webhook/apple` o `/api/billing/webhook/google` recibe un
      401 JSON antes de llegar al handler. Apple y Google lo interpretan como
      fallo y **reintentan durante días sin éxito**, con lo que las compras
      quedan sin acreditar hasta que la persona toca «Restaurar compras». Hace
      falta añadir exactamente `/api/billing/webhook/` (el prefijo, no todo
      `/api/billing/`: el resto de rutas del bloque sí exigen sesión). No he
      tocado `proxy.ts`; los handlers están probados invocándolos directamente ·
      2026-08-03
- [ ] **De B12 → F2 / B15 · queda cerrado en `0121_1`, pero conviene revisarlo.**
      `crystal_ledger_read_own` de `0002` deja leer la FILA ENTERA al dueño, y la
      fila entera incluye `raw_receipt` (recibo crudo de la store: lleva
      `appAccountToken`, `originalTransactionId` y, en algunos formatos, el
      correo de la Apple ID) y `external_id`. Un cliente con la anon key los
      pedía con `?select=raw_receipt`. Eso rompe CONTRATOS §2. La ficha B12 pedía
      solo anotarlo; se ha cerrado además en `0121_1` §3 con `revoke select` +
      `grant select` enumerado, porque dejar un dato de identidad legible
      mientras se tramita el pedido no era una opción. Si F2 prefiere otra forma,
      que la sustituya — pero no que la quite · 2026-08-03
- [ ] **De B12 → F2 / B00 · ⚠️ una migración de B12 RELAJA un CHECK de `0002`.**
      `0121_1` §1 cambia `boosts.amount check (amount > 0)` por `>= 0`. Motivo:
      la ficha B12 §7 exige que el boost del cupo gratuito se registre con
      `currency 'karma', amount 0`, y las dos cosas no podían ser verdad a la
      vez. Descartado no insertar fila (el techo de 3/día dejaría de contarlos y
      la transparencia pública se perdería) y descartado registrar `amount = 50`
      con una columna `es_gratis` (mentir en la columna que dice cuánto pagó la
      persona). Es una relajación —nada que fuera válido deja de serlo— y ningún
      otro bloque escribe en `boosts`, pero **no es aditiva** y por eso se pide
      revisión explícita · 2026-08-03
- [ ] **De B12 → B14 · cron nocturno de reconciliación `crystal_ledger` ↔
      `profiles.crystals`.** `crystals` es solo un caché; la verdad es el `sum()`
      del ledger. Hoy no hay nada que compare los dos ni que avise si divergen, y
      si divergen **gana el ledger** (no se «arregla» el caché a mano). Basta un
      `select user_id from crystal_ledger group by 1 having sum(delta) <>
      (select crystals from profiles p where p.id = user_id)` en un cron diario,
      con alerta si devuelve alguna fila · 2026-08-03
- [ ] **De B12 → F2 / B05 · faltan columnas para los cosméticos de perfil.**
      `lib/billing/cosmeticos.ts` tiene el catálogo y la validación
      (`prohibidoPorqueImitaNivel`, con test), pero **la propiedad no se
      persiste**: harían falta `profiles.cosmetic_frame` y
      `profiles.cosmetic_palette` (text, nullable, sin `grant update` a
      `authenticated` — se escriben desde el servidor tras cobrar). `profiles` es
      de los cimientos, así que no lo toco. Mientras tanto los cosméticos se
      muestran sin ruta de compra, en vez de inventar un almacenamiento paralelo
      que luego haya que migrar · 2026-08-03
- [ ] **De B12 → F4 / app móvil · el puente nativo `window.darmaIAP` no existe.**
      `components/economia/BotonComprar.tsx` espera
      `window.darmaIAP.comprar(sku) → { plataforma, token }`, que debe lanzar
      StoreKit o Play Billing y devolver el `transactionId` de Apple o
      `productId|purchaseToken` de Google. Sin él el botón se deshabilita y dice
      «Solo en la app», que es lo correcto: abrir un checkout web por bienes
      digitales es motivo de retirada de la ficha en las dos plataformas. **La
      app debe fijar `appAccountToken` (Apple) y `obfuscatedExternalAccountId`
      (Google) al `profiles.id`**: sin eso el webhook no sabe a quién acreditar ·
      2026-08-03
- [ ] **De B12 → F4 · once variables de entorno de IAP en `.env.example`.**
      Apple: `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`
      (contenido del `.p8`), `APPLE_BUNDLE_ID`, `APPLE_ROOT_CA_SHA256` (huella
      SHA-256 de Apple Root CA - G3, separadas por comas) y `APPLE_IAP_ENTORNO`.
      Google: `GOOGLE_PLAY_PACKAGE`, `GOOGLE_PLAY_CLIENT_EMAIL`,
      `GOOGLE_PLAY_PRIVATE_KEY`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT` y
      `GOOGLE_PUBSUB_AUDIENCE`. **Ninguna lleva `NEXT_PUBLIC_`**, y sin ellas el
      bloque hace fail-closed: no verifica y no acredita. Además,
      `SUPABASE_SERVICE_ROLE_KEY` está **vacía** en `.env.local`, así que hoy
      ninguna ruta que use el cliente admin funciona en local · 2026-08-03
- [ ] **De B12 → producto · reembolsos sin apunte inverso.** Los dos webhooks
      detectan `REFUND`/`REVOKE` (Apple) y `voidedPurchaseNotification` (Google)
      y los registran, pero **todavía no insertan el movimiento contrario con
      `source = 'refund'`**. La parte técnica es trivial; lo que falta es la
      decisión de producto: qué hacer cuando la persona ya se gastó los
      cristales, porque `profiles.crystals` tiene `check (crystals >= 0)` y el
      saldo no puede quedar negativo. Dos opciones razonables (saldo a 0 y deuda
      registrada, o bloqueo de nuevas compras hasta compensar) y ninguna es
      obviamente correcta · 2026-08-03
- [ ] **De B12 → B15 / operaciones · la prueba de concurrencia de N conexiones
      no se pudo ejecutar.** El caso nº 6 de la ficha pide tres webhooks
      simultáneos contra la base real. En este entorno no hay forma de abrir tres
      conexiones a la vez: `dblink` exige contraseña de la base (no disponible) y
      `SUPABASE_SERVICE_ROLE_KEY` está vacía, así que tampoco se puede llamar a
      la RPC por HTTP. Lo que sí se ejecutó: tres filas idénticas en una sola
      sentencia con `on conflict do nothing` → 1 insertada (misma máquina de
      inserción especulativa que arbitra a varios insertadores), y reintentos en
      transacciones y **sesiones distintas** (pids 29818, 29827, 30452, 30466) →
      `acreditado:false` con el saldo congelado. Con credenciales de base, la
      prueba de verdad es de cinco minutos · 2026-08-03
- [ ] **De B12 → B17 · deuda de traducción.** Los textos de UI de B12 van en
      español directo. A traducir: `lib/billing/textos.ts` (las cinco frases,
      incluida la de la línea roja: **esa debe traducirse con revisión humana**,
      no automáticamente — es la promesa del producto),
      `components/economia/*.tsx`, las etiquetas de `lib/billing/catalogo.ts`,
      `regalos.ts` y `cosmeticos.ts`, y los mensajes de
      `errorDeBoost`/`errorDeRegalo`. Ojo con el plural de «1 cristal /
      N cristales», que necesita regla de plural y no concatenación · 2026-08-03
      · **Actualización 2026-08-03:** hecho todo salvo dos cosas, que tienen
      pedido propio más abajo: los mensajes de `errorDeBoost`/`errorDeRegalo`
      (bloqueados por la forma del sobre de error, pedido a B01) y
      `cosmeticos.ts` (no llega a ninguna pantalla todavía). La petición de que
      la frase de la línea roja se revise con una persona sigue en pie: el texto
      inglés de `karma.economia.lineaRoja` viene de la migración de i18n y esta
      sesión no lo ha reescrito, solo lo ha convertido en la única fuente
- [ ] **De B12 → B02 · el feed puede pintar el distintivo de «impulsado».**
      `boost_vivo(post_id)` está en `0121_1` §8 y devuelve `(id, expires_at)` del
      boost vivo usando `idx_boosts_active` (3 buffers, 0,11 ms medido). Es
      `security invoker` y se apoya en `boosts_read`, que es público a propósito:
      un post impulsado se marca como tal, igual que un anuncio. **`user_id`,
      `currency` y `amount` ya NO son legibles** (`0121_1` §3): «este post está
      impulsado» es transparencia, «esta persona pagó 50 cristales» es su
      historial de gasto · 2026-08-03
- [ ] **De B12 → B04 / B05 · dónde enganchar la UI de economía.**
      `components/economia` exporta `DialogoBoost` (necesita `postId` y el
      `EstadoBoost` de `GET /api/billing/boost`), `SelectorRegalo` (para el hilo,
      con `refType`/`refId`) y `TiendaCristales`/`HistorialCompras` (para el
      perfil). No he creado ninguna página bajo `app/(app)/**` porque no es mío:
      los componentes están listos para montarse donde B04 y B05 decidan ·
      2026-08-03
- [ ] **De la migración i18n de refugios/economía → integración (B00) · hay que
      aplanar `messages/parches/*.json` dentro de `messages/*.json`.** La
      migración del copy a `t('...')` la hicieron varias sesiones a la vez y
      `messages/es.json` es un único archivo compartido, así que cada grupo dejó
      sus claves en `messages/parches/<bloque>.<locale>.json` y
      `i18n/parches.ts` las fusiona sobre el catálogo base (no destructivo: lo
      que ya existe en `messages/*.json` gana). Funciona en producción tal cual,
      pero es andamio: cuando cierren todas las sesiones, un commit de
      integración copia los parches al catálogo, borra `i18n/parches.ts` y
      devuelve `MENSAJES` a los dos imports de siempre. El guard de paridad
      (`i18n/claves.test.ts`) ya compara el catálogo FUSIONADO, así que la
      operación es verificable · 2026-08-03
- [x] **CERRADO · una sola fuente para la frase de la línea roja.**
      `lib/billing/textos.ts` ya no guarda texto: guarda las CLAVES
      (`CLAVE_LINEA_ROJA`, …). `/api/billing/catalog` y `/api/billing/boost`
      devuelven `lineaRojaClave` / `explicacionClave` / `explicacionCupoClave` en
      vez de la frase en español —una ruta no sabe en qué idioma lee quien
      pregunta— y `FraseLineaRoja` importa la misma constante en vez de teclear
      la clave. `lineaRoja.test.ts` comprueba ahora los tres eslabones: el
      componente está en las cuatro superficies de pago, resuelve esa clave, y la
      clave tiene texto en los dos idiomas; además falla si la frase vuelve a
      aparecer escrita a mano en `lib/billing/**`, `app/api/billing/**` o
      `components/economia/**` · 2026-08-03
- [x] **CERRADO · las etiquetas de datos son claves de catálogo.**
      `PaqueteCristales.claveEtiqueta`, `DefinicionRegalo.claveEtiqueta` y
      `opcionesDePago().claveEtiqueta` (con el coste aparte, para que el plural
      de «1 cristal / N cristales» lo decida cada idioma y no una concatenación).
      Claves nuevas en los dos catálogos: `karma.economia.paquetes.*`,
      `karma.economia.regalos.*` y `karma.economia.boost.opciones.*`. Traduce la
      vista, no el módulo. `lib/billing/textos.test.ts` comprueba que toda clave
      que pide el código existe con texto en es y en en —el guard de paridad de
      i18n no ve eso: una clave que no existe en ninguno de los dos catálogos
      está perfectamente equilibrada— y el guard de «ningún regalo promete karma
      en su etiqueta» mira ahora el texto de LOS DOS idiomas, no la clave ·
      2026-08-03
- [ ] **De B12 → B01 · el sobre de error no puede llevar una traducción, y por
      eso quedan dos mensajes de la economía en español en pantalla.**
      `RespuestaError` (CONTRATOS §4) es `{ ok, code, message, retryAfter }`, con
      `message` en un solo idioma. La regla de la casa es pintar
      `traducirCodigoError(code)` y no `message` (así lo hacen
      `components/auth/**`), pero en la economía eso perdería los dos únicos
      mensajes que dicen algo que el código no dice: DA004 «Este post no se puede
      impulsar ahora mismo» (`sin_permiso`) y DA005 «Ya has impulsado 3 veces hoy»
      (`demasiadas_peticiones`, que con la clave genérica saldría como «prueba
      otra vez en 40 000 segundos»). Hace falta un campo más en el sobre —una
      clave de catálogo opcional y sus parámetros— o `errores.*` deja de poder
      explicar los casos con matiz. Mientras tanto, `BotonImpulsar` y
      `BotonRegalar` siguen pintando `message`, que en una sesión en inglés sale
      en español · 2026-08-03
- [ ] **De B12 → B12 (cuando exista la UI de cosméticos) · `cosmeticos.ts` sigue
      en español.** `etiqueta` y `descripcion` de `CATALOGO_COSMETICOS` salen por
      `/api/billing/catalog` en español. Hoy no llegan a ninguna pantalla (la
      propiedad de un cosmético no se persiste y no hay ruta de compra), así que
      no se han migrado a claves. Cuando se migren, ojo: el guard
      `prohibidoPorqueImitaNivel()` compara la ETIQUETA contra una lista de
      palabras en español. Con claves, tendría que comparar el texto de los dos
      catálogos, o un cosmético llamado «Mentor Crown» solo en inglés pasaría el
      guard sin que nadie lo vea · 2026-08-03
- [ ] **De la migración i18n → F3 · `helpResourcesFor().hours` es español fijo.**
      `crisis.tarjeta.horario24` ya existe en los dos idiomas, pero
      `lib/crisis.ts` devuelve «24 h, todos los días» / «Según el país» como
      texto libre dentro de la fila del recurso. La tarjeta de crisis del
      refugio ya está traducida salvo ese campo, y es la pantalla que menos
      puede permitirse una frase en un idioma que no se entiende · 2026-08-03
- [ ] **De la migración i18n → B07/B08 · `/animo` sigue pidiendo el catálogo de
      vídeos en `'es'`.** El `IDIOMA_POR_DEFECTO` provisional de
      `app/(app)/animo/page.tsx` esperaba a B17; ahora el locale se resuelve,
      pero la constante se ha dejado fija (renombrada a `IDIOMA_DEL_CATALOGO`) a
      propósito: pasar el locale a `feed_animo()` cambia qué filas vuelven y
      dejaría `/animo` vacía si el catálogo no tiene vídeos en inglés. Hace falta
      decidir el fallback (¿inglés y si no hay, español?) antes de conectarlo ·
      2026-08-03

## Pedidos añadidos el 2026-08-04 (feed de vídeo)

- [ ] **De `/animo` → producto** · **`HANDOFF/B21.md` es la ficha del port desde
      DataLaps.** `/animo` funciona y está vacío: la primera ingesta real trajo 80
      piezas y ninguna era de salud mental. `C:\DataLaps\Pod_PilotSimulator` ya
      resolvió descubrimiento por Data API, clasificación por IA, allowlist de
      canal y feed vertical con autoplay. B21 dice qué se porta, **qué NO** (el
      cribado de PII y la puerta de MP4 no aplican: Darma incrusta, no aloja) y en
      qué orden. Los tres primeros pasos no necesitan ninguna clave nueva.
- [ ] **De B21 → B08** · las fuentes de canal y playlist deben leerse con
      `playlistItems.list` (**1 unidad** de cuota), nunca con `search.list` (**100
      unidades**). DataLaps agotó sus 10.000 diarias haciendo lo segundo, con 429
      confirmado en producción el 2026-07-29.
- [ ] **De B21 → B08** · guarda de idioma de AUDIO antes de clasificar
      (`snippet.defaultAudioLanguage` vía `videos.list`). Ya hay un vídeo que la
      dispara: `yt:who_social_connection` es inglés con títulos que parecen
      universales. En DataLaps esto fue un incidente real con un vídeo publicado.
- [ ] **De B21 → B11** · sin `MODERATION_API_KEY`, abrir `search.list` es apuntar
      una manguera a una cola sin filtro. El clasificador por IA va DESPUÉS de la
      clave, no antes.

## Pedidos de la integración de B21 §1–§4 (2026-08-04)

Los cuatro módulos están en `main` y **no los llama nadie todavía**. Cablearlos
toca archivos de B08 y exige una migración; queda aquí porque cada sesión lo
reportó desde su worktree y ninguna podía aplicarlo.

- [ ] **De B21 → B08 · una migración, dos motivos.** `ingest_log.decision` tiene
      un CHECK cerrado y **no hay valor** para «rechazado por idioma» ni para
      «canal no permitido». **Dos sesiones aisladas chocaron con el mismo hueco
      por caminos distintos**, que es la mejor señal de que existe. Sin él, los
      rechazos se registran como `rejected_quality` o `rejected_embed`, que
      MIENTEN sobre la causa — y la causa es justo lo que se querrá consultar.
- [ ] **De B21 → B08 · `ejecutar.ts` es quien cablea.** Orden: sonda de embed →
      `verificarCanalDeEmbed()` → `resolverIdiomaAudio()` → `clasificar()`.
      Contrato: `no_es_espanol` y `rechazado` → rechazo; **`desconocido` y
      `pendiente_revision` → `pending`, nunca aprobación**. Y crear UN
      `crearContadorCuota()` por corrida, pasarlo a todas las fuentes y emitir
      `cuota.resumen()` con `ingesta_ejecutada`: los `cortes` son la alarma
      temprana de que la cuota se está agotando.
- [ ] **De B21 → B08 · una sola llamada para dos guardas.** El resolutor de canal
      (§4) y la guarda de idioma (§2) necesitan el MISMO `videos.list?part=snippet`.
      Resueltas juntas cuestan **1 unidad en vez de 2**. Lo vio §4 mirando el
      trabajo de §2; ninguna de las dos podía verlo sola.
- [ ] **De B21 → B08 · `channelId` no sobrevive a `normalizar()`.** `EntradaCruda`
      y `CandidatoContenido` no lo llevan, así que la allowlist debe correr ANTES
      de normalizar, o los dos tipos necesitan `channelId?: string | null`.
- [ ] **De B21 → B08 · cupo diario persistente.** El presupuesto de `cuota.ts` vive
      en memoria: no sobrevive a un reinicio ni a dos instancias. Falta el
      equivalente a `ingest_consume_model_budget` en Postgres. Se dejó fuera a
      propósito: un round-trip por unidad cuesta más de lo que ahorra.
- [ ] **De B21 → B07 · decidir sobre `components/animo/`.** La rama `b21-3-autoplay`
      NO se fusionó: B07 ya había entregado `components/video/{useAutoplayEnVista,
      desbloqueoAudio}.ts` y `lib/video/{autoplay,audio}.ts`, y la ficha B21 §3 los
      daba por nuevos. Se portaron **solo las dos mejoras reales** a
      `lib/video/autoplay.ts` (desempate por superficie y su prueba). La rama sigue
      viva por si se quiere rescatar algo más: tiene una prueba que lee el propio
      archivo y falla si aparece `sessionStorage`/`localStorage`, que merece
      copiarse a `components/video/desbloqueoAudio.ts`.
- [ ] **De B21 → B00 · corregir `HANDOFF/B21.md` §3**, que lista como nuevos dos
      archivos que ya existían con otro directorio. Error de quien escribió la
      ficha (2026-08-04) por no mirar `components/video/` antes.

## Pedido abierto por la primera corrida con guardas (2026-08-04)

- [ ] **De B21 → producto · ¿admite `/animo` contenido en inglés?** La guarda de
      idioma funciona y su primera corrida real rechazó **30 vídeos por
      `audio_declarado_no_espanol`**, entre ellos **las 13 historias de «The
      Social Connection Series» de la OMS** — que se habían añadido ese mismo día
      como el mejor contenido encontrado en 58 playlists. La guarda tiene razón:
      son en inglés y Darma nace en español.
      Sobrevivieron 10 piezas, las de `yt:ops_mirar_al_futuro`, en español.
      La decisión NO es técnica: si `/animo` puede tener contenido en inglés para
      quien navegue en inglés, esas 13 son recuperables filtrando por idioma en
      el feed en vez de en la ingesta. Si no, se quedan fuera y hay que buscar
      catálogo en español por otra vía (contenido propio, ver B21).
- [ ] **De B21 → operación · la cuota de YouTube es COMPARTIDA con DataLaps.**
      Hoy `YOUTUBE_API_KEY` es la misma clave. Son 10.000 unidades/día POR CLAVE,
      y DataLaps ya se las agotó una vez (429 real, 2026-07-29). El consumo de
      Darma es pequeño —la corrida completa gastó ~44 unidades— pero si alguna de
      las dos apps crece, la otra se queda sin descubrimiento sin avisar. Una
      clave propia por proyecto lo separa.

## El anonimato: promesa corregida, agujero abierto (2026-08-05)

- [ ] **🔴 El correo de recuperación es legible y está atado al seudónimo.**
      `/api/auth/magic-link` llama a `updateUser({ email })`, que guarda el
      correo EN CLARO en `auth.users`. Y `profiles.id` es
      `uuid primary key references auth.users(id)` — la misma clave. Un `join`
      de una línea devuelve alias → correo de todo el que haya vinculado.
      `identity_vault` guarda un HMAC irreversible y está muy bien diseñado;
      queda anulado para esas personas.
      **Lo que YA se hizo (esta sesión):** corregir la promesa. Términos y
      privacidad suben a `v2-2026-08` declarando el dato; el copy de `/entrar`
      lo dice en el sitio donde se pide el correo; y el comentario de
      `lib/anonymity.ts` —que afirmaba lo contrario— está corregido.
      **Lo que NO:** cerrarlo. Dos caminos, los dos de arquitectura:
        (a) proyecto de auth separado, sin vínculo por id con `profiles`;
        (b) alias opaco por correo: que `auth.users` no comparta clave con
            `profiles` y el puente viva solo en `identity_vault`.
      Mientras no se haga, la app NO debe prometer anonimato absoluto en
      marketing, tienda de apps ni landing.
- [ ] **Al subir a v2, quien aceptó la v1 volverá a ver el consentimiento.** Es
      el comportamiento correcto —`cubreVersionActual()` devuelve false— y hay
      que contarlo antes de desplegar, o parecerá un fallo.
