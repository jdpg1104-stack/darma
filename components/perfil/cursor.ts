// ============================================================================
// Cursor opaco del historial de karma (CONTRATOS §5)
//
// El cursor lleva el par `(created_at, id)` que ordena e indexa el ledger, que
// es lo mismo que dice el predicado del keyset. Va en base64url y el cliente lo
// devuelve tal cual: no lo interpreta, no lo construye y no lo modifica.
//
// ── POR QUÉ OPACO, SI NO ES UN SECRETO ─────────────────────────────────────
// `karma_events.id` es un `bigint identity` GLOBAL de la tabla, no por usuario.
// Publicarlo como campo suelto le da a cualquiera con una cuenta el número
// total de eventos de karma de toda la red, y dos lecturas separadas en el
// tiempo le dan la tasa de crecimiento de Darma. Dentro de una cadena base64
// que nadie lee sigue estando, pero deja de ser una superficie que alguien
// consuma y que después no podamos cambiar.
//
// ── POR QUÉ UN CURSOR CORRUPTO NO ES UN ERROR ──────────────────────────────
// `decodificarCursor` devuelve `null` en vez de lanzar. Un cursor inválido llega
// por tres vías —un enlace viejo, un copia-pega a medias, una recarga tras un
// despliegue que cambió el formato— y en las tres la respuesta útil es la
// primera página, no un 422 delante de alguien que solo quería ver su historial.
// El keyset no es un permiso: la RPC filtra por `auth.uid()` pase lo que pase en
// el cursor, así que un cursor manipulado no puede leer el ledger de nadie más.
// Lo peor que consigue quien lo manipule es saltar a otro punto de SU historial.
// ============================================================================

/** El par que ordena, indexa y desempata el ledger. */
export interface CursorHistorial {
  /** ISO-8601 de `karma_events.created_at`. */
  creadoEn: string
  /** `karma_events.id`. Como STRING: es un bigint y `number` de JS pierde
   *  precisión por encima de 2^53. Hoy no llega; el día que llegue, el bug
   *  serían páginas que se saltan filas y nadie sabría por qué. */
  id: string
}

/** Tope de longitud del cursor. Se valida también con zod en la ruta; aquí es
 *  la guarda que evita gastar CPU decodificando base64 de 10 MB. */
export const MAX_LONGITUD_CURSOR = 256

export function codificarCursor(cursor: CursorHistorial): string {
  const json = JSON.stringify({ c: cursor.creadoEn, i: cursor.id })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * Decodifica un cursor. `null` si es inválido por cualquier motivo — quien
 * llama trata `null` como "primera página".
 */
export function decodificarCursor(valor: string | null | undefined): CursorHistorial | null {
  if (!valor || valor.length > MAX_LONGITUD_CURSOR) return null

  try {
    const json = Buffer.from(valor, 'base64url').toString('utf8')
    const bruto: unknown = JSON.parse(json)

    if (typeof bruto !== 'object' || bruto === null) return null
    const { c, i } = bruto as { c?: unknown; i?: unknown }

    if (typeof c !== 'string' || typeof i !== 'string') return null
    // Una fecha que no es una fecha convertiría el `where` en una comparación
    // contra NULL y devolvería la página entera desordenada.
    if (Number.isNaN(Date.parse(c))) return null
    // Solo dígitos: es un bigint identity, siempre positivo y sin signo. Además
    // impide colar cualquier cosa en el parámetro de la RPC.
    if (!/^\d{1,19}$/.test(i)) return null

    return { creadoEn: c, id: i }
  } catch {
    return null
  }
}
