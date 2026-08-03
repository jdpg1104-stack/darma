// ============================================================================
// B06 · Movimiento respecto al corte anterior, y la traducción de fila cruda.
//
// Puro y sin dependencias de red: es lo que permite probar la regla del
// histórico sin base de datos.
// ============================================================================

import type { FilaRanking, FilaTableroSql, PeriodoRanking } from './tipos.ts'

/**
 * `prev_rank − rank`. Positivo = subió; negativo = bajó; `null` = entra nuevo.
 *
 * REGLA DEL HISTÓRICO, y no es un detalle estético: en `historico` el
 * movimiento es SIEMPRE `null`. Un histórico no se reinicia nunca, así que su
 * «corte anterior» sería la misma foto de hace una hora y el delta mediría el
 * ruido de la última hora disfrazado de progreso del periodo. Peor todavía:
 * enseñaría un «−1» a alguien que no ha dejado de ayudar, solo porque otra
 * persona le adelantó. En el histórico la insignia es el NIVEL, que sí es
 * acumulativo y no puede bajar.
 */
export function calcularMovimiento(
  periodo: PeriodoRanking,
  rank: number,
  prevRank: number | null | undefined,
): number | null {
  if (periodo === 'historico') return null
  if (prevRank == null) return null
  return prevRank - rank
}

/**
 * Fila cruda de Postgres → `FilaRanking`.
 *
 * Es el único punto de la app donde se construye una fila del tablero, y por
 * eso es también la barrera de anonimato: se enumeran los cuatro campos del
 * perfil que salen, en vez de esparcir la fila con `...`. Un `...fila` aquí
 * publicaría cualquier columna que una migración futura añadiera al `returns
 * table` de la función SQL, sin que nadie lo notara.
 */
export function aFilaRanking(fila: FilaTableroSql, periodo: PeriodoRanking): FilaRanking {
  return {
    posicion: fila.rank,
    perfil: {
      id: fila.user_id,
      alias: fila.alias,
      avatarSeed: fila.avatar_seed,
      nivel: fila.level,
    },
    escuchas: fila.listens,
    movimiento: calcularMovimiento(periodo, fila.rank, fila.prev_rank),
  }
}
