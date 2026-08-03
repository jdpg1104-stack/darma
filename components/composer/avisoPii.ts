// ============================================================================
// Aviso de PII EN EL CLIENTE — cortesía, no barrera
//
// ⚠️ ESTO ES UNA COPIA TEMPORAL DE LOS PATRONES DE `lib/anonymity.ts` ⚠️
//
// ── POR QUÉ EXISTE LA COPIA ────────────────────────────────────────────────
// `lib/anonymity.ts` es el sitio correcto y `detectPii()` es exactamente la
// función que hace falta aquí. No se puede importar: ese módulo hace
// `import { randomBytes } from 'node:crypto'` en su primera línea (lo necesita
// `createIdentitySeed()`, que es de alta de usuario y solo corre en servidor), y
// un componente `'use client'` que lo importe arrastra `node:crypto` al bundle
// del navegador y rompe la compilación.
//
// La solución de verdad es partir `lib/anonymity.ts` en dos: los patrones de PII
// —puros e isomorfos— por un lado y la generación de identidad —servidor— por
// otro. Eso es de F3, no de B03. Pedido abierto en HANDOFF/PEDIDOS.md; el día
// que exista, este archivo se borra y el composer importa de allí.
//
// ── POR QUÉ LA DUPLICACIÓN AQUÍ NO ES PELIGROSA ────────────────────────────
// Porque este código NO decide nada. La barrera es `assertNoPii()` en
// `POST /api/posts`, que corre en el servidor y bloquea con
// `contenido_bloqueado`. Si esta copia se queda atrás respecto al original, el
// único efecto es que el aviso amable llegue tarde y la persona reciba el
// rechazo del servidor en su lugar: peor experiencia, cero fuga. La dirección
// contraria —que el cliente fuera la única comprobación— sí sería un fallo, y es
// justo lo que no ocurre aquí.
// ============================================================================

export type TipoPii = 'email' | 'phone' | 'handle' | 'url'

/** Copias literales de las expresiones de `lib/anonymity.ts`. */
const RE_EMAIL =
  /[a-z0-9._%+-]+\s*(?:@|\(\s*(?:arroba|at)\s*\)|\[\s*(?:arroba|at)\s*\]|\s+(?:arroba|at)\s+)\s*[a-z0-9.-]+\s*(?:\.|\s*(?:punto|dot)\s*)\s*[a-z]{2,}/gi
const RE_PHONE = /(?:\+|00)?\s?\d(?:[\s.\-()]?\d){8,}/g
const RE_HANDLE = /@[a-z0-9._]{3,30}\b/gi
const RE_URL =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|es|mx|ar|co|cl|pe|io|me|ly|gg|link|app|tv)\b(?:\/[^\s]*)?/gi

/** Mensajes de cara a la persona: explican, no regañan y no acusan. */
const MENSAJES: Readonly<Record<TipoPii, string>> = {
  email: 'Hemos visto algo que parece un correo electrónico.',
  phone: 'Hemos visto algo que parece un número de teléfono.',
  handle: 'Hemos visto algo que parece un usuario de otra red social.',
  url: 'Hemos visto un enlace.',
}

/**
 * Aviso, o `null` si no hay nada que avisar. No bloquea el envío: quien quiera
 * mandarlo igual se topará con el servidor, y quien tenga un falso positivo
 * («llevo 123456789 días así») no se queda sin publicar por culpa de una
 * expresión regular.
 */
export function avisoDePii(texto: string): string | null {
  const tipos: TipoPii[] = []

  const buscar = (re: RegExp, tipo: TipoPii): void => {
    re.lastIndex = 0
    if (re.test(texto)) tipos.push(tipo)
  }

  buscar(RE_EMAIL, 'email')
  buscar(RE_PHONE, 'phone')
  buscar(RE_HANDLE, 'handle')
  buscar(RE_URL, 'url')

  if (tipos.length === 0) return null

  return (
    `${tipos.map((t) => MENSAJES[t]).join(' ')} ` +
    'En Darma nadie comparte datos de contacto: es lo que hace que este sea un ' +
    'sitio seguro para contar lo que te pasa. ¿Lo quitas antes de publicar?'
  )
}
