// ============================================================================
// B17 · Guards de traducción — la lógica; las pruebas la ejecutan
//
// Vive fuera de los `*.test.ts` por dos razones: para poder probar que los
// guards FALLAN cuando deben fallar (con catálogos sintéticos, sin tocar los
// reales) y para que B15 pueda llamarlos desde CI sin arrancar `node --test`.
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { firmaIcu, ErrorIcu } from './icu.ts'
import { aplanar, MARCA_NO_ES_TEXTO, type Catalogo } from './catalogo.ts'

export { aplanar } from './catalogo.ts'
export type { Catalogo } from './catalogo.ts'

export interface ProblemaCatalogo {
  readonly tipo: 'falta' | 'vacia' | 'no_es_texto' | 'icu_invalido' | 'icu_distinto'
  readonly clave: string
  readonly detalle: string
}

/**
 * Compara dos (o más) catálogos. Devuelve TODOS los problemas, no el primero:
 * quien arregla traducciones quiere la lista entera de una vez.
 *
 * NO hay fallback silencioso al idioma de origen. Una clave que falta en `en`
 * deja media app en español para siempre sin que nadie se entere; aquí falla.
 */
export function compararCatalogos(
  catalogos: Readonly<Record<string, Catalogo>>,
): readonly ProblemaCatalogo[] {
  const problemas: ProblemaCatalogo[] = []
  const idiomas = Object.keys(catalogos)
  const planos = new Map(idiomas.map((i) => [i, aplanar(catalogos[i])] as const))

  const todasLasClaves = new Set<string>()
  for (const plano of planos.values()) for (const clave of plano.keys()) todasLasClaves.add(clave)

  for (const clave of [...todasLasClaves].sort()) {
    const firmas = new Map<string, readonly string[]>()

    for (const idioma of idiomas) {
      const valor = planos.get(idioma)?.get(clave)

      if (valor === undefined) {
        problemas.push({
          tipo: 'falta',
          clave,
          detalle: `la clave "${clave}" falta en "${idioma}"`,
        })
        continue
      }

      if (valor.startsWith(MARCA_NO_ES_TEXTO)) {
        problemas.push({
          tipo: 'no_es_texto',
          clave,
          detalle: `la clave "${clave}" en "${idioma}" no es una cadena (${valor.slice(MARCA_NO_ES_TEXTO.length)})`,
        })
        continue
      }

      if (valor.trim().length === 0) {
        problemas.push({
          tipo: 'vacia',
          clave,
          detalle: `la clave "${clave}" está vacía en "${idioma}"`,
        })
        continue
      }

      try {
        firmas.set(idioma, firmaIcu(valor))
      } catch (e) {
        problemas.push({
          tipo: 'icu_invalido',
          clave,
          detalle: `la clave "${clave}" en "${idioma}" tiene ICU inválido: ${
            e instanceof ErrorIcu ? e.message : String(e)
          }`,
        })
      }
    }

    // Los placeholders tienen que coincidir entre idiomas: `{n}` en es y
    // `{count}` en en es un fallo que solo se ve en producción, con el mensaje
    // ya delante de la persona.
    //
    // Se comparan también las ramas de plural. Vale mientras los locales sean
    // es/en, que comparten categorías (one/other): el día que entre un idioma
    // con `few`/`many` (pl, ru, ar), esta comparación tiene que relajarse a
    // solo nombres y tipos de argumento.
    const conFirma = [...firmas.entries()]
    if (conFirma.length > 1) {
      const [idiomaBase, firmaBase] = conFirma[0]
      for (const [idioma, firma] of conFirma.slice(1)) {
        if (firma.join('|') !== firmaBase.join('|')) {
          problemas.push({
            tipo: 'icu_distinto',
            clave,
            detalle:
              `la clave "${clave}" usa placeholders distintos: ` +
              `"${idiomaBase}" → [${firmaBase.join(', ')}] vs "${idioma}" → [${firma.join(', ')}]`,
          })
        }
      }
    }
  }

  return problemas
}

// ── Guard de texto literal sin traducir ─────────────────────────────────────

/**
 * Cadenas que pueden aparecer literales en un componente sin ser un fallo.
 * Nombres propios y símbolos: traducir "Darma" sería un bug, no una mejora.
 */
export const EXCLUSIONES_LITERALES: readonly string[] = Object.freeze([
  'Darma',
  'Supabase',
  'Vercel',
  'Next.js',
  'React',
  'Samaritans',
  'Crisis Text Line',
  'Find A Helpline',
  'Befrienders Worldwide',
])

const ATRIBUTOS_VIGILADOS = ['aria-label', 'placeholder', 'title', 'alt'] as const

export type AtributoVigilado = (typeof ATRIBUTOS_VIGILADOS)[number]

export interface LiteralEncontrado {
  readonly archivo: string
  readonly linea: number
  readonly texto: string
  readonly donde: 'jsx' | AtributoVigilado
}

const RE_ACENTO = /[áéíóúÁÉÍÓÚñÑüÜ¿¡]/

function esSospechoso(bruto: string): boolean {
  const texto = bruto.trim()
  if (texto.length < 3) return false
  if (!/\p{L}/u.test(texto)) return false // solo símbolos: ·, →, —
  if (EXCLUSIONES_LITERALES.includes(texto)) return false
  // Heurística conservadora a propósito (ficha B17 §9): o lleva una vocal
  // acentuada (o signo español) o son al menos dos palabras. Un "Ok" suelto o
  // un identificador no disparan nada, y así el guard no cansa a nadie. Un
  // guard que da falsos positivos todo el día acaba desactivado.
  return RE_ACENTO.test(texto) || /\S+\s+\S+/.test(texto)
}

/**
 * Tapa los comentarios conservando las posiciones (y por tanto los números de
 * línea). En este repo los comentarios explican el porqué y están llenos de
 * ejemplos con `<dialog>` y `=>`; sin esto, el guard denuncia la documentación.
 */
export function enmascararComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, prefijo: string) => prefijo + ' '.repeat(m.length - prefijo.length))
}

/**
 * Tapa los argumentos de tipo (`useState<Modo>(…)`, `useRef<HTMLDialogElement>`).
 * Sus `<` y `>` no son JSX, pero el escáner los lee como si abrieran y cerraran
 * una etiqueta y acaba denunciando código como si fuera copy.
 *
 * Dos cosas lo hacen seguro: el lookbehind (en JSX real el `<` viene tras
 * espacio, `(`, `{` o `>`, nunca pegado a un identificador) y descartar `</`,
 * que es siempre una etiqueta de cierre —`<p>Hola qué tal</p>` tiene el `<` de
 * cierre pegado a la "l" y sin esto se tapaba el hallazgo entero—.
 */
export function enmascararGenericos(contenido: string): string {
  return contenido.replace(/(?<=[A-Za-z_$0-9])<(?!\/)[^<>\n]{0,120}>/g, (m) => ' '.repeat(m.length))
}

/** Analiza el contenido de un archivo TSX. No toca el disco. */
export function buscarLiteralesEnFuente(
  original: string,
  archivo = '(memoria)',
): readonly LiteralEncontrado[] {
  const contenido = enmascararGenericos(enmascararComentarios(original))
  const hallazgos: LiteralEncontrado[] = []
  const lineaDe = (indice: number): number => contenido.slice(0, indice).split('\n').length

  // Texto entre `>` y `<`. Dos filtros que quitan casi todo el ruido:
  //   · se descartan los tramos con llaves — `{t('x')}` ya es una expresión;
  //   · el `>` no puede venir de una flecha `=>`.
  const reJsx = /(?<!=)>([^<>{}]+)</g
  for (let m = reJsx.exec(contenido); m !== null; m = reJsx.exec(contenido)) {
    if (esSospechoso(m[1])) {
      hallazgos.push({ archivo, linea: lineaDe(m.index), texto: m[1].trim(), donde: 'jsx' })
    }
  }

  for (const atributo of ATRIBUTOS_VIGILADOS) {
    const reAttr = new RegExp(`${atributo}\\s*=\\s*(["'])([^"']*)\\1`, 'g')
    for (let m = reAttr.exec(contenido); m !== null; m = reAttr.exec(contenido)) {
      if (esSospechoso(m[2])) {
        hallazgos.push({ archivo, linea: lineaDe(m.index), texto: m[2].trim(), donde: atributo })
      }
    }
  }

  return hallazgos
}

const DIRECTORIOS_IGNORADOS = new Set(['node_modules', '.next', '.git', 'e2e', 'out', 'build'])

/**
 * Recorre un árbol y devuelve los `.tsx`. LECTURA PURA: este guard nunca
 * escribe en `app/**` ni en `components/**`, que son de otros bloques.
 *
 * `withFileTypes` para no pagar un `stat` por entrada (presupuesto de la ficha:
 * < 3 s en 500 archivos).
 */
export function listarTsx(raiz: string): readonly string[] {
  const salida: string[] = []

  const recorrer = (dir: string): void => {
    let entradas
    try {
      entradas = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // El directorio aún no existe: el bloque que lo crea va en paralelo.
    }
    for (const entrada of entradas) {
      if (entrada.isDirectory()) {
        if (!DIRECTORIOS_IGNORADOS.has(entrada.name)) recorrer(join(dir, entrada.name))
      } else if (entrada.isFile() && entrada.name.endsWith('.tsx')) {
        salida.push(join(dir, entrada.name))
      }
    }
  }

  recorrer(raiz)
  return salida
}

/** Ejecuta el guard sobre un árbol real. Devuelve todos los literales. */
export function buscarLiteralesSinTraducir(raices: readonly string[]): readonly LiteralEncontrado[] {
  const hallazgos: LiteralEncontrado[] = []
  for (const raiz of raices) {
    for (const archivo of listarTsx(raiz)) {
      hallazgos.push(...buscarLiteralesEnFuente(readFileSync(archivo, 'utf8'), archivo))
    }
  }
  return hallazgos
}
