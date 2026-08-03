// ============================================================================
// Cursor keyset del hilo — propio de B04
//
// El par que ordena es `(created_at, id)` ASCENDENTE, el mismo que indexa
// `idx_comments_post_keyset`. Nunca OFFSET (CONTRATOS §5).
//
// ── POR QUÉ ES OPACO Y POR QUÉ UN CURSOR CORRUPTO NO ES UN ERROR ───────────
// Opaco (base64url) para que nadie construya uno a mano y acabe dependiendo de
// su formato: el día que el par de ordenación cambie, el cliente no se entera.
//
// Y ante un cursor ilegible se devuelve la PRIMERA página con un 200, no un
// 400. Un cursor lo genera esta misma API y viaja en una URL: se rompe al
// copiar y pegar, al truncarlo un cliente de chat, o al recortarlo un
// analytics. Devolver un error convierte un enlace mal copiado en una pantalla
// rota; devolver la primera página es exactamente lo que la persona esperaba
// ver al abrir el hilo. No hay nada que proteger aquí: el cursor no autoriza
// nada, solo dice por dónde íbamos.
//
// Sin dependencias a propósito: así se prueba con `node --test` sin arrastrar
// el runtime de Next.
// ============================================================================

/** Posición dentro del hilo. */
export interface CursorHilo {
  /** ISO-8601 de `comments.created_at`. */
  creadoEn: string
  /** uuid de `comments.id`. Es el desempate, no el orden. */
  id: string
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function aBase64Url(texto: string): string {
  return Buffer.from(texto, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function deBase64Url(texto: string): string {
  const relleno = texto.length % 4 === 0 ? '' : '='.repeat(4 - (texto.length % 4))
  return Buffer.from(texto.replace(/-/g, '+').replace(/_/g, '/') + relleno, 'base64').toString('utf8')
}

/** Codifica una posición. El separador es `|` porque no aparece ni en un ISO
 *  ni en un uuid, así que no hace falta escapar nada. */
export function codificarCursor(cursor: CursorHilo): string {
  return aBase64Url(`${cursor.creadoEn}|${cursor.id}`)
}

/**
 * Decodifica un cursor. Devuelve `null` ante CUALQUIER entrada que no sea un
 * cursor válido —vacía, no base64, con partes de más, con una fecha o un uuid
 * que no lo son—, y quien llama lo trata como «primera página».
 *
 * Se valida la forma de las dos partes y no solo que existan: una fecha
 * inventada se colaría en el `where` de la consulta y produciría una página
 * silenciosamente vacía, que es peor que ignorar el cursor.
 */
export function decodificarCursor(crudo: string | null | undefined): CursorHilo | null {
  if (!crudo) return null

  let plano: string
  try {
    plano = deBase64Url(crudo)
  } catch {
    return null
  }

  const partes = plano.split('|')
  if (partes.length !== 2) return null

  const [creadoEn, id] = partes as [string, string]
  if (!RE_UUID.test(id)) return null

  const fecha = new Date(creadoEn)
  if (Number.isNaN(fecha.getTime())) return null

  return { creadoEn, id }
}
