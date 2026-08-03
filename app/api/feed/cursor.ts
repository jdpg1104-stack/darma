// ============================================================================
// Cursor compuesto del feed mixto
//
// El feed entrelaza TRES carriles independientes (posts, contenido curado,
// encuestas) y cada uno avanza a su ritmo. Un solo cursor de posts no bastaría:
// al pedir la página 2 no sabríamos por dónde iba el contenido, y el usuario
// vería el mismo vídeo en la posición 3 de todas las páginas.
//
// Formato: `<p>.<c>.<q>`, tres segmentos base64url separados por puntos.
//   p → posición del carril de posts
//   c → posición del contenido curado (performance_score, id)
//   q → posición de las encuestas (created_at, id)
// Un segmento vacío significa «ese carril se agotó» o «primera página».
//
// ── POR QUÉ NO SE ENVUELVE TODO EN UN SEGUNDO base64 ────────────────────────
// Sería lo natural («un único token base64url»), pero el contrato de seguridad
// de la ficha limita `cursor` a 256 caracteres —un cursor de 4 KB pegado cien
// veces es un DoS barato— y una segunda capa de base64 infla un 33 % sobre unos
// segmentos que ya suman ~210 caracteres: el token válido se pasaría del límite
// que nosotros mismos imponemos. Los tres segmentos ya son base64url, así que el
// token compuesto sigue siendo opaco y seguro en una query string; lo único que
// se pierde es una capa de codificación que no aportaba nada.
//
// ── ANTE UN CURSOR CORRUPTO: PRIMERA PÁGINA, NUNCA UN 500 ───────────────────
// Mismo criterio que `decodeCursor` de lib/feedRanking.ts. Un cursor roto es una
// url mal pegada o un enlace viejo, no un fallo del sistema, y la respuesta útil
// es el principio del feed. Cada segmento se valida por separado: que el tramo
// de encuestas esté corrupto no debe tirar el tramo de posts.
//
// ── POR QUÉ NO VA FIRMADO ───────────────────────────────────────────────────
// Por lo mismo que explica lib/feedRanking.ts: es una posición pública dentro de
// un orden público. Falsificarlo solo te lleva a otro punto del mismo feed, que
// ya está filtrado por RLS. Firmarlo daría una sensación de seguridad sobre algo
// que no la necesita, y costaría un secreto más que rotar.
// ============================================================================

import { decodeCursor, encodeCursor, type FeedCursor } from '../../../lib/feedRanking.ts'
import type { Carril } from './tipos.ts'

/** Posición de un carril ordenado por tiempo: `(timestamptz, uuid)`. */
export interface PosicionTemporal {
  /**
   * Instante EXACTAMENTE como lo devolvió Postgres, con sus microsegundos.
   *
   * No se normaliza a milisegundos ni se pasa por `Date`: `created_at` es
   * `timestamptz` (precisión de microsegundos) y truncarlo haría que el
   * predicado `(created_at, id) < (:ts, :id)` se saltara las filas escritas en
   * los microsegundos intermedios. Serían posts que nadie llega a ver nunca, y
   * el fallo no se nota desde la app.
   */
  instante: string
  id: string
}

/**
 * Las tres posiciones de una página.
 *
 * `postsHot` y `postsNuevo` son excluyentes —dependen del carril— y por eso son
 * dos campos y no una unión: un `FeedCursor | PosicionTemporal` obligaría a cada
 * consumidor a discriminar el tipo en tiempo de ejecución, que es justo la clase
 * de comprobación que se olvida.
 */
export interface CursorCompuesto {
  /** Carril `para_ti`: `(hot_score, id)`. */
  postsHot: FeedCursor | null
  /** Carril `nuevo`: `(created_at, id)`. */
  postsNuevo: PosicionTemporal | null
  /** Contenido curado: `(performance_score, id)`. */
  contenido: FeedCursor | null
  /** Encuestas: `(created_at, id)`. */
  encuesta: PosicionTemporal | null
}

/** Cursor de primera página: los tres carriles arrancan desde el principio. */
export const CURSOR_VACIO: CursorCompuesto = {
  postsHot: null,
  postsNuevo: null,
  contenido: null,
  encuesta: null,
}

const SEPARADOR_SEGMENTOS = '.'
const SEPARADOR_INTERNO = '|'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Segmento temporal: mismo formato que `encodeCursor` (`<clave>|<uuid>` en
 * base64url), pero con la clave en texto en vez de en número. `encodeCursor` no
 * sirve aquí porque exige un `number` finito y un instante con microsegundos no
 * cabe en un `double` sin perder precisión (ver `PosicionTemporal.instante`).
 */
function codificarTemporal(posicion: PosicionTemporal | null): string {
  if (!posicion) return ''
  return Buffer.from(`${posicion.instante}${SEPARADOR_INTERNO}${posicion.id}`, 'utf8').toString('base64url')
}

function decodificarTemporal(token: string): PosicionTemporal | null {
  if (!token) return null
  try {
    const crudo = Buffer.from(token, 'base64url').toString('utf8')
    const corte = crudo.indexOf(SEPARADOR_INTERNO)
    if (corte <= 0) return null

    const instante = crudo.slice(0, corte)
    const id = crudo.slice(corte + 1)

    if (!UUID.test(id)) return null
    // El instante tiene que ser una fecha de verdad; lo que Postgres devolvió
    // siempre lo es. Se comprueba el PARSEO pero se conserva el TEXTO original,
    // para no perder los microsegundos al volver a serializarlo.
    if (Number.isNaN(Date.parse(instante))) return null

    return { instante, id }
  } catch {
    return null
  }
}

/** Segmento numérico. Reutiliza literalmente el codec de lib/feedRanking.ts. */
function codificarNumerico(posicion: FeedCursor | null): string {
  if (!posicion) return ''
  try {
    return encodeCursor(posicion)
  } catch {
    // `encodeCursor` lanza ante un score no finito. Aquí eso significa «no hay
    // posición válida», no «se cae la petición»: se devuelve el carril al
    // principio, que como mucho repite una tarjeta de contenido.
    return ''
  }
}

/**
 * Serializa las tres posiciones en un token.
 *
 * Devuelve `null` cuando el carril de posts —la columna vertebral del feed— ya
 * no tiene posición: sin posts no hay página siguiente que pedir, aunque
 * quedaran vídeos por mostrar. Un feed que continúa solo con contenido curado no
 * es el feed de una comunidad.
 */
export function codificarCursor(cursor: CursorCompuesto, carril: Carril): string | null {
  const p = carril === 'para_ti' ? codificarNumerico(cursor.postsHot) : codificarTemporal(cursor.postsNuevo)
  if (!p) return null

  const c = codificarNumerico(cursor.contenido)
  const q = codificarTemporal(cursor.encuesta)

  return [p, c, q].join(SEPARADOR_SEGMENTOS)
}

/**
 * Deserializa un token. NUNCA lanza: cualquier entrada inválida —base64 roto,
 * uuid mal formado, número no finito, segmentos de más o de menos— produce el
 * cursor vacío, es decir, la primera página.
 *
 * El `carril` decide cómo se lee el primer segmento. Cambiar de carril con un
 * cursor del otro no rompe nada: el segmento no valida y ese carril arranca de
 * cero, que es exactamente lo que la persona espera al cambiar de pestaña.
 */
export function decodificarCursor(token: string | null | undefined, carril: Carril): CursorCompuesto {
  if (!token) return CURSOR_VACIO

  const partes = token.split(SEPARADOR_SEGMENTOS)
  // Ni menos de tres (token truncado) ni más (alguien probando el parser).
  if (partes.length !== 3) return CURSOR_VACIO

  const [p, c, q] = partes

  return {
    postsHot: carril === 'para_ti' ? decodeCursor(p) : null,
    postsNuevo: carril === 'nuevo' ? decodificarTemporal(p) : null,
    contenido: decodeCursor(c),
    encuesta: decodificarTemporal(q),
  }
}

/** ¿Este cursor apunta al principio de los tres carriles? */
export function esPrimeraPagina(cursor: CursorCompuesto): boolean {
  return (
    cursor.postsHot === null &&
    cursor.postsNuevo === null &&
    cursor.contenido === null &&
    cursor.encuesta === null
  )
}
