// ============================================================================
// B07 · Cursor keyset del feed vertical (CONTRATOS §5).
//
// El cursor es OPACO: base64 de `<score>|<uuid>`. No porque sea un secreto —lo
// que codifica es público— sino porque en cuanto un cliente aprende a
// construirlo, el formato deja de poder cambiar sin romper apps instaladas.
//
// Decodificar SIEMPRE valida: un cursor corrupto o manipulado devuelve `null`,
// y la ruta lo convierte en 422 `entrada_invalida`. Lo que NO se hace es caer a
// "primera página" en silencio: eso convierte un scroll roto en un bucle
// infinito de la misma página, que es mucho más difícil de diagnosticar.
// ============================================================================

/** Par que ordena el índice `idx_content_feed`: (performance_score, id). */
export interface Cursor {
  score: number
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cursor de la primera página: el techo del índice. */
export const CURSOR_INICIAL: Cursor = {
  score: Number.POSITIVE_INFINITY,
  id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
}

export function codificarCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.score}|${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * Decodifica y valida. `null` = cursor inválido (no "primera página").
 *
 * Se rechaza `Infinity` y `NaN` que llegasen del cliente: el primero es el
 * sentinel interno de la primera página y aceptarlo desde fuera permitiría
 * pedir siempre la cabeza del feed con un cursor que aparenta ser de scroll.
 */
export function decodificarCursor(valor: string): Cursor | null {
  let texto: string
  try {
    texto = Buffer.from(valor, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separador = texto.lastIndexOf('|')
  if (separador <= 0) return null

  const score = Number(texto.slice(0, separador))
  const id = texto.slice(separador + 1)

  if (!Number.isFinite(score)) return null
  if (!UUID.test(id)) return null

  return { score, id }
}

/**
 * Cursor de la página siguiente, o `null` si no hay más.
 *
 * `null` cuando la página vino incompleta: pedimos `limite` y llegaron menos,
 * así que no hace falta un viaje más para descubrir que se acabó.
 */
export function siguienteCursor(
  filas: ReadonlyArray<{ id: string; performance_score: number }>,
  limite: number,
): string | null {
  if (filas.length < limite || filas.length === 0) return null
  const ultima = filas[filas.length - 1]
  return codificarCursor({ score: ultima.performance_score, id: ultima.id })
}
