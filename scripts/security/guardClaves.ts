// ============================================================================
// Guard de claves de catálogo · lo que el CÓDIGO pide ≡ lo que el CATÁLOGO tiene
//
// ── EL FALLO QUE CIERRA ─────────────────────────────────────────────────────
// `obtenerTraductor()` devuelve LA CLAVE CRUDA cuando no encuentra la plantilla
// (i18n/traductor.ts, y es a propósito: un respaldo silencioso al español deja
// media app sin traducir sin que nadie se entere). El precio de esa decisión es
// que una clave mal escrita no rompe NADA: no lanza, no falla al compilar, no
// aparece en ningún test. Simplemente pinta `curacion.motivoObligatorio` donde
// tenía que ir una frase, y solo se ve pulsando el botón exacto.
//
// Ya pasó: seis `mensajeClave` de `app/api/admin/curacion/route.ts` apuntaban a
// la raíz `curacion.*`, que no existe — la buena es `admin.curacion.*`. El error
// 422 enseñaba el identificador en pantalla. Se encontró a mano.
//
// El guard de paridad (`i18n/claves.test.ts`) NO ve esto: compara los dos
// catálogos entre sí, y una clave que no existe en ninguno de los dos está
// perfectamente equilibrada. Falta el otro extremo del cable, que es esto.
//
// Precedente directo: `lib/billing/textos.test.ts` hace ya esta comprobación
// para las claves de la economía, pero solo para las suyas y enumerándolas a
// mano. Este guard generaliza aquello a los tres árboles de código.
//
// ── POR QUÉ NO ESTÁ CERRADO EN EL COMPILADOR ────────────────────────────────
// El listón de este repo es `CODIGOS_DE_ERROR`: un `Record<CodigoError, true>`
// que NO COMPILA si falta un código. Aquí no se puede llegar ahí, y conviene
// saber por qué antes de proponerlo otra vez.
//
// La vía sería tipar `Traductor` como `(clave: ClaveDeCatalogo) => string`, con
// `ClaveDeCatalogo` derivada del JSON por tipos condicionales. Se descarta por
// dos motivos, y el primero decide:
//
//   · Hay llamadas donde la clave NO es un literal y no puede serlo. La más
//     importante es `mensajeClave`: viaja por el cable dentro del cuerpo JSON de
//     un 4xx, así que al llegar al cliente es `string` y nada más
//     (`components/auth/PanelEntrada.tsx`, `BotonImpulsar.tsx`, `BotonRegalar.tsx`,
//     `ColaCuracion.tsx`). Y hay decenas de sitios con plantilla interpolada del
//     tipo `t(\`publicar.tipos.${post.kind}\`)`. Para que todo eso compilara, la
//     firma tendría que ser `ClaveDeCatalogo | string` — que en TypeScript ES
//     `string`, y entonces el tipo no comprueba absolutamente nada.
//   · La unión pasaría de mil miembros y habría que construirla en cada `tsc`.
//
// Es decir: el compilador solo podría cubrir el subconjunto que este escáner ya
// cubre, y a cambio rompería justo el subconjunto que este escáner declara que
// NO cubre. Por eso es un escáner de texto y no un tipo.
//
// ── QUÉ COMPRUEBA ───────────────────────────────────────────────────────────
//   · `mensajeClave: 'literal'` en objetos (el `ErrorApi` de lib/auth/errores).
//   · `t('literal')` y `t(\`literal sin interpolar\`)`, con o sin más argumentos.
//   · `t(cond ? 'a' : 'b')`, incluidos los encadenados: las RAMAS son claves; la
//     condición no. Son 21 sitios y 43 claves, y dejarlos fuera habría sido
//     regalar una de cada tres referencias no triviales.
//   · Sobre `app/**`, `components/**` y `lib/**`, archivos `.ts` y `.tsx`.
//   · Contra las hojas de `messages/es.json` tal y como las aplana el traductor.
//
// ── QUÉ NO COMPRUEBA, Y HAY QUE LEERLO ──────────────────────────────────────
// Un guard que promete más de lo que mira es peor que ninguno, porque quien lo
// ve en verde deja de mirar. Esto se le escapa:
//
//   · Las claves DINÁMICAS: `t(cuerpo.mensajeClave)`, `t(\`crisis.aviso.${n}\`)`,
//     `t(CLAVE_PERIODO[periodo])`, `mensajeClave: rechazo`. Son irresolubles sin
//     ejecutar el programa. NO se marcan como error —eso sería un falso positivo
//     garantizado, y un guard que grita en falso acaba desactivado— pero se
//     CUENTAN, y `formatearDinamicas()` las lista con archivo y línea para quien
//     quiera auditarlas a ojo. Hoy son 62 frente a 735 referencias literales: la
//     cobertura real está en el 92 %, no en el 100 %, y así hay que leerla.
//   · Los `*.test.ts(x)`, excluidos a propósito: un test puede construir un
//     catálogo sintético y pedirle claves que no existen en el real — así es como
//     se demuestra que un guard falla cuando debe. Marcarlos obligaría a borrar
//     esas pruebas.
//   · Traductores con otro nombre. Se busca `t(`, que es como se llama en los
//     ~90 archivos que lo usan. Si mañana alguien escribe `const traducir = …`,
//     sus claves quedan fuera y nadie se entera.
//   · La paridad es/en y el ICU: eso es `i18n/claves.test.ts`. Aquí se mira solo
//     `es`, que es el idioma de origen del catálogo.
//   · Los PARÁMETROS: que `t('x', { n })` le pase a la plantilla los argumentos
//     que su ICU pide no lo mira nadie todavía.
//   · Claves que existen pero no están en el subárbol enviado al cliente: si una
//     pantalla llama a `subarbolDeMensajes()` con raíces que no incluyen la clave
//     que luego pide, la clave existe y este guard calla. Eso lo ve el navegador.
//   · Un `t('algo.asi')` escrito DENTRO de una cadena (un ejemplo en un mensaje
//     de error, pongamos) se leería como una llamada de verdad. No pasa hoy;
//     si pasara, el síntoma sería un falso positivo ruidoso, no un silencio.
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MENSAJES } from '../../i18n/traductor.ts'
import { aplanar } from '../../i18n/catalogo.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

/** Los tres árboles de código que le piden claves al catálogo. */
export const DIRS_VIGILADOS = ['app', 'components', 'lib'] as const

const EXTENSIONES = ['.ts', '.tsx'] as const

const IGNORAR = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', '.claude'])

const ARCHIVO_DE_TEST_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** De dónde sale la referencia. Se informa para saber dónde ir a arreglarla. */
export type OrigenClave = 'mensajeClave' | 't()'

/** Una clave de catálogo escrita literalmente en el código. */
export interface ReferenciaClave {
  /** Ruta relativa a la raíz, con `/`. */
  readonly archivo: string
  /** Línea (base 1). */
  readonly linea: number
  readonly clave: string
  readonly origen: OrigenClave
}

/** Una referencia que NO se puede resolver sin ejecutar el programa. */
export interface ReferenciaDinamica {
  readonly archivo: string
  readonly linea: number
  /** La expresión tal y como está escrita, recortada para el informe. */
  readonly expresion: string
  readonly origen: OrigenClave
}

export interface InformeClaves {
  /** Todas las referencias literales encontradas, existan o no en el catálogo. */
  readonly literales: readonly ReferenciaClave[]
  /** Las que no están en el catálogo. Esto es lo que hace fallar el guard. */
  readonly rotas: readonly ReferenciaClave[]
  /** Las irresolubles. NO hacen fallar nada; están aquí para poder contarlas. */
  readonly dinamicas: readonly ReferenciaDinamica[]
}

// ── Deuda conocida ──────────────────────────────────────────────────────────

/**
 * Claves rotas que este guard encontró al nacer y que NO se pueden arreglar
 * desde aquí. La lista es EXHAUSTIVA y el test la comprueba en las dos
 * direcciones: ni una rota de más, ni una entrada que ya esté arreglada.
 *
 * Una línea base que se queda con entradas obsoletas deja de proteger — nadie
 * sabe ya cuáles siguen pendientes de verdad — así que el test se pone rojo
 * también cuando una de estas claves aparece por fin en el catálogo, con el
 * aviso de borrarla de aquí.
 *
 * ── LA LISTA NACE VACÍA, Y ES UNA DECISIÓN ──────────────────────────────────
 * En su primera pasada este guard encontró TRECE claves rotas, y las trece se
 * arreglaron antes de fusionar en vez de heredarlas como deuda. Quedan escritas
 * aquí porque explican para qué sirve el archivo:
 *
 *   · Doce de `components/polls/**`, que piden `feed.encuesta.<algo>` mientras
 *     en el catálogo `feed.encuesta` era una HOJA de texto («Encuesta», la
 *     etiqueta que pinta `components/feed/SlotEncuesta.tsx`). Una clave no
 *     puede ser cadena y espacio de nombres a la vez: `aplanar()` se queda con
 *     la cadena y todo lo que cuelgue queda inalcanzable, así que la tarjeta de
 *     encuesta del feed llevaba pintando catorce identificadores en crudo donde
 *     va su copy. Se resolvió moviendo la hoja a `feed.encuesta.etiqueta`.
 *   · Y una suelta, `admin.privacidad.volverAlPrincipio`: el enlace de «volver»
 *     del historial de solicitudes RGPD, que se quedó fuera cuando entraron sus
 *     46 hermanas.
 *
 * Empezar con la lista vacía es lo que hace que este guard signifique algo. Una
 * línea base heredada convierte «no hay claves rotas» en «no hay claves rotas
 * NUEVAS», que es una promesa mucho más pequeña y que nadie recuerda al leerla.
 * Si añades una entrada, escribe al lado por qué no se puede arreglar hoy.
 */
export const DEUDA_CONOCIDA: readonly string[] = Object.freeze([])

// ── El catálogo ─────────────────────────────────────────────────────────────

/**
 * Las claves que el traductor sabe resolver: las HOJAS de tipo texto, no los
 * nodos intermedios. `t('feed.encuesta.x')` con `feed.encuesta` siendo una
 * cadena también devuelve la clave cruda, y `aplanar()` ya lo refleja.
 */
export function clavesDelCatalogo(): ReadonlySet<string> {
  return new Set(aplanar(MENSAJES.es).keys())
}

/**
 * La clave del catálogo que probablemente se quería escribir.
 *
 * Primero por SUFIJO, que es el caso real y el caro: `curacion.motivoObligatorio`
 * contra `admin.curacion.motivoObligatorio` — la raíz mal puesta. Después por
 * último segmento, que caza el resto de mudanzas de árbol. Sin distancia de
 * edición a propósito: una sugerencia parecida-pero-otra es peor que ninguna, y
 * solo se sugiere cuando la candidata es ÚNICA.
 */
export function sugerirClave(clave: string, catalogo: Iterable<string>): string | null {
  const porSufijo: string[] = []
  const porHoja: string[] = []
  const hoja = clave.slice(clave.lastIndexOf('.') + 1)

  for (const k of catalogo) {
    if (k.endsWith(`.${clave}`)) porSufijo.push(k)
    else if (k === hoja || k.endsWith(`.${hoja}`)) porHoja.push(k)
  }

  if (porSufijo.length === 1) return porSufijo[0]!
  if (porSufijo.length === 0 && porHoja.length === 1) return porHoja[0]!
  return null
}

// ── Enmascarado de lo que no es código ──────────────────────────────────────

/**
 * Sustituye por espacios el interior de los COMENTARIOS y de los LITERALES DE
 * EXPRESIÓN REGULAR, conservando los saltos de línea (y por tanto los números
 * de línea del informe).
 *
 * Las cadenas NO se tapan: son justo lo que este guard viene a leer.
 *
 * Por qué no reusa `quitarComentarios()` de `guardSinLoading.ts`, que hace la
 * mitad de esto: aquella no conoce las expresiones regulares, y aquí eso da dos
 * fallos medibles. Uno benigno —`/\b(can'?t (take|do) …/` de `lib/crisis.ts` se
 * leía como una llamada `t(take|do)` y ensuciaba el recuento de dinámicas— y
 * otro que no lo es: dentro de un regex, un `\/\/` la hace creer que empieza un
 * comentario de línea y se come el resto de la línea, con las claves que
 * hubiera en ella. Un guard que se salta código en silencio es exactamente lo
 * que no queremos.
 *
 * Limitaciones asumidas, en el lado seguro:
 *   · No se rastrean las interpolaciones `${…}` de las plantillas, así que un
 *     comentario dentro de una no se tapa. Una llamada real ahí SÍ se ve.
 *   · Un salto de línea dentro de lo que se tomó por regex lo cierra: si la
 *     heurística se equivocó, el daño se queda en esa línea.
 */
export function enmascararNoCodigo(fuente: string): string {
  type Estado =
    | 'codigo'
    | 'comentarioLinea'
    | 'comentarioBloque'
    | 'simple'
    | 'doble'
    | 'plantilla'
    | 'regex'
    | 'claseRegex'

  let estado: Estado = 'codigo'
  const out: string[] = []
  /** Los dos últimos caracteres significativos emitidos en `codigo`. Deciden `/`. */
  let previo = ''
  let anterior = ''

  /**
   * ¿Un `/` en esta posición abre un regex o divide? La heurística clásica: tras
   * un operador, una apertura o el principio, es un regex; tras un identificador,
   * un número o un cierre, es una división.
   *
   * Los dos casos de JSX que hay que descartar a mano, y que costaron un error
   * real: `</Chip>` (el `/` va pegado a un `<` y NO abre nada — tomarlo por
   * regex se comía el resto de la línea, con las llamadas `t()` que hubiera en
   * ella) y `=>`, donde el `>` sí puede ir seguido de un regex de verdad
   * (`() => /re/.test(x)`) mientras que el `>` de cerrar una etiqueta no.
   */
  const abreRegex = (): boolean => {
    if (previo === '') return true
    if (previo === '<') return false
    if (previo === '>') return anterior === '='
    if ('(,=:[!&|?{};+-*%~^'.includes(previo)) return true
    // `return /…/`, `case /…/`, `typeof /…/`: la palabra clave termina en letra,
    // así que hay que mirar el identificador entero que acaba de salir.
    const m = /([A-Za-z_$][\w$]*)\s*$/.exec(out.join(''))
    return m !== null && PALABRAS_ANTES_DE_REGEX.has(m[1]!)
  }

  const anotar = (c: string): void => {
    if (/\s/.test(c)) return
    anterior = previo
    previo = c
  }

  for (let i = 0; i < fuente.length; i++) {
    const c = fuente[i]!
    const sig = fuente[i + 1]

    switch (estado) {
      case 'codigo':
        if (c === '/' && sig === '/') {
          estado = 'comentarioLinea'
          out.push('  ')
          i++
        } else if (c === '/' && sig === '*') {
          estado = 'comentarioBloque'
          out.push('  ')
          i++
        } else if (c === '/' && abreRegex()) {
          estado = 'regex'
          out.push(' ')
        } else {
          if (c === "'") estado = 'simple'
          else if (c === '"') estado = 'doble'
          else if (c === '`') estado = 'plantilla'
          out.push(c)
          anotar(c)
        }
        break

      case 'comentarioLinea':
        if (c === '\n') {
          estado = 'codigo'
          out.push('\n')
        } else out.push(' ')
        break

      case 'comentarioBloque':
        if (c === '*' && sig === '/') {
          estado = 'codigo'
          out.push('  ')
          i++
        } else out.push(c === '\n' ? '\n' : ' ')
        break

      case 'regex':
      case 'claseRegex':
        if (c === '\\' && sig !== undefined) {
          out.push('  ')
          i++
        } else if (c === '\n') {
          estado = 'codigo'
          out.push('\n')
        } else if (estado === 'regex' && c === '[') {
          estado = 'claseRegex'
          out.push(' ')
        } else if (estado === 'claseRegex' && c === ']') {
          estado = 'regex'
          out.push(' ')
        } else if (estado === 'regex' && c === '/') {
          estado = 'codigo'
          anotar('/')
          out.push(' ')
        } else out.push(' ')
        break

      case 'simple':
      case 'doble':
      case 'plantilla':
        out.push(c)
        if (c === '\\' && sig !== undefined) {
          out.push(sig)
          i++
        } else if (
          (estado === 'simple' && (c === "'" || c === '\n')) ||
          (estado === 'doble' && (c === '"' || c === '\n')) ||
          (estado === 'plantilla' && c === '`')
        ) {
          estado = 'codigo'
          if (c !== '\n') anotar(c)
        }
        break
    }
  }

  return out.join('')
}

const PALABRAS_ANTES_DE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'instanceof',
  'yield',
  'await',
  'do',
  'else',
])

// ── Lectura del primer argumento ────────────────────────────────────────────

type Argumento =
  | { readonly tipo: 'literales'; readonly valores: readonly string[] }
  | { readonly tipo: 'dinamico'; readonly expresion: string }
  | null

function desescapar(bruto: string): string {
  return bruto.replace(/\\(['"`\\])/g, '$1')
}

/** El texto es EXACTAMENTE una cadena literal, sin nada alrededor. */
function comoLiteral(expr: string): string | null {
  const t = expr.trim()
  if (t.length < 2) return null
  const comilla = t[0]!
  if (comilla !== "'" && comilla !== '"' && comilla !== '`') return null
  if (t[t.length - 1] !== comilla) return null
  const dentro = t.slice(1, -1)
  if (dentro.includes(comilla) || dentro.includes('\n')) return null
  if (comilla === '`' && dentro.includes('${')) return null
  return desescapar(dentro)
}

/** Índice del primer `X` a profundidad 0, saltando cadenas. `-1` si no hay. */
function indiceTop(expr: string, desde: number, predicado: (c: string, i: string) => boolean): number {
  let prof = 0
  for (let i = desde; i < expr.length; i++) {
    const c = expr[i]!
    if (c === "'" || c === '"' || c === '`') {
      const fin = expr.indexOf(c, i + 1)
      if (fin === -1) return -1
      i = fin
      continue
    }
    if ('([{'.includes(c)) prof++
    else if (')]}'.includes(c)) prof--
    else if (prof === 0 && predicado(c, expr.slice(i, i + 2))) return i
  }
  return -1
}

/**
 * Resuelve `cond ? 'a' : 'b'` — y los encadenados — a la lista de sus RAMAS.
 *
 * Lo importante es lo que NO hace: la condición se descarta entera, así que el
 * `'recorte'` de `cola === 'recorte' ? 'admin.x' : 'admin.y'` nunca se toma por
 * una clave. Por eso esto está escrito con un pequeño analizador de
 * profundidad y no con una regex sobre todas las cadenas de la expresión, que
 * es la manera fácil de empezar a inventarse claves.
 *
 * Devuelve `null` si cualquier rama no es una cadena literal — entonces la
 * expresión entera se cuenta como dinámica, que es la respuesta honesta.
 */
export function resolverRamas(expr: string): readonly string[] | null {
  const literal = comoLiteral(expr)
  if (literal !== null) return [literal]

  // `?` de ternario: ni `?.` ni `??`.
  const i = indiceTop(expr, 0, (c, dos) => c === '?' && dos !== '?.' && dos !== '??')
  if (i === -1) return null

  const j = indiceTop(expr, i + 1, (c, dos) => c === ':' && dos !== '::')
  if (j === -1) return null

  const a = resolverRamas(expr.slice(i + 1, j))
  const b = resolverRamas(expr.slice(j + 1))
  return a === null || b === null ? null : [...a, ...b]
}

/**
 * Lee la expresión que empieza en `desde` y decide si es resoluble.
 *
 * Se hace con un escáner y no con una regex porque las DOS respuestas importan:
 * `'admin.curacion.x'` es una clave que hay que comprobar, y `cuerpo.mensajeClave`
 * es una referencia dinámica que hay que CONTAR — ni ignorarla ni denunciarla.
 *
 * `cierres` son los caracteres que terminan la expresión en profundidad 0: `,)`
 * para una llamada, `,}` para una propiedad de objeto.
 */
export function leerArgumento(fuente: string, desde: number, cierres: string): Argumento {
  let i = desde
  while (i < fuente.length && /\s/.test(fuente[i]!)) i++
  if (i >= fuente.length) return null

  let prof = 0
  let j = i
  let cerrado = false
  while (j < fuente.length) {
    const c = fuente[j]!
    if (c === "'" || c === '"' || c === '`') {
      // Una comilla recta sin cerrar en la misma línea (o un backtick sin cerrar
      // en el archivo) significa que vamos descolocados: mejor no afirmar nada.
      const fin = fuente.indexOf(c, j + 1)
      if (fin === -1) return null
      if (c !== '`' && fuente.slice(j + 1, fin).includes('\n')) return null
      j = fin + 1
      continue
    }
    if ('([{'.includes(c)) prof++
    else if (')]}'.includes(c)) {
      if (prof === 0) {
        cerrado = cierres.includes(c)
        break
      }
      prof--
    } else if (c === ',' && prof === 0 && cierres.includes(',')) {
      cerrado = true
      break
    }
    j++
  }
  if (!cerrado) return null

  const bruto = fuente.slice(i, j)
  const ramas = resolverRamas(bruto)
  if (ramas !== null) return { tipo: 'literales', valores: ramas }

  const expresion = recortar(bruto)
  return expresion === '' ? null : { tipo: 'dinamico', expresion }
}

function recortar(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim()
  return plano.length > 62 ? `${plano.slice(0, 59)}…` : plano
}

/**
 * Anotaciones de tipo, no valores. `mensajeClave: string` dentro de una
 * `interface` no es una referencia a ninguna clave.
 *
 * Las declaraciones habituales del repo llevan `?` (`mensajeClave?: string`) y
 * ni siquiera llegan aquí, porque el patrón exige el `:` pegado al nombre. Esto
 * cubre la variante sin `?`.
 */
const ANOTACION_DE_TIPO_RE = /^(?:readonly\s+)?(?:string|number|boolean|unknown|any|null|undefined)\b/

// ── Extracción ──────────────────────────────────────────────────────────────

/**
 * `mensajeClave` seguido de `:` EN LA MISMA LÍNEA. Así no casa con la rama de un
 * ternario (`cuerpo.mensajeClave\n  ? t(…)\n  : …`), que también tiene dos
 * puntos unas líneas más abajo.
 */
const MENSAJE_CLAVE_RE = /\bmensajeClave[ \t]*:[ \t]*/g

/**
 * Llamada al traductor. El lookbehind evita casar el final de otro identificador
 * (`format(`, `sut(`) y deja pasar `t(`, `t (`, `obj.t(` y `t?.(`.
 */
const LLAMADA_T_RE = /(?<![\w$])t\s*(?:\?\.)?\s*\(/g

/** Analiza el contenido de un archivo. No toca el disco. */
export function extraerReferencias(
  original: string,
  archivo = '(memoria)',
): { literales: ReferenciaClave[]; dinamicas: ReferenciaDinamica[] } {
  const fuente = enmascararNoCodigo(original)
  const literales: ReferenciaClave[] = []
  const dinamicas: ReferenciaDinamica[] = []

  // Posiciones de los saltos, calculadas una vez: un `slice().split()` por
  // hallazgo es cuadrático y esto recorre cientos de archivos.
  const saltos: number[] = []
  for (let i = 0; i < fuente.length; i++) if (fuente[i] === '\n') saltos.push(i)
  const lineaDe = (indice: number): number => {
    let lo = 0
    let hi = saltos.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (saltos[mid]! < indice) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }

  const recoger = (re: RegExp, origen: OrigenClave, cierres: string): void => {
    re.lastIndex = 0
    for (let m = re.exec(fuente); m !== null; m = re.exec(fuente)) {
      const arg = leerArgumento(fuente, m.index + m[0].length, cierres)
      if (arg === null) continue
      const linea = lineaDe(m.index)
      if (arg.tipo === 'literales') {
        for (const clave of arg.valores) literales.push({ archivo, linea, clave, origen })
      } else {
        if (origen === 'mensajeClave' && ANOTACION_DE_TIPO_RE.test(arg.expresion)) continue
        dinamicas.push({ archivo, linea, expresion: arg.expresion, origen })
      }
    }
  }

  recoger(MENSAJE_CLAVE_RE, 'mensajeClave', ',}')
  recoger(LLAMADA_T_RE, 't()', ',)')

  return { literales, dinamicas }
}

// ── Recorrido ───────────────────────────────────────────────────────────────

function aPosix(p: string): string {
  return p.split(sep).join('/')
}

function listarArchivos(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue
    const completo = join(dir, entrada)
    if (statSync(completo).isDirectory()) listarArchivos(completo, acc)
    else if (EXTENSIONES.some((e) => entrada.endsWith(e))) acc.push(completo)
  }
  return acc
}

/** Recorre los tres árboles y compara contra el catálogo real. */
export function comprobarClaves(
  raiz: string = RAIZ_POR_DEFECTO,
  catalogo: ReadonlySet<string> = clavesDelCatalogo(),
): InformeClaves {
  const literales: ReferenciaClave[] = []
  const dinamicas: ReferenciaDinamica[] = []

  for (const dir of DIRS_VIGILADOS) {
    for (const archivo of listarArchivos(join(raiz, dir))) {
      if (ARCHIVO_DE_TEST_RE.test(basename(archivo))) continue
      let fuente: string
      try {
        fuente = readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      const rel = aPosix(relative(raiz, archivo))
      const { literales: l, dinamicas: d } = extraerReferencias(fuente, rel)
      literales.push(...l)
      dinamicas.push(...d)
    }
  }

  return { literales, dinamicas, rotas: literales.filter((r) => !catalogo.has(r.clave)) }
}

/** Las rotas que NO están en la línea base. Son las que hacen fallar el test. */
export function rotasNuevas(informe: InformeClaves): readonly ReferenciaClave[] {
  return informe.rotas.filter((r) => !DEUDA_CONOCIDA.includes(r.clave))
}

// ── Informe ─────────────────────────────────────────────────────────────────

function resumen(informe: InformeClaves): string {
  const distintas = new Set(informe.literales.map((r) => r.clave)).size
  return (
    `${informe.literales.length} referencia(s) literal(es) · ${distintas} clave(s) distinta(s) · ` +
    `${informe.dinamicas.length} dinámica(s) NO comprobable(s)`
  )
}

export function formatearInforme(
  informe: InformeClaves,
  catalogo: ReadonlySet<string> = clavesDelCatalogo(),
): string {
  const nuevas = rotasNuevas(informe)
  const deuda = informe.rotas.filter((r) => DEUDA_CONOCIDA.includes(r.clave))

  const linea = (r: ReferenciaClave): string[] => {
    const salida = [`  ✗ ${r.archivo}:${r.linea} · ${r.origen} → "${r.clave}"`]
    const sugerida = sugerirClave(r.clave, catalogo)
    if (sugerida !== null) salida.push(`      ¿querías decir "${sugerida}"?`)
    return salida
  }

  if (nuevas.length === 0) {
    const bloques = [`[guardClaves] OK · ${resumen(informe)}.`]
    if (deuda.length > 0) {
      bloques.push(
        '',
        `  Sigue habiendo ${deuda.length} referencia(s) de DEUDA CONOCIDA: identificadores`,
        '  que HOY se pintan en crudo en la pantalla. Ver DEUDA_CONOCIDA en',
        '  scripts/security/guardClaves.ts — el arreglo es en messages/*.json.',
        '',
        ...deuda.flatMap(linea),
      )
    }
    return bloques.join('\n')
  }

  return [
    `[guardClaves] ${nuevas.length} clave(s) que el código PIDE y el catálogo NO TIENE:`,
    '',
    ...nuevas.flatMap(linea),
    '',
    `  (${resumen(informe)})`,
    '',
    'Esto NO revienta en tiempo de ejecución, y ese es justo el problema:',
    '`obtenerTraductor()` devuelve la clave cruda cuando no la encuentra, así que',
    'la pantalla pinta el identificador donde tenía que ir una frase. Solo se ve',
    'llegando a ese botón exacto, y por eso hace falta este guard.',
    '',
    'Cómo arreglarlo, por orden:',
    '  1. Si arriba hay un «¿querías decir…?», casi seguro es eso: la clave existe',
    '     pero bajo otra raíz. Corrige la referencia en el código.',
    '  2. Para ver el estado completo y buscar a mano lo que hay cerca:',
    '',
    '         node --experimental-strip-types scripts/security/guardClaves.ts',
    '',
    '  3. Si la clave es nueva de verdad, añádela a LOS DOS catálogos —',
    '     `messages/es.json` y `messages/en.json`— bajo una de las raíces de',
    '     `RAICES_DE_DOMINIO`. Si la pones solo en uno, falla el guard de paridad',
    '     de `i18n/claves.test.ts`, que es el sistema funcionando.',
    '',
    'Para ver las referencias dinámicas (las que este guard NO puede comprobar):',
    '',
    '    node --experimental-strip-types scripts/security/guardClaves.ts --dinamicas',
  ].join('\n')
}

/**
 * Las irresolubles, con archivo y línea. No es una lista de fallos: es la
 * frontera del guard puesta por escrito, para que quien toque una de estas
 * llamadas sepa que ahí no hay red.
 */
export function formatearDinamicas(informe: InformeClaves): string {
  if (informe.dinamicas.length === 0) return '[guardClaves] no hay referencias dinámicas.'
  return [
    `[guardClaves] ${informe.dinamicas.length} referencia(s) dinámica(s) — NO comprobadas:`,
    '',
    ...informe.dinamicas.map((d) => `  · ${d.archivo}:${d.linea} · ${d.origen} → ${d.expresion}`),
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const soloDinamicas = args.includes('--dinamicas')
  const posicional = args.find((a) => !a.startsWith('--'))
  const raiz = posicional ? resolve(posicional) : RAIZ_POR_DEFECTO

  const catalogo = clavesDelCatalogo()
  const informe = comprobarClaves(raiz, catalogo)

  console.error(soloDinamicas ? formatearDinamicas(informe) : formatearInforme(informe, catalogo))
  process.exit(rotasNuevas(informe).length === 0 ? 0 : 1)
}
