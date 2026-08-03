// ============================================================================
// B06 · El techo antifarmeo del ranking
//
// `award_karma()` recorta a 120 puntos de reputación al día (DAILY_KARMA_CAP).
// Como un comentario validado paga 10, eso equivale exactamente a 12 escuchas
// diarias con valor. El ranking replica ese mismo techo EN EL AGREGADO:
//
//     sum(least(listens_del_dia, LISTENS_DIA_MAX))
//
// ── POR QUÉ ESTO NO ES UNA OPTIMIZACIÓN, SINO LA REGLA ENTERA ──────────────
// Sin el `least`, quien encuentre una forma de validar 300 comentarios en una
// noche encabeza la tabla aunque su karma esté topado desde el comentario 12.
// El tope diario dejaría de significar nada: seguiría limitando los puntos,
// pero no el estatus, y en Darma el estatus ES el producto. El techo tiene que
// estar en los dos sitios o no está en ninguno.
//
// ── POR QUÉ SE DERIVA Y NO SE TECLEA ───────────────────────────────────────
// El número es 12 hoy. Si mañana el tope diario sube a 150 o el comentario
// validado pasa a pagar 15, un 12 escrito a mano deja el ranking premiando lo
// que la economía ya no paga, y nadie relacionaría las dos cosas. Se importa de
// lib/karma.ts, que es la SSOT en TypeScript y está a su vez verificada contra
// el SQL por lib/economySync.test.ts. Hay un test aquí que falla si alguien
// sustituye la división por el literal.
// ============================================================================

import { DAILY_KARMA_CAP, KARMA_WEIGHTS } from '../karma.ts'

/**
 * Escuchas validadas que como mucho cuentan en UN día natural de Madrid.
 *
 * `Math.floor` porque un techo fraccionario no tiene sentido en un contador de
 * comentarios, y hacia abajo porque el techo debe ser el número de escuchas que
 * la economía llega a PAGAR ENTERAS: con un tope de 125 y un peso de 10, la
 * escucha 13 solo cobraría 5, así que no merece contar como escucha completa.
 */
export const LISTENS_DIA_MAX: number = Math.floor(
  DAILY_KARMA_CAP / KARMA_WEIGHTS.comment_validated.reputation,
)

/**
 * Aplica el techo a la serie de días de una persona.
 *
 * Función pura y exportada a propósito: es el corazón de la regla antifarmeo y
 * el sitio donde se prueba el camino de fallo (300 escuchas en un día agregan
 * al techo, no a 300). El SQL del constructor hace exactamente esto mismo con
 * `sum(least(...))`; este espejo en TypeScript existe para poder razonar y
 * probar sin base de datos, igual que `lib/karma.ts` es espejo de
 * `award_karma()`.
 *
 * @param porDia escuchas de cada día. El orden no importa: es una suma.
 * @param techo  inyectable únicamente para los tests.
 */
export function escuchasConTecho(
  porDia: readonly number[],
  techo: number = LISTENS_DIA_MAX,
): number {
  let total = 0
  for (const dia of porDia) {
    // Los negativos no existen en la base (`check (listens >= 0)`), pero un 0
    // por `greatest` es más barato que confiar en que nunca llegue uno.
    total += Math.min(Math.max(0, dia), techo)
  }
  return total
}
