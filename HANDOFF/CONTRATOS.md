# Contratos compartidos · Darma

Fuente de verdad de lo que **cruza fronteras entre bloques**: tipos, rutas de
API, formas de respuesta y convenciones. Si respetas este documento, tu bloque
encaja con los demás sin que nadie tenga que editar el código de nadie.

**Dueño: B00 (integración).** Ningún otro bloque edita este archivo. Si necesitas
un contrato nuevo, escríbelo en `HANDOFF/PEDIDOS.md` y trabaja mientras con un
tipo local.

---

## 1. Convenciones que no se negocian

| Tema | Regla |
|---|---|
| Idioma | Código, comentarios y UI en **español**. Los comentarios explican el **porqué**, no el qué. |
| Tipos | TypeScript estricto. **Prohibido `any`.** Si no sabes el tipo, deriva de `Database` (§3). |
| Fechas | Siempre `timestamptz` en DB e ISO-8601 en la API. Nunca fechas locales. |
| IDs | `uuid` en todo lo que ve el cliente. Los `bigint identity` (ledgers) no salen de la API. |
| Dinero y karma | Enteros. Nunca coma flotante para saldos. |
| Imports | Alias `@/` desde la raíz. Nunca rutas relativas que suban dos niveles. |
| Componentes | Server Components por defecto. `'use client'` solo cuando hay estado o evento, y en la hoja más pequeña posible del árbol. |
| Secretos | `SUPABASE_SERVICE_ROLE_KEY` jamás en un archivo con `'use client'` ni en `NEXT_PUBLIC_*`. |

---

## 2. Anonimato · el contrato más importante

Estos campos **no existen** en ninguna respuesta de API ni en ninguna prop de
componente: `email`, `phone`, `real_name`, `ip`, `user_agent`, `contact_hash`,
`country` a nivel de usuario individual.

La única representación pública de una persona es:

```ts
/** Todo lo que otra persona puede llegar a saber de ti en Darma. */
export interface PerfilPublico {
  id: string                 // uuid — sirve para enlazar, no identifica a nadie
  alias: string              // seudónimo, 3–24 caracteres
  avatarSeed: string         // semilla determinista del avatar generado
  nivel: Nivel               // derivado del karma vitalicio
  karmaReputacion: number    // solo la reputación; el gastable es privado
  disponibilidad: Disponibilidad
  esMentor: boolean
}

export type Nivel = 'semilla' | 'brote' | 'guia' | 'mentor'
export type Disponibilidad = 'disponible' | 'necesito_hablar' | 'ausente'
```

`karmaSpendable`, `crystals`, `listenCredits` y `dailyKarmaEarned` son **privados**:
solo aparecen en respuestas dirigidas al propio usuario (`/api/me`).

También son privados **`listensGiven` y `postsPublished`**, y conviene decir por
qué porque no es evidente: `postsPublished` es cuántas veces has pedido ayuda, y
publicar ese agregado convierte «lo está pasando mal a menudo» en un dato de un
vistazo. `listensGiven` es la moneda buena de Darma, pero el tablero de B06 ya
publica esa señal por periodo y **con techo diario**; el contador vitalicio es lo
mismo sin techo, y ponerlo al lado premiaría justo lo que el techo frena. Decidido
y razonado entero en `0223_1_b00_contadores_privados.sql`.

---

## 3. Tipos de la base de datos

El tipado de Supabase se genera, no se escribe a mano:

```bash
npx supabase gen types typescript --local > lib/supabase/database.types.ts
```

**`lib/supabase/database.types.ts` no lleva cabecera ni comentario alguno.** Es
deliberado y hay que respetarlo: el CI vuelve a generar los tipos y hace `diff`
byte a byte contra el archivo, así que **cualquier cosa que añadas a mano
—incluido un comentario que avise de que no se edita a mano— hace fallar el
job**. La documentación de ese archivo vive aquí, que es donde no estorba.

Contra la base de desarrollo remota (`darma-dev`) el comando es:

```bash
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > lib/supabase/database.types.ts
```

Ese archivo lo **posee B15** y se regenera en CI. Consúmelo así:

```ts
import type { Database } from '@/lib/supabase/database.types'
type PostRow = Database['public']['Tables']['posts']['Row']
```

Nunca declares a mano la forma de una fila: si el esquema cambia, quiero que el
compilador lo rompa, no que la app mienta en silencio.

---

## 4. Forma de las respuestas de API

Toda ruta bajo `app/api/**` devuelve **una de estas dos formas**, nunca otra:

```ts
// Éxito
{ ok: true, data: T }

// Error — `code` es estable y traducible; `message` es para humanos.
// NUNCA incluye stack, SQL, nombre de tabla ni detalle del proveedor.
{ ok: false, code: ErrorCode, message: string, retryAfter?: number }
```

```ts
export type ErrorCode =
  | 'no_autenticado'        // 401
  | 'sin_permiso'           // 403
  | 'reciprocidad'          // 403 — te faltan escuchas para publicar
  | 'no_encontrado'         // 404
  | 'entrada_invalida'      // 422 — falló zod
  | 'demasiadas_peticiones' // 429 — incluye retryAfter en segundos
  | 'contenido_bloqueado'   // 422 — moderación o PII detectada
  | 'saldo_insuficiente'    // 409 — karma o cristales
  | 'error_interno'         // 500 — el detalle va al log, no al cliente
```

Los helpers viven en `lib/apiErrors.ts` (dueño: F3). Úsalos; no construyas
`NextResponse.json` a mano.

---

## 5. Paginación · siempre keyset, nunca OFFSET

```ts
export interface PaginaCursor<T> {
  items: T[]
  /** Opaco (base64). `null` cuando no hay más. Nunca lo interpretes en el cliente. */
  siguienteCursor: string | null
}
```

Petición: `?cursor=<opaco>&limite=20` (límite máximo **50**, validado con zod).

En SQL, el predicado es siempre una comparación de tupla sobre el mismo par que
ordena y que indexa:

```sql
-- feed por hot score
where state = 'active' and (hot_score, id) < (:cursor_score, :cursor_id)
order by hot_score desc, id desc
limit :limite
```

`OFFSET 10000` obliga a Postgres a leer y descartar 10 000 filas en cada página.
Con 100 000 usuarios eso es el primer sitio donde la app se cae.

---

## 6. Sesión y autorización en rutas de API

Toda ruta que no sea pública empieza igual (helper en `lib/auth/session.ts`,
dueño B01):

```ts
const sesion = await requireSesion()      // lanza 'no_autenticado' si no hay
const limite = await limitar(`posts:${sesion.userId}`, 10, 60)  // 10/min
```

Reglas:
- **Usa el cliente RLS (`lib/supabase/server.ts`), no el admin.** Que la política
  de la base de datos haga el trabajo. Si necesitas el cliente admin, justifica
  por qué en un comentario; es la excepción, no el atajo.
- El `userId` viene **siempre** de la sesión, **nunca** del body. Aceptar un
  `authorId` del cliente es la vulnerabilidad más común de este tipo de app.
- Rate limiting en toda ruta que escriba, sin excepción.

---

## 7. Rutas de API · reparto por bloque

Nadie crea rutas fuera de su prefijo.

| Prefijo | Bloque |
|---|---|
| `/api/auth/*`, `/api/me` | B01 |
| `/api/feed/*` | B02 |
| `/api/posts/*` | B03 |
| `/api/comments/*` | B04 |
| `/api/karma/*` | B05 |
| `/api/ranking/*` | B06 |
| `/api/content/*` | B07 |
| `/api/cron/content/*` | B08 |
| `/api/polls/*` | B09 |
| `/api/refuges/*` | B10 |
| `/api/moderation/*` | B11 |
| `/api/billing/*` | B12 |
| `/api/push/*` | B13 |
| `/api/health`, `/api/metrics` | B14 |
| `/api/privacy/*` | B20 |
| `/api/admin/*` | B19 |

---

## 8. Economía · valores canónicos

Viven en `lib/karma.ts` (TypeScript) y en la tabla `karma_weights` (Postgres).
**Nunca los copies a un tercer sitio**: impórtalos. Hay un test que verifica que
TS y SQL coinciden; si lo rompes, es que duplicaste un número.

| Concepto | Valor |
|---|---|
| Comentario validado | +10 |
| Marcado «me ayudó» | +15 |
| Hostear círculo | +30 |
| Contenido completado | +1 |
| Spam / relleno | −40 |
| Reporte confirmado | −30 |
| Tope diario | 120 |
| Fracción gastable | 30 % de lo ganado |
| Boost de crisis | −50 karma gastable |
| Regalar un boost | −50 |
| Fruto de bienestar | −500 |
| Niveles | semilla 0 · brote 500 · guía 2 000 · mentor 5 000 |
| Reciprocidad | 3 escuchas validadas → 1 publicación (la primera es gratis) |

**Línea roja del producto:** el dinero nunca compra karma, ni prioridad de
escucha, ni salta la cola de crisis. Si tu bloque necesita algo que roce eso,
párate y pregunta antes de implementarlo.

---

## 9. Crisis · contrato transversal

Cualquier bloque que reciba texto escrito por una persona (post, comentario,
mensaje de refugio, respuesta de encuesta) **debe** pasarlo por
`evaluarRiesgo()` de `lib/crisis.ts` antes de persistirlo, y:

1. Si el nivel es `high` o `critical`: escribir en `crisis_events`, marcar el
   contenido y **mostrar la tarjeta de recursos de ayuda al autor en la misma
   respuesta** (no en un email diferido, no en la siguiente pantalla).
2. Nunca ocultar ni borrar el contenido de forma silenciosa: la persona debe
   seguir siendo escuchada. Se prioriza, no se censura.
3. Nunca amplificar contenido autodestructivo en el feed.

El botón de crisis está siempre visible: lo aporta `components/ui/BotonCrisis`
(dueño B16) y **todos** los layouts de `app/(app)` deben incluirlo.

---

## 10. Diseño · tokens

Colores, espaciado y radios salen de variables CSS de `app/globals.css` (dueño
F4) y de `lib/designTokens.ts` para superficies que no pueden usar `var()`
(emails, PDFs). **No escribas hex en un componente.**

`--accent: #7c5cff` y `--accent2: #26d0a5` no tienen contraste suficiente como
texto sobre fondo claro: úsalos como relleno, borde o sobre fondo oscuro.

Componentes base (dueño B16, consúmelos, no los dupliques): `Boton`, `Tarjeta`,
`Chip`, `Avatar`, `Insignia`, `EstadoVacio`, `Dialogo`, `BotonCrisis`,
`Cargando`, `MedidorKarma`.

---

## 11. Rendimiento · presupuesto por pantalla

Un bloque no se cierra si su pantalla principal excede:

- **JS de cliente:** 120 KB comprimidos por ruta.
- **Consultas por render:** 3 a la base de datos. Cero N+1.
- **LCP:** < 2,5 s en 4G simulado.
- **Consulta de feed:** < 50 ms en `EXPLAIN ANALYZE` con 1 M de filas sembradas
  (el script de siembra lo aporta B14).

Toda consulta nueva sobre una tabla con crecimiento ilimitado va acompañada de su
`EXPLAIN ANALYZE` pegado en el PR. Si aparece `Seq Scan`, falta un índice.

---

## 12. Qué hacer cuando te bloqueas

1. ¿Falta un archivo de otro bloque? Crea un stub local **en tu propio
   directorio**, anota la dependencia en `PEDIDOS.md`, sigue.
2. ¿Necesitas una columna o tabla nueva? **No edites las migraciones existentes**
   —ya están aplicadas—. Crea `supabase/migrations/0NNN_<bloque>_<tema>.sql` con
   tu número de bloque en el nombre. Solo añade; nunca modifiques una migración
   que ya existe.
3. ¿Encontraste un bug fuera de tu bloque? Anótalo en `PEDIDOS.md`. No lo
   arregles: el arreglo de otro es un conflicto de merge garantizado.
