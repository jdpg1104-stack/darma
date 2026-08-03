// ============================================================================
// B06 · Tipos del ranking. Es la superficie que ven B05, B13 y los componentes.
//
// La regla que ordena este archivo: una fila del tablero es `PerfilPublico`
// RECORTADO más la métrica de escucha, y nada más. No hay aquí —ni puede
// haber— `karmaSpendable`, `crystals`, `listenCredits`, `listensGiven`,
// `postsPublished` ni `shadowBanned`. `authenticated` ni siquiera tiene el
// privilegio de SELECT sobre esas columnas de `profiles` (0001 + 0006), así que
// el tipo no es una convención: es el reflejo exacto de lo que la base deja
// leer. Lo que no se puede pasar no se puede filtrar.
//
// `escuchas` es la excepción aparente, y merece la explicación: NO sale de
// `profiles.listens_given` (revocada), sale de `ranking_snapshots.listens`, que
// es un agregado por periodo, ya recortado por el techo antifarmeo y construido
// con service_role. B05 dejó anotado que el perfil ajeno no puede mostrar
// contadores de escuchas; el ranking tiene el mismo límite y lo resuelve con su
// propia foto, no reabriendo la columna.
// ============================================================================

import type { KarmaLevel } from '../karma.ts'

/** Los tres periodos del tablero. Espejo del CHECK de `ranking_snapshots.period`. */
export type PeriodoRanking = 'semana' | 'mes' | 'historico'

export const PERIODOS: readonly PeriodoRanking[] = ['semana', 'mes', 'historico'] as const

/** Etiquetas de UI. En español directo: el catálogo i18n (B17) llegó en
 *  paralelo y estos textos quedan anotados como deuda de traducción en
 *  HANDOFF/PEDIDOS.md. */
export const ETIQUETA_PERIODO: Readonly<Record<PeriodoRanking, string>> = {
  semana: 'Esta semana',
  mes: 'Este mes',
  historico: 'Desde siempre',
}

/** ¿Es un periodo válido? Guarda de tipo, para validar lo que llega de fuera. */
export function esPeriodo(valor: unknown): valor is PeriodoRanking {
  return typeof valor === 'string' && (PERIODOS as readonly string[]).includes(valor)
}

/** Fila del tablero. Solo campos de PerfilPublico + la métrica de escucha. */
export interface FilaRanking {
  posicion: number
  perfil: {
    id: string
    alias: string
    avatarSeed: string
    nivel: KarmaLevel
  }
  /** Escuchas validadas en el periodo, ya recortadas por el techo diario. */
  escuchas: number
  /** posicion anterior − posicion. >0 subió, <0 bajó, null = entra nuevo.
   *  SIEMPRE null en `historico`: un histórico no se reinicia, así que el
   *  movimiento allí no significa nada. */
  movimiento: number | null
}

export interface TableroRanking {
  periodo: PeriodoRanking
  /** Corte del periodo en ISO-8601 (fecha, sin hora). */
  corte: string
  /**
   * Instante de construcción de la foto: la UI muestra «actualizado hace X».
   *
   * DESVIACIÓN DEL CONTRATO DE LA FICHA, que lo declara `string`: es
   * `string | null` porque una página vacía no tiene ninguna fila de la que
   * leer `built_at`, y las dos alternativas eran peores. Devolver `now()`
   * afirmaría que la foto se acaba de construir cuando puede que no exista, y
   * gastar una consulta extra solo para datar un tablero vacío rompe el
   * presupuesto de 2 consultas por render.
   */
  construidoEn: string | null
  items: FilaRanking[]
  siguienteCursor: string | null
}

/**
 * Fila cruda tal y como la devuelven `ranking_tablero()` y `ranking_fila()`.
 *
 * Se declara a mano y no se deriva de `Database` (CONTRATOS §3) porque
 * `lib/supabase/database.types.ts` se regenera en CI (dueño B15) y todavía no
 * contiene estas dos funciones. Anotado en HANDOFF/PEDIDOS.md.
 */
export interface FilaTableroSql {
  rank: number
  listens: number
  prev_rank: number | null
  built_at: string
  user_id: string
  alias: string
  avatar_seed: string
  level: KarmaLevel
}

/** Resultado de una pasada del constructor. Lo devuelve `POST /api/ranking/snapshot`. */
export interface ResultadoSnapshot {
  periodo: PeriodoRanking
  corte: string
  filas: number
  /** `false` = se agotó el presupuesto de tiempo; el siguiente disparo sigue. */
  completado: boolean
  /** Último `user_id` escrito. Es el cursor de continuación, no un dato de nadie. */
  ultimoUsuario: string | null
}
