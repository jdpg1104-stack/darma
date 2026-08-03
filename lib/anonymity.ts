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
//      assertNoPii(). Este es, en la práctica, el vector que MÁS ocurre.
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
//   · Con semilla aleatoria no hay nada que recomputar. El vínculo
//     alias→persona existe en UN solo sitio: identity_vault, la tabla sin
//     políticas RLS. Filtrar el código, o las variables de entorno, o la tabla
//     profiles entera, no des-anonimiza a nadie.
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
// PII en el cuerpo del texto
//
// Aquí el criterio de error es el CONTRARIO al de un filtro de spam: preferimos
// bloquear texto legítimo antes que dejar pasar un dato de contacto. Alguien a
// quien le rechazamos un post por parecerse a un teléfono reescribe la frase;
// alguien cuyo número queda publicado en una red de salud mental ya no lo puede
// deshacer, y quien lo lea puede no ser quien esperaba.
//
// LÍMITE HONESTO: esto detecta lo que tiene FORMA de dato de contacto. No
// detecta "búscame en Insta, me llamo igual que mi perro" ni un teléfono
// escrito con letras. Es una primera capa; el clasificador de IA de moderación
// se enchufa encima. No presentes esto como una garantía.
// ============================================================================

export type PiiKind = 'email' | 'phone' | 'handle' | 'url'

export interface PiiFinding {
  kind: PiiKind
  /** El fragmento detectado, para poder señalarlo en la UI. */
  match: string
  /** Índice donde empieza, para subrayarlo en el editor. */
  index: number
}

// Email: deliberadamente laxo. Detecta también las evasiones típicas
// ("nombre (arroba) dominio punto com", "nombre AT dominio DOT com").
const RE_EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(\s*(?:arroba|at)\s*\)|\[\s*(?:arroba|at)\s*\]|\s+(?:arroba|at)\s+)\s*[a-z0-9.-]+\s*(?:\.|\s*(?:punto|dot)\s*)\s*[a-z]{2,}/gi

// Teléfono: 9 o más dígitos admitiendo separadores habituales, con o sin
// prefijo internacional. El mínimo de 9 evita comerse años, cifras y edades;
// España, México, Argentina, Colombia y Chile tienen 9-10 dígitos nacionales.
const RE_PHONE = /(?:\+|00)?\s?\d(?:[\s.\-()]?\d){8,}/g

// Handle de red social: @algo de 3+ caracteres. Se descartan los que en
// realidad forman parte de un email — se filtran después, comparando índices.
const RE_HANDLE = /@[a-z0-9._]{3,30}\b/gi

// URL: esquema explícito, "www." o dominio con TLD conocido de dos o más
// letras seguido de barra o final de palabra.
const RE_URL = /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|es|mx|ar|co|cl|pe|io|me|ly|gg|link|app|tv)\b(?:\/[^\s]*)?/gi

/**
 * Todos los fragmentos con forma de PII en un texto. Función PURA.
 * Ordenados por posición para poder subrayarlos en el editor.
 */
export function detectPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = []

  const collect = (re: RegExp, kind: PiiKind): void => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      findings.push({ kind, match: m[0], index: m.index })
      // Guarda contra patrones que puedan casar vacío y colgar el bucle.
      if (m[0].length === 0) re.lastIndex++
    }
  }

  collect(RE_EMAIL, 'email')
  const emailRanges = findings.map((f) => [f.index, f.index + f.match.length] as const)

  collect(RE_PHONE, 'phone')
  collect(RE_HANDLE, 'handle')
  collect(RE_URL, 'url')

  // Un @ dentro de un email ya está reportado como email; reportarlo otra vez
  // como handle haría que la UI subrayase dos veces lo mismo y contase mal.
  const deduped = findings.filter((f) => {
    if (f.kind !== 'handle' && f.kind !== 'url') return true
    return !emailRanges.some(([start, end]) => f.index >= start && f.index < end)
  })

  return deduped.sort((a, b) => a.index - b.index)
}

/** Mensajes de cara al usuario. Explican el porqué, no regañan. */
const PII_MESSAGES: Record<PiiKind, string> = {
  email: 'Has escrito algo que parece un correo electrónico.',
  phone: 'Has escrito algo que parece un número de teléfono.',
  handle: 'Has escrito algo que parece un usuario de otra red social.',
  url: 'Has escrito un enlace.',
}

export class PiiDetectedError extends Error {
  readonly findings: PiiFinding[]
  constructor(findings: PiiFinding[]) {
    const kinds = [...new Set(findings.map((f) => f.kind))]
    super(
      `${kinds.map((k) => PII_MESSAGES[k]).join(' ')} ` +
      'En Darma nadie comparte datos de contacto: es lo que hace que este sea un ' +
      'sitio seguro para contar lo que te pasa. Quítalo y vuelve a intentarlo.',
    )
    this.name = 'PiiDetectedError'
    this.findings = findings
  }
}

/**
 * Lanza `PiiDetectedError` si el texto contiene PII. Llamar SIEMPRE antes de
 * escribir un post o un comentario, en el servidor (el cliente puede saltárselo).
 *
 * Lanza en vez de devolver un booleano a propósito: un `if (!ok)` olvidado es
 * un dato de contacto publicado, y esa clase de olvido no debe ser silenciosa.
 */
export function assertNoPii(text: string): void {
  const findings = detectPii(text)
  if (findings.length > 0) throw new PiiDetectedError(findings)
}

/**
 * Sustituye la PII por marcadores. NO es para el contenido del usuario (ahí se
 * bloquea, no se limpia: un texto mutilado sin avisar confunde a quien lo
 * escribió). Es para los LOGS — ver lib/logger.ts.
 */
export function redactPii(text: string): string {
  return text
    .replace(RE_EMAIL, '[email]')
    .replace(RE_URL, '[url]')
    .replace(RE_PHONE, '[tel]')
    .replace(RE_HANDLE, '[handle]')
}
