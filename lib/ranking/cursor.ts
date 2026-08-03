// ============================================================================
// B06 · Cursor keyset del tablero
//
// El cursor es la tupla `(rank, user_id)` codificada en base64url. Opaco para
// el cliente por contrato (CONTRATOS §5), pero opaco no significa de confianza:
// llega por la query string, así que se valida entero al decodificar.
//
// ── POR QUÉ LA TUPLA LLEVA `user_id` Y NO SOLO EL RANK ─────────────────────
// `dense_rank()` empata: tres personas con las mismas escuchas comparten el
// puesto 15. Un keyset `where rank > 15` se come a las dos que no cupieron en
// la página. El cursor tiene que apuntar a una posición ÚNICA en el orden, y
// `(rank, user_id)` lo es porque `user_id` es justo el desempate estable que
// usa `dense_rank()` al construir la foto.
//
// ── POR QUÉ UN CURSOR CORRUPTO ES 422 Y NO «primera página» ────────────────
// El feed (B02) degrada un cursor roto a la primera página, y allí es la
// decisión correcta: el usuario ve contenido en vez de un error. Aquí no.
// En un tablero, devolver la página 1 cuando pedían la 40 da la apariencia de
// que el «cargar más» funciona mientras repite el podio en bucle, y eso es peor
// que un error visible. La ficha B06 lo exige explícitamente: cursor corrupto
// («no es base64», «rank negativo») → 422, nunca un 500 ni una página vacía
// silenciosa.
// ============================================================================

/** Posición exacta desde la que continúa la página siguiente. */
export interface CursorTablero {
  rank: number
  userId: string
}

/** Longitud máxima aceptada. Un cursor legítimo ronda los 60 caracteres; el
 *  límite corta de raíz el intento de meter un payload por la query string. */
const MAX_LONGITUD = 128

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function codificarCursor(cursor: CursorTablero): string {
  return Buffer.from(`${cursor.rank}:${cursor.userId}`, 'utf8').toString('base64url')
}

/**
 * Decodifica y VALIDA. Devuelve `null` si no venía cursor (primera página) y
 * lanza si venía y no es válido.
 *
 * @throws {RangeError} cursor presente pero corrupto. Quien llama lo traduce a
 *         `entrada_invalida`; este módulo no conoce los códigos de la API para
 *         poder probarse sin arrastrar el runtime de Next.
 */
export function decodificarCursor(valor: string | null | undefined): CursorTablero | null {
  if (valor == null || valor === '') return null
  if (typeof valor !== 'string' || valor.length > MAX_LONGITUD) {
    throw new RangeError('cursor de ranking inválido')
  }

  let plano: string
  try {
    plano = Buffer.from(valor, 'base64url').toString('utf8')
  } catch {
    throw new RangeError('cursor de ranking inválido')
  }

  // `Buffer.from(..., 'base64url')` NO lanza con basura: ignora los caracteres
  // que no pertenecen al alfabeto y devuelve lo que pueda. Por eso la validación
  // de verdad es la de la forma decodificada, no el try/catch de arriba.
  const separador = plano.indexOf(':')
  if (separador < 1) throw new RangeError('cursor de ranking inválido')

  const rank = Number(plano.slice(0, separador))
  const userId = plano.slice(separador + 1)

  if (!Number.isInteger(rank) || rank < 1) throw new RangeError('cursor de ranking inválido')
  if (!UUID.test(userId)) throw new RangeError('cursor de ranking inválido')

  return { rank, userId }
}
