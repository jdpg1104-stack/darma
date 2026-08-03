# Arquitectura de Darma

Este documento explica **por qué** el sistema está construido así. Es la
referencia para decidir dónde va una regla nueva.

Objetivo de diseño: cientos de miles de usuarios, desplegado en Vercel, con
anonimato real y una economía de reputación que no se pueda farmear.

Fuente de verdad del esquema: [`supabase/migrations/0001_core.sql`](./supabase/migrations/0001_core.sql).

---

## 0. El principio que gobierna todo lo demás

> **La `anon key` de Supabase es pública. Cualquiera puede hablar con PostgREST
> directamente. Por tanto, una regla que solo exista en el servidor de Next no
> es una regla: es una sugerencia.**

De ahí se derivan casi todas las decisiones de abajo. Cuando dudes entre poner
una invariante en la API o en la base de datos, ponla en la base de datos. La
API es para la experiencia de uso; Postgres es para la verdad.

---

## 1. Seguridad: RLS denegado por defecto

Las siete tablas del núcleo tienen `enable row level security`. En Postgres,
RLS activo **sin política que conceda acceso significa denegado**: no hay que
acordarse de cerrar nada, hay que acordarse de abrir lo justo.

Concesiones actuales, en resumen:

| Tabla | Lectura | Escritura |
|---|---|---|
| `profiles` | cualquiera autenticado (son anónimos) | solo la fila propia |
| `posts` | activos y de quien no está en shadow-ban; los propios siempre | inserta/edita solo el autor |
| `comments` | activos | inserta solo el autor |
| `post_votes` | todos | solo el voto propio |
| `karma_events` | solo el ledger propio | ninguna (nadie escribe) |
| `karma_weights` | pública, incluso sin sesión | ninguna |
| `identity_vault` | **ninguna política** | **ninguna política** |

### RLS decide filas; los privilegios de columna deciden columnas

Esto es lo que más se olvida. La política `profiles_update_own` permite que
alguien edite su propia fila — y sin nada más, eso incluiría
`karma_reputation = 999999` con un `PATCH` a PostgREST. Por eso el esquema
además hace:

```sql
revoke update on public.profiles from anon, authenticated;
grant  update (alias, avatar_seed, bio, availability) on public.profiles to authenticated;
```

Mismo patrón en `posts` (`body, topic, state`) y `comments` (`body, state`). Los
contadores, el `hot_score` y todo el karma quedan fuera del alcance del cliente.

### `karma_weights` es pública a propósito

La economía es auditable: cualquiera puede leer cuánto vale cada acción. Es un
valor del producto, no un descuido. Además permite recalibrar pesos sin
desplegar código.

---

## 2. Anonimato por diseño: el `identity_vault` aislado

El anonimato no se garantiza "no mostrando" el email en la interfaz. Se
garantiza **no teniéndolo donde la aplicación puede leerlo**.

- `profiles` es la cara pública: seudónimo, semilla determinista de avatar
  (nunca una foto), biografía, karma. No hay ni un campo identificador. El
  comentario de la tabla lo dice de forma explícita para el próximo que pase.
- `identity_vault` es la única tabla donde existe el vínculo con la persona
  real, y guarda un **hash con sal** del contacto, no el contacto. Sirve para
  detectar multicuenta sin poder revertirse.
- No tiene **ninguna política RLS**. Con RLS activo, eso equivale a denegado
  para `anon` y para `authenticated`. Solo `service_role` la ve, porque salta
  RLS por definición.

Consecuencia práctica: **ni un bug en una ruta de API, ni una consulta mal
escrita, ni una política olvidada pueden filtrar la identidad.** Para filtrarla
haría falta usar la `service_role key` desde el servidor a propósito.

Extensiones de este principio fuera de la base de datos:

- **Cámara y micrófono denegados** en la `Permissions-Policy`
  (`next.config.ts`). Voz y cara son identificadores biométricos; su sola
  posibilidad cambiaría lo que la gente se atreve a contar.
- **Cero terceros en el navegador.** Sin fuentes externas, sin analítica de
  terceros, sin SDKs sociales. Cada petición saliente es alguien que podría
  saber que esta persona estuvo aquí.
- **`x-request-id` no deriva de datos del usuario** (`proxy.ts`). Un
  identificador de petición estable por persona sería un rastreador.

---

## 3. Reciprocidad forzada en un trigger de Postgres

La regla de producto: **escuchar a 3 personas desbloquea 1 publicación** (la
primera es gratis, porque exigir escuchar antes de haber visto nunca la app
significaría que nadie llega a publicar).

Está implementada en `posts_consume_credit()`, un trigger `BEFORE INSERT` sobre
`posts`:

```sql
update public.profiles
   set listen_credits  = case when posts_published = 0 then listen_credits else listen_credits - 3 end,
       posts_published = posts_published + 1
 where id = new.author_id
   and (posts_published = 0 or listen_credits >= 3)
   and not coalesce(banned_until > now(), false)
returning true into v_ok;
```

Tres propiedades que no daría una comprobación en la API:

1. **Inevitable.** Va con el `INSERT`, venga de donde venga: del servidor de
   Next, de un `curl` a PostgREST o de un cliente móvil futuro.
2. **Atómico.** La comprobación y el descuento son *la misma sentencia*. El
   `WHERE` es el guard y el `SET` es el cobro.
3. **Libre de carreras.** El `UPDATE` toma el lock de fila. Dos peticiones
   simultáneas no pueden gastar el mismo crédito: la segunda espera, relee y ve
   el saldo ya descontado.

Si no hay crédito, no hay `v_ok`, se levanta la excepción y **la fila no se
escribe**. No hay estado intermedio que limpiar.

### El crédito solo se gana con escucha validada

`comments.is_validated` (calidad juzgada por IA) es lo que dispara
`comments_on_validated()`: +1 crédito, +1 `listens_given`, karma vía
`award_karma()` y +1 al `reply_count` del post, todo en la misma transacción.
Un «ánimo!» repetido no valida, así que no acredita. Y el índice único parcial

```sql
create unique index uq_comments_one_listen_per_post
  on public.comments (post_id, author_id) where is_validated;
```

impide ganar 3 créditos comentando tres veces el mismo post.

### El karma no se escribe a mano

`authenticated` no tiene `UPDATE` sobre las columnas de karma (§1). La única vía
es `award_karma()`, `SECURITY DEFINER` con `search_path` fijado — sin fijarlo,
alguien podría crear una tabla que suplante a otra dentro de la función.

Dentro de `award_karma()`:

- **Tope diario de 120** que se **recorta** en lugar de rechazar: quien ayuda de
  más no recibe un error, simplemente deja de acumular.
- La ventana diaria se reinicia con un `UPDATE ... RETURNING` que además bloquea
  la fila, así que dos peticiones paralelas no se saltan el tope entre las dos.
- **Idempotencia**: `karma_events.idempotency_key` con `ON CONFLICT DO NOTHING`.
  Si la API reintenta tras un timeout, el segundo intento no paga.

`karma_events` es un **ledger append-only** y la fuente de verdad; las columnas
de `profiles` son un caché de lectura rápida.

Igual `spend_karma()`: el `WHERE karma_spendable >= p_amount` es a la vez la
comprobación y el descuento, así que el saldo no puede quedar negativo por dos
gastos simultáneos.

---

## 4. Escala: paginación keyset

**Nunca `OFFSET`.** Con `OFFSET 10000`, Postgres lee y descarta diez mil filas
en cada página; el coste crece con la profundidad del scroll y además el feed se
desplaza si alguien publica mientras lees.

Toda la paginación es por **keyset** sobre la misma tupla que ordena el índice:

```sql
-- feed "Para ti"
where state = 'active' and (hot_score, id) < (:cursor_score, :cursor_id)
order by hot_score desc, id desc
limit 20;
```

El coste es constante: un `index scan` que arranca exactamente donde terminó la
página anterior, sea la página 1 o la 500.

Los índices están construidos para eso, y son **parciales** con la misma
condición que la consulta, para que Postgres los use enteros y nunca toque los
posts ocultos o retirados:

| Índice | Para qué |
|---|---|
| `idx_posts_hot (hot_score desc, id desc) where state='active'` | feed «Para ti» |
| `idx_posts_new (created_at desc, id desc) where state='active'` | feed «Recientes» |
| `idx_posts_author (author_id, created_at desc)` | perfil |
| `idx_posts_risk (created_at desc) where risk in ('high','critical')` | cola de crisis |
| `idx_comments_post (post_id, created_at) where state='active'` | hilo |
| `idx_profiles_karma (karma_reputation desc) where not shadow_banned` | ranking |
| `idx_profiles_alias_trgm` (GIN, `pg_trgm`) | búsqueda por seudónimo |

La cola de crisis merece una nota: al ser un índice **parcial** sobre una
condición rara, ocupa muy poco y la revisión humana es instantánea por muchos
millones de posts que haya en la tabla.

---

## 5. Escala: contadores desnormalizados y hot score materializado

Un feed que hiciera `count(*)` sobre `comments` y `post_votes` por cada tarjeta
sería el primer cuello de botella a 100 000 usuarios.

- `posts.upvote_count` y `posts.reply_count` se mantienen **por trigger**
  (`post_votes_sync()`, `comments_on_validated()`). Leer el feed no cuenta nada.
- `posts.hot_score` está **materializado en columna**, no calculado al leer.
  `trg_posts_hot` (`BEFORE INSERT OR UPDATE OF upvote_count, reply_count`) lo
  recalcula solo cuando cambia una de sus entradas. Servir el feed es entonces
  un recorrido de índice de N filas, no un cálculo sobre el pool entero.
- `profiles.level` es una **columna generada** (`stored`) a partir de
  `karma_reputation`. Imposible que se desincronice, e indexable sin recalcular.

**Regla de mantenimiento:** `compute_hot_score()` en SQL es el espejo exacto de
`computeHotScore()` en `lib/feedRanking.ts`. Si cambias uno, cambia el otro —
hay un test que lo vigila. La constante `1767225600` es la época de referencia y
`45000.0` la vida media en segundos del componente temporal.

El coste de este enfoque es escritura ligeramente más cara y un pequeño riesgo
de deriva del caché; por eso el ledger de karma es append-only y existe un cron
de reconciliación previsto (ver README).

---

## 6. Moderación: shadow-ban y cola de riesgo

- `shadow_banned` no expulsa: la persona sigue usando la app con normalidad,
  pero su contenido no entra en el feed de nadie. Frente a un troll es mucho más
  efectivo que un baneo duro, que solo provoca que se cree otra cuenta. La
  política `posts_read` está escrita para que **el propio autor siga viendo sus
  posts**, precisamente para que no lo note.
- `risk` (`none|low|high|critical`) alimenta `idx_posts_risk`. El sistema falla
  **cerrado**: sin `MODERATION_API_KEY` no se valida ningún comentario, y por
  tanto no se acredita reciprocidad.

---

## 7. Rate limiting de dos capas

Una sola capa no sirve, y por razones distintas en cada dirección:

**Capa 1 — en memoria, por instancia (borde).**
Contador en el proceso de la función. Latencia cero, sin dependencia de red.
Absorbe el ruido barato: bucles rotos, reintentos agresivos, un cliente mal
programado. Su límite es evidente — Vercel escala a N instancias, así que un
atacante repartido entre instancias multiplica su cupo por N. No pasa nada: esta
capa nunca fue la defensa, es el amortiguador.

**Capa 2 — distribuida, por identidad (Redis/Upstash).**
Contador compartido con ventana deslizante, con clave por usuario para acciones
de escritura y por IP para las públicas sin sesión. Es la que de verdad limita
el abuso coordinado. Cuesta un salto de red, así que solo se paga en las rutas
que importan (publicar, comentar, votar, endpoints públicos).

**Capa 0, implícita: la propia economía.** La reciprocidad 3:1 y el tope diario
de karma son un limitador estructural. Para publicar en volumen hay que escuchar
en volumen, y escuchar requiere superar la validación de calidad. El abuso a
escala sale caro por construcción, no por configuración.

---

## 8. La capa de Next: qué hace y qué no

`proxy.ts` (el «middleware» de Next 16 — la convención se renombró) hace tres
cosas:

1. Refresca la sesión de Supabase con `@supabase/ssr` y propaga las cookies
   renovadas **a la petición y a la respuesta**. Escribir solo en una es el bug
   clásico de «se cierra la sesión sola cada hora».
2. Cierra el paso a rutas privadas: lo que no está en la lista pública exige
   sesión. Las rutas de API devuelven un `401` con JSON (no un redirect a HTML,
   que haría reventar `res.json()` en el cliente).
3. Sella cada petición con `x-request-id` / `x-nonce` para poder correlacionar
   los logs de una misma petición.

Usa `getClaims()` en vez de `getUser()`: con llaves JWT asimétricas la firma se
verifica localmente con Web Crypto, sin round-trip a Supabase Auth en cada
petición.

El matcher **excluye los estáticos por extensión**, no por nombre: una lista de
nombres propios solo protege lo que alguien se acordó de escribir. Cada petición
que entra al proxy paga una verificación de JWT; hacer pasar por ahí decenas de
iconos por carga de feed multiplicaría el trabajo del borde sin proteger nada.

**Lo que el proxy NO es: la última línea de defensa.** Es rendimiento y buena
experiencia (redirigir antes de renderizar). La autoridad está en §1–§3.

---

## 9. Cabeceras y CSP

Todo en `next.config.ts`, con el razonamiento junto a cada directiva. Lo
esencial:

- `default-src 'self'`, `base-uri 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'` (clickjacking descartado), `form-action 'self'`.
- `connect-src` **derivado de `NEXT_PUBLIC_SUPABASE_URL`**, no escrito a mano:
  el mismo archivo vale para desarrollo, preview y producción. Incluye
  `wss://*.supabase.co` para Realtime.
- `frame-src` solo `https://www.youtube-nocookie.com` (vídeos curados de
  bienestar, sin cookies de tracking). Ni TikTok ni Instagram: sus embeds exigen
  cargar el script propietario de la plataforma en nuestra página.
- `img-src` con Supabase Storage e `i.ytimg.com` (miniaturas), en vez de abrir
  `https:` entero.
- HSTS un año con subdominios, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin`.
- `Permissions-Policy` con **cámara y micrófono denegados** (§2).
- Caché inmutable de un año para `/_next/static/*` **solo en producción**: en
  desarrollo Turbopack usa nombres de archivo estables y esa cabecera serviría
  JS rancio durante un año, rompiendo el HMR.

Deuda conocida: `script-src` conserva `'unsafe-inline'`/`'unsafe-eval'` porque
los scripts de hidratación de Next todavía no están cableados con nonce. El
nonce ya se emite por petición en `proxy.ts` para que esa migración no obligue a
tocar el proxy otra vez.

---

## 10. Despliegue

- **Región `fra1`** (Fráncfort). Europea a propósito: los datos de una app de
  salud emocional no cruzan el Atlántico sin necesidad. El proyecto de Supabase
  debe estar en la misma región — si no, cada consulta paga la latencia
  transatlántica y el beneficio se pierde.
- `git.deploymentEnabled` solo para `main`: las ramas no despliegan solas.
- `crons: []` a propósito. Vercel valida las rutas al desplegar y un cron que
  apunte a un endpoint inexistente rompe el despliegue; las entradas previstas
  (ingesta de contenido curado, cola de riesgo, reconciliación de karma) están
  documentadas en el README listas para pegar cuando existan los handlers. Cada
  handler se autentica solo con `CRON_SECRET`, porque el proxy los deja pasar
  sin sesión (llegan de una máquina, no de un navegador).
- La landing es `force-static`: se sirve desde el CDN y no toca el servidor.

---

## Resumen para quien tiene prisa

| Invariante | Dónde se hace cumplir |
|---|---|
| Nadie ve la identidad real | `identity_vault` sin políticas RLS |
| Nadie se regala karma | Privilegio de columna + `award_karma()` `SECURITY DEFINER` |
| Nadie publica sin escuchar | Trigger `BEFORE INSERT` en `posts` |
| Nadie farmea créditos | `is_validated` + índice único parcial por (post, autor) |
| El feed no se degrada con el volumen | Keyset + índices parciales + hot score materializado |
| El abuso a escala sale caro | Economía + rate limiting de dos capas |
