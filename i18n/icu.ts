// ============================================================================
// B17 · Mini-intérprete de ICU MessageFormat
//
// POR QUÉ EXISTE ESTO SI next-intl YA LO HACE:
//
//   1. El bloque tiene que cerrar en verde SIN que F4 haya envuelto todavía
//      `next.config.ts` con `createNextIntlPlugin` (ver HANDOFF/PEDIDOS.md).
//      Las pruebas de paridad y el `obtenerTraductor()` de `i18n/index.ts` no
//      pueden depender de una integración que vive en un archivo ajeno.
//   2. El guard de paridad necesita comparar la ESTRUCTURA ICU de dos mensajes
//      ({n} en es y {count} en en es un error que solo se ve en producción).
//      Eso exige parsear, no buscar con una expresión regular: `other {vacío}`
//      con una regex ingenua se lee como un argumento llamado «vacío».
//
// Cuando llegue el plugin, `useTranslations`/`getTranslations` de next-intl son
// la vía oficial en componentes y este módulo se queda solo para los guards.
//
// Subconjunto soportado a propósito: argumento simple, `plural` (con `#` y con
// claves `=N`) y `select`. Nada de `date`/`number` con estilo: si un mensaje lo
// necesita, se formatea fuera y se pasa ya formateado.
// ============================================================================

export type NodoIcu =
  | { readonly tipo: 'texto'; readonly valor: string }
  | { readonly tipo: 'octothorpe' }
  | { readonly tipo: 'argumento'; readonly nombre: string }
  | {
      readonly tipo: 'plural' | 'select'
      readonly nombre: string
      readonly ramas: ReadonlyMap<string, readonly NodoIcu[]>
    }

export class ErrorIcu extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorIcu'
  }
}

interface Cursor {
  readonly texto: string
  pos: number
}

const RE_NOMBRE = /^[A-Za-z_][A-Za-z0-9_]*/

function leerNombre(c: Cursor): string {
  const resto = c.texto.slice(c.pos)
  const m = RE_NOMBRE.exec(resto)
  if (!m) throw new ErrorIcu(`Se esperaba un nombre de argumento en la posición ${c.pos}`)
  c.pos += m[0].length
  return m[0]
}

function saltarEspacios(c: Cursor): void {
  while (c.pos < c.texto.length && /\s/.test(c.texto[c.pos])) c.pos += 1
}

/** Clave de rama: `one`, `other`, `=0`… Nunca se confunde con un argumento. */
function leerClaveDeRama(c: Cursor): string {
  saltarEspacios(c)
  if (c.texto[c.pos] === '=') {
    const m = /^=\d+/.exec(c.texto.slice(c.pos))
    if (!m) throw new ErrorIcu(`Clave "=" mal formada en la posición ${c.pos}`)
    c.pos += m[0].length
    return m[0]
  }
  return leerNombre(c)
}

function parsearNodos(c: Cursor, dentroDeRama: boolean): NodoIcu[] {
  const nodos: NodoIcu[] = []
  let buffer = ''

  const volcar = (): void => {
    if (buffer.length > 0) {
      nodos.push({ tipo: 'texto', valor: buffer })
      buffer = ''
    }
  }

  while (c.pos < c.texto.length) {
    const ch = c.texto[c.pos]

    if (ch === '}') {
      if (!dentroDeRama) throw new ErrorIcu(`Llave de cierre sobrante en la posición ${c.pos}`)
      break
    }

    if (ch === "'") {
      // Escape ICU: '' es una comilla literal; '{' o '}' abren texto literal.
      const siguiente = c.texto[c.pos + 1]
      if (siguiente === "'") {
        buffer += "'"
        c.pos += 2
        continue
      }
      if (siguiente === '{' || siguiente === '}' || siguiente === '#') {
        const fin = c.texto.indexOf("'", c.pos + 1)
        buffer += fin === -1 ? c.texto.slice(c.pos + 1) : c.texto.slice(c.pos + 1, fin)
        c.pos = fin === -1 ? c.texto.length : fin + 1
        continue
      }
      buffer += ch
      c.pos += 1
      continue
    }

    if (ch === '#' && dentroDeRama) {
      volcar()
      nodos.push({ tipo: 'octothorpe' })
      c.pos += 1
      continue
    }

    if (ch !== '{') {
      buffer += ch
      c.pos += 1
      continue
    }

    volcar()
    c.pos += 1 // consume '{'
    saltarEspacios(c)
    const nombre = leerNombre(c)
    saltarEspacios(c)

    if (c.texto[c.pos] === '}') {
      c.pos += 1
      nodos.push({ tipo: 'argumento', nombre })
      continue
    }

    if (c.texto[c.pos] !== ',') {
      throw new ErrorIcu(`Se esperaba "," o "}" tras {${nombre}} en la posición ${c.pos}`)
    }
    c.pos += 1
    saltarEspacios(c)
    const tipo = leerNombre(c)
    if (tipo !== 'plural' && tipo !== 'select' && tipo !== 'selectordinal') {
      throw new ErrorIcu(`Tipo ICU no soportado: "${tipo}". Formatea fuera y pasa el texto ya hecho.`)
    }
    saltarEspacios(c)
    if (c.texto[c.pos] !== ',') {
      throw new ErrorIcu(`Se esperaban ramas para {${nombre}, ${tipo}} en la posición ${c.pos}`)
    }
    c.pos += 1

    const ramas = new Map<string, readonly NodoIcu[]>()
    for (;;) {
      saltarEspacios(c)
      if (c.texto[c.pos] === '}') {
        c.pos += 1
        break
      }
      if (c.pos >= c.texto.length) throw new ErrorIcu(`Falta la llave de cierre de {${nombre}}`)
      const clave = leerClaveDeRama(c)
      saltarEspacios(c)
      if (c.texto[c.pos] !== '{') {
        throw new ErrorIcu(`Se esperaba "{" tras la rama "${clave}" en la posición ${c.pos}`)
      }
      c.pos += 1
      const cuerpo = parsearNodos(c, true)
      if (c.texto[c.pos] !== '}') throw new ErrorIcu(`Falta el cierre de la rama "${clave}"`)
      c.pos += 1
      ramas.set(clave, cuerpo)
    }

    if (!ramas.has('other')) {
      throw new ErrorIcu(`{${nombre}, ${tipo}} no tiene rama "other" (es obligatoria en ICU)`)
    }
    nodos.push({ tipo: tipo === 'select' ? 'select' : 'plural', nombre, ramas })
  }

  volcar()
  return nodos
}

/** Parsea un mensaje ICU. Lanza `ErrorIcu` con la posición si está mal formado. */
export function parsearIcu(mensaje: string): readonly NodoIcu[] {
  const c: Cursor = { texto: mensaje, pos: 0 }
  const nodos = parsearNodos(c, false)
  if (c.pos !== mensaje.length) throw new ErrorIcu(`Texto sobrante en la posición ${c.pos}`)
  return nodos
}

export type ParametrosMensaje = Readonly<Record<string, string | number>>

function formatearNodos(
  nodos: readonly NodoIcu[],
  params: ParametrosMensaje,
  locale: string,
  valorOctothorpe: number | null,
): string {
  let salida = ''
  for (const nodo of nodos) {
    switch (nodo.tipo) {
      case 'texto':
        salida += nodo.valor
        break
      case 'octothorpe':
        salida += valorOctothorpe === null ? '#' : new Intl.NumberFormat(locale).format(valorOctothorpe)
        break
      case 'argumento': {
        const v = params[nodo.nombre]
        // Un parámetro que falta se pinta como `{nombre}` en vez de "undefined":
        // en una tarjeta de crisis, un "undefined" es ruido que asusta.
        salida += v === undefined ? `{${nodo.nombre}}` : String(v)
        break
      }
      case 'select': {
        const clave = String(params[nodo.nombre] ?? '')
        const rama = nodo.ramas.get(clave) ?? nodo.ramas.get('other') ?? []
        salida += formatearNodos(rama, params, locale, valorOctothorpe)
        break
      }
      case 'plural': {
        const bruto = params[nodo.nombre]
        const n = typeof bruto === 'number' ? bruto : Number(bruto)
        const numero = Number.isFinite(n) ? n : 0
        const exacta = nodo.ramas.get(`=${numero}`)
        const categoria = new Intl.PluralRules(locale).select(numero)
        const rama = exacta ?? nodo.ramas.get(categoria) ?? nodo.ramas.get('other') ?? []
        salida += formatearNodos(rama, params, locale, numero)
        break
      }
    }
  }
  return salida
}

/** Formatea un mensaje ICU ya parseado o en crudo. */
export function formatearIcu(
  mensaje: string,
  params: ParametrosMensaje = {},
  locale = 'es',
): string {
  return formatearNodos(parsearIcu(mensaje), params, locale, null)
}

/**
 * Firma estructural de un mensaje: qué argumentos usa, de qué tipo y con qué
 * ramas. Es lo que compara el guard de paridad entre `es.json` y `en.json`.
 *
 * Ejemplo: `"Te quedan {n, plural, one {…} other {…}} de {total}"`
 *   → `["n:plural(one,other)", "total:simple"]`
 */
export function firmaIcu(mensaje: string): readonly string[] {
  const partes = new Set<string>()

  const recorrer = (nodos: readonly NodoIcu[]): void => {
    for (const nodo of nodos) {
      if (nodo.tipo === 'argumento') {
        partes.add(`${nodo.nombre}:simple`)
      } else if (nodo.tipo === 'plural' || nodo.tipo === 'select') {
        const claves = [...nodo.ramas.keys()].sort()
        partes.add(`${nodo.nombre}:${nodo.tipo}(${claves.join(',')})`)
        for (const cuerpo of nodo.ramas.values()) recorrer(cuerpo)
      }
    }
  }

  recorrer(parsearIcu(mensaje))
  return [...partes].sort()
}
