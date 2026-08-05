// ============================================================================
// Anonimato — alias seudónimos, semilla de avatar y bloqueo de PII
//
// El anonimato es LA promesa de Darma. La gente escribe aquí cosas que no le ha
// contado a nadie; si esa promesa se rompe una sola vez, la app deja de tener
// razón de existir. Este módulo protege los dos flancos por los que se rompe:
//
//   1. POR DERIVACIÓN — que el identificador público (alias, avatar) permita
//      recuperar el identificador real (email, user id). Lo resuelve el diseño
//      de la semilla, abajo.
//   2. POR AUTODELACIÓN — que la persona escriba su email, su teléfono, su
//      Instagram o un enlace a su perfil dentro de un post. Lo resuelve
//      assertNoPii(), que vive en lib/pii.ts (puro e isomorfo, sin
//      node:crypto) y este módulo reexporta. Este es, en la práctica, el
//      vector que MÁS ocurre.
//
// ── DECISIÓN CENTRAL: la semilla es ALEATORIA, no derivada del usuario ──────
//
// Lo natural sería `alias = f(user_id)` o `f(hash(email))`: determinista, sin
// estado extra, sin colisiones que gestionar. SE DESCARTA, y merece explicación
// porque la alternativa parece segura:
//
//   · Un hash del user id NO es reversible, pero SÍ es verificable. Cualquiera
//     que tenga una lista de user ids (una filtración de auth.users, un backup,
//     un empleado con acceso) puede recalcular el alias de cada uno y quedarse
//     con la tabla completa alias→persona. La función f es pública: está en
//     este archivo, en el repositorio.
//   · Añadir una pimienta secreta del servidor solo traslada el problema: el
//     día que se filtre .env, el mapeo completo es recomputable — hacia atrás,
//     sobre todo lo escrito históricamente. Y una pimienta no se puede rotar
//     sin cambiarle el alias a todo el mundo.
//   · Con semilla aleatoria no hay nada que recomputar. Filtrar el código, o
//     las variables de entorno, o la tabla profiles entera, no des-anonimiza a
//     nadie.
//
// ⚠️ CORREGIDO 2026-08-05. Este bloque decía que «el vínculo alias→persona
// existe en UN solo sitio: identity_vault». ES FALSO, y conviene que quien lea
// este archivo no se lo crea:
//
//   `/api/auth/magic-link` llama a `updateUser({ email })` para que alguien
//   pueda recuperar su cuenta al cambiar de móvil. Eso guarda el correo EN
//   CLARO en `auth.users`. Y `profiles.id` es `uuid primary key references
//   auth.users(id)`, o sea LA MISMA CLAVE. Un `join` de una línea devuelve
//   alias → correo de todo el que haya vinculado.
//
// Lo que este archivo garantiza sigue siendo cierto y sigue siendo mucho: el
// alias no es derivable del contacto, la semilla no guarda relación con la
// identidad, e `identity_vault` solo tiene un HMAC irreversible. Lo que NO
// garantiza —y decía garantizar— es el anonimato frente a quien administra la
// infraestructura, para quien vinculó correo.
//
// El texto legal y el copy de /entrar se corrigieron para decirlo (términos y
// privacidad v2-2026-08). Cerrar el agujero de verdad exige separar el proyecto
// de auth o usar un alias opaco por correo; anotado en HANDOFF/PEDIDOS.md.
//
// Las funciones de este archivo son deterministas RESPECTO A LA SEMILLA (para
// poder testearlas y para que el avatar no cambie entre renders), pero la
// semilla en sí no guarda ninguna relación con la identidad real.
// ============================================================================

import { randomBytes } from 'node:crypto'

// ── Listas de palabras ──────────────────────────────────────────────────────
// Restricciones que cumplen ambas listas (las verifica anonymity.test.ts):
//   · Solo caracteres del CHECK de profiles.alias:
//     ^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$
//   · Máx. 9 caracteres por palabra → alias máx. 9+9+4 = 22 ≤ 24.
//   · Ninguna connotación de estado de ánimo negativo, diagnóstico, ni juicio:
//     el alias acompaña a la persona en el peor día de su vida y no puede
//     etiquetarla ("Roto", "Ansioso", "Perdido" están deliberadamente fuera).
//   · Sustantivos en masculino gramatical concordando con adjetivos en
//     masculino. NO es una asignación de género a la persona: el sustantivo es
//     un arquetipo (un faro, un viajero), no ella. La alternativa —listas
//     dobles con concordancia— duplicaba el mantenimiento sin ganar nada,
//     porque el alias no describe a nadie.

export const ALIAS_NOUNS: readonly string[] = [
  'Viajero', 'Caminante', 'Faro', 'Bosque', 'Río', 'Cometa', 'Puente', 'Refugio',
  'Sendero', 'Vigía', 'Jardín', 'Océano', 'Cielo', 'Roble', 'Colibrí', 'Susurro',
  'Horizonte', 'Eco', 'Latido', 'Abrigo', 'Ancla', 'Amanecer', 'Nómada', 'Vuelo',
  'Manantial', 'Sol', 'Norte', 'Copo', 'Musgo', 'Cardumen', 'Trigo', 'Volcán',
  'Junco', 'Coral', 'Ámbar', 'Cauce', 'Islote', 'Lienzo', 'Verso', 'Tambor',
  'Cristal', 'Fuego', 'Pino', 'Vencejo', 'Delfín', 'Alud', 'Barco', 'Nido',
] as const

export const ALIAS_ADJECTIVES: readonly string[] = [
  'Sereno', 'Silente', 'Amable', 'Paciente', 'Tenaz', 'Sincero', 'Cálido', 'Atento',
  'Valiente', 'Curioso', 'Honesto', 'Sabio', 'Templado', 'Lúcido', 'Noble', 'Firme',
  'Ligero', 'Claro', 'Profundo', 'Constante', 'Presente', 'Despierto', 'Fiel', 'Abierto',
  'Radiante', 'Tranquilo', 'Terco', 'Nuevo', 'Antiguo', 'Errante', 'Libre', 'Discreto',
  'Vivaz', 'Sencillo', 'Justo', 'Alegre', 'Suave', 'Hondo', 'Leal', 'Dulce',
  'Distante', 'Cercano', 'Íntegro', 'Pausado', 'Callado', 'Risueño', 'Sobrio', 'Tenue',
] as const

/** Rango del sufijo numérico: 4 dígitos, sin ceros a la izquierda. */
const SUFFIX_MIN = 1000
const SUFFIX_MAX = 9999

/**
 * Espacio total de alias ≈ 48 × 48 × 9000 ≈ 20,7 millones.
 *
 * A cientos de miles de usuarios habrá colisiones por cumpleaños (con 500 000
 * alias, del orden de miles). NO es un problema: `profiles.alias` tiene un
 * índice UNIQUE, así que la colisión la detecta Postgres y el alta reintenta
 * con `attempt + 1`. Es el motivo por el que `deriveAlias` acepta `attempt`.
 * La alternativa —ampliar el sufijo a 6 dígitos— eliminaba las colisiones pero
 * producía alias que parecen un número de expediente ("Faro Sereno 481923") en
 * vez de un nombre, y el alias es lo único con lo que la gente se identifica
 * aquí.
 */
export const ALIAS_SPACE = ALIAS_NOUNS.length * ALIAS_ADJECTIVES.length * (SUFFIX_MAX - SUFFIX_MIN + 1)

// ── Hash determinista (no criptográfico, y no hace falta que lo sea) ────────
// Se usa SOLO para repartir una semilla ya aleatoria entre las listas. La
// seguridad la aporta la aleatoriedad de la semilla, no esta función; usar
// SHA-256 aquí daría una falsa sensación de robustez sobre una operación que es
// puro reparto, y obligaría a importar node:crypto en código que también se
// ejecuta en el navegador para previsualizar avatares.

/** FNV-1a de 32 bits. Determinista y estable entre plataformas. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash * 16777619 en aritmética de 32 bits sin desbordar el double.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Generador determinista de enteros a partir de una semilla (splitmix32). */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    let z = state
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
    return (z ^ (z >>> 15)) >>> 0
  }
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Crea una semilla de identidad NUEVA y aleatoria (32 hex = 128 bits).
 *
 * Es lo único no determinista del módulo, y a propósito: esta semilla es lo que
 * corta el vínculo entre el alias y la persona. Debe generarse UNA vez en el
 * alta, guardarse en profiles.avatar_seed y no derivarse jamás del email, del
 * user id, ni de la hora de registro (un timestamp acota la búsqueda a las
 * cuentas creadas en ese segundo).
 *
 * SOLO SERVIDOR: usa node:crypto.
 */
export function createIdentitySeed(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Alias seudónimo determinista a partir de una semilla.
 *
 * @param seed    semilla aleatoria de la persona (ver createIdentitySeed).
 * @param attempt reintento ante colisión con el UNIQUE de profiles.alias.
 *                Mismo seed + distinto attempt = alias distinto y estable.
 *
 * Formato: "Sustantivo Adjetivo NNNN" — cumple el CHECK de la columna (letras,
 * dígitos y espacios) y cabe en 24 caracteres.
 */
export function deriveAlias(seed: string, attempt = 0): string {
  const rng = makeRng(fnv1a32(`${seed}:alias:${attempt}`))

  const noun = ALIAS_NOUNS[rng() % ALIAS_NOUNS.length]!
  const adjective = ALIAS_ADJECTIVES[rng() % ALIAS_ADJECTIVES.length]!
  const suffix = SUFFIX_MIN + (rng() % (SUFFIX_MAX - SUFFIX_MIN + 1))

  return `${noun} ${adjective} ${suffix}`
}

/**
 * Semilla del avatar generado (16 hex, mismo formato que el default de la
 * columna: `encode(gen_random_bytes(8), 'hex')`).
 *
 * Se DERIVA de la semilla de identidad en vez de ser otro valor aleatorio para
 * que alias y avatar cambien juntos si algún día alguien pide "cámbiame la
 * identidad": una sola semilla que rotar, un solo sitio donde equivocarse.
 * Como la semilla de origen ya es aleatoria, derivar no debilita nada.
 */
export function deriveAvatarSeed(seed: string): string {
  const rng = makeRng(fnv1a32(`${seed}:avatar`))
  let out = ''
  // 4 tiradas × 8 dígitos hex = 32... recortamos a 16 para igualar el default
  // de la columna (8 bytes).
  for (let i = 0; i < 2; i++) out += rng().toString(16).padStart(8, '0')
  return out.slice(0, 16)
}

/** Identidad anónima completa, lista para insertar en profiles. */
export interface AnonymousIdentity {
  /** Guardar en profiles.avatar_seed. NO es un secreto, pero tampoco es
   *  público útil: no se puede invertir a nada. */
  seed: string
  alias: string
  avatarSeed: string
}

/** Genera una identidad anónima nueva. SOLO SERVIDOR (alta de usuario). */
export function createAnonymousIdentity(attempt = 0): AnonymousIdentity {
  const seed = createIdentitySeed()
  return { seed, alias: deriveAlias(seed, attempt), avatarSeed: deriveAvatarSeed(seed) }
}

// ============================================================================
// PII en el cuerpo del texto — MOVIDO a lib/pii.ts
//
// La detección de PII es pura e isomorfa; este módulo importa node:crypto y
// por tanto no puede entrar en un bundle de cliente. Se partió (pedido «De
// B03 → F3» de HANDOFF/PEDIDOS.md) para que el composer avise en el navegador
// con los mismos patrones que bloquean en el servidor. Se reexporta la API
// completa para que los llamantes históricos de este módulo no cambien; el
// código nuevo puede importar de lib/pii.ts directamente.
// ============================================================================

export {
  assertNoPii,
  detectPii,
  PiiDetectedError,
  redactPii,
  type PiiFinding,
  type PiiKind,
} from './pii.ts'
