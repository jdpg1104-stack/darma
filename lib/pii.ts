// ============================================================================
// PII en el cuerpo del texto — módulo PURO e ISOMORFO
//
// ── POR QUÉ ESTE ARCHIVO EXISTE APARTE DE lib/anonymity.ts ─────────────────
// Todo lo de aquí vivía en `lib/anonymity.ts`, pero ese módulo importa
// `node:crypto` para `createIdentitySeed()` (alta de usuario, solo servidor), y
// un componente `'use client'` que lo importara arrastraba `node:crypto` al
// bundle del navegador. La detección de PII, en cambio, es pura: texto entra,
// hallazgos salen. Se partió el módulo para que el composer pueda avisar en el
// cliente con LOS MISMOS patrones que bloquean en el servidor, sin copias que
// se queden atrás (pedido «De B03 → F3» de HANDOFF/PEDIDOS.md).
//
// REGLA DE ESTE ARCHIVO: aquí no entra `node:crypto` ni ningún otro import de
// servidor. Sin imports, sin estado, sin entorno. `lib/anonymity.ts` reexporta
// esta API para que sus llamantes históricos no cambien.
//
// ── CRITERIO DE ERROR ──────────────────────────────────────────────────────
// Es el CONTRARIO al de un filtro de spam: preferimos bloquear texto legítimo
// antes que dejar pasar un dato de contacto. Alguien a quien le rechazamos un
// post por parecerse a un teléfono reescribe la frase; alguien cuyo número
// queda publicado en una red de salud mental ya no lo puede deshacer, y quien
// lo lea puede no ser quien esperaba.
//
// LÍMITE HONESTO: esto detecta lo que tiene FORMA de dato de contacto. No
// detecta "búscame en Insta, me llamo igual que mi perro" ni un teléfono
// escrito con letras. Es una primera capa; el clasificador de IA de moderación
// se enchufa encima. No presentes esto como una garantía.
//
// La barrera real es `assertNoPii()` EN EL SERVIDOR: el aviso del cliente es
// cortesía y puede saltarse; la ruta de la API, no.
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
