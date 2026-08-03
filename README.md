# Darma

**Red social anónima de crecimiento emocional basada en reciprocidad.**

Sin foto, sin nombre real, sin voz. Escuchas a tres personas y desbloqueas tu
turno de hablar. Esa regla no es una convención social de la comunidad: está
aplicada por un trigger de Postgres, dentro de la transacción.

---

## Stack

| Pieza | Elección |
|---|---|
| Framework | Next.js 16.2.9 (App Router, Server Components por defecto) |
| UI | React 19.2.4 |
| Estilos | Tailwind CSS v4 (vía `@tailwindcss/postcss`) + tokens CSS propios |
| Datos y auth | Supabase (Postgres + RLS + Auth) |
| Lenguaje | TypeScript en modo estricto |
| Despliegue | Vercel, región `fra1` (Fráncfort) |

---

## Puesta en marcha

Las dependencias ya están instaladas. **No ejecutes `npm install`** salvo que
cambie el `package.json`.

```bash
cp .env.example .env.local   # y rellena los valores
npm run dev                  # http://localhost:3000
```

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | `tsc --noEmit` — debe salir limpio siempre |
| `npm run lint` | ESLint 9 (flat config) |
| `npm test` | Tests unitarios de `lib/` con el runner nativo de Node |
| `npm run db:push` | Aplica las migraciones a Supabase |
| `npm run db:reset` | Recrea la base local desde `supabase/migrations/` |

---

## Mapa del repositorio

```
app/                    Rutas (App Router)
  layout.tsx            Layout raíz · metadata · sin fuentes ni scripts externos
  globals.css           Tokens de la paleta + primitivas + tema claro/oscuro
  page.tsx              Landing pública (estática, cero JS de cliente)
  loading.tsx           Esqueleto de carga raíz
lib/                    Lógica de dominio (karma, ranking del feed, clientes)
supabase/migrations/    Esquema. La fuente de verdad de las reglas del producto
proxy.ts                "Middleware" de Next 16: sesión + gate de rutas + request-id
next.config.ts          CSP y cabeceras de seguridad (léete los comentarios)
vercel.json             Región, gate de despliegue y crons
```

---

## Lo que hay que saber antes de tocar nada

### 1. Las reglas viven en la base de datos, no en la API

Cualquiera puede hablar con PostgREST directamente usando la `anon key`, que es
pública por diseño. Un gate que solo exista en una ruta de Next se salta con un
`curl`. Por eso la reciprocidad 3:1, el tope diario de karma y el aislamiento de
la identidad real están implementados como triggers, privilegios de columna y
políticas RLS. Ver [`ARCHITECTURE.md`](./ARCHITECTURE.md).

### 2. Anonimato por diseño, no por configuración

- `profiles` no tiene email, teléfono ni nombre real. Nunca los añadas ahí.
- El vínculo con la persona real vive en `identity_vault`, una tabla **sin
  ninguna política RLS** — lo que significa denegado para todo el mundo salvo
  `service_role`.
- Cámara y micrófono están **denegados a nivel de navegador** en la
  `Permissions-Policy` (`next.config.ts`). No es una preferencia reversible de
  una línea: una grabación de voz es un identificador biométrico.

### 3. Cero terceros en el navegador

No hay fuentes de Google, ni analítica de terceros, ni SDKs de redes sociales.
La CSP los bloquea a propósito. Si añades una integración y "no carga y no da
error en consola", mira la CSP en `next.config.ts` antes que el código.

El único origen externo permitido en un iframe es
`https://www.youtube-nocookie.com`, para los vídeos curados de bienestar.

### 4. Nada de `console.log` con contenido de usuario

ESLint lo avisa. En una app anónima, un log despistado puede volcar el cuerpo de
un desahogo a los registros de Vercel.

---

## Crons pendientes

`vercel.json` deja `"crons": []` a propósito: Vercel valida las rutas al
desplegar y un cron que apunte a un endpoint inexistente rompe el despliegue.
Cuando existan los handlers, se activan estas entradas:

```jsonc
"crons": [
  // Ingesta nocturna del catálogo de contenido curado de bienestar.
  { "path": "/api/cron/ingesta-contenido", "schedule": "0 4 * * *" },
  // Revisión de la cola de riesgo alto/crítico que nadie ha atendido.
  { "path": "/api/cron/cola-riesgo",       "schedule": "0 * * * *" },
  // Reconciliación del ledger de karma contra el caché de profiles.
  { "path": "/api/cron/karma-reconciliar", "schedule": "30 3 * * *" }
]
```

Cada handler se autentica solo comparando `Authorization: Bearer` con
`CRON_SECRET`; el proxy los deja pasar sin sesión porque llegan de una máquina,
no de un navegador.

---

## Aviso

Darma es apoyo entre iguales, **no atención sanitaria**. Cualquier superficie
del producto que pueda leer una persona en crisis debe ofrecer la vía a ayuda
profesional. `/ayuda` es pública y alcanzable sin sesión por esa razón, no por
una técnica.
