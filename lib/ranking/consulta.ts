// ============================================================================
// B06 · Las dos lecturas del tablero. Cliente RLS, nunca el admin.
//
// Las dos golpean SOLO `ranking_snapshots` (más un lookup por PK a `profiles`
// para el alias, la semilla del avatar y el nivel). Ni una agregación, ni un
// `count(*)`, ni un `OFFSET`, ni un N+1: la foto ya está construida y aquí solo
// se recorre un índice.
//
// Presupuesto de la pantalla /ranking: DOS consultas por render, y son
// exactamente estas dos. El podio no gasta una tercera — sale de las tres
// primeras filas de la misma página 1.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { codificarCursor, type CursorTablero } from './cursor.ts'
import { aFilaRanking } from './movimiento.ts'
import type {
  FilaRanking,
  FilaTableroSql,
  PeriodoRanking,
  TableroRanking,
} from './tipos.ts'

/** Tamaño por defecto y tope duro de página. El tope también está en el `least`
 *  de la función SQL: un cliente que se salte la validación de zod tampoco
 *  puede pedir 5 000 filas. */
export const LIMITE_POR_DEFECTO = 20
export const LIMITE_MAXIMO = 50

export interface OpcionesTablero {
  periodo: PeriodoRanking
  corte: string
  cursor?: CursorTablero | null
  limite?: number
}

export async function consultarTablero(
  supabase: SupabaseClient,
  opciones: OpcionesTablero,
): Promise<TableroRanking> {
  const { periodo, corte } = opciones
  const limite = Math.min(Math.max(opciones.limite ?? LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO)

  const { data, error } = await supabase.rpc('ranking_tablero', {
    p_periodo: periodo,
    p_corte: corte,
    p_cursor_rank: opciones.cursor?.rank ?? null,
    p_cursor_user: opciones.cursor?.userId ?? null,
    p_limite: limite,
  })

  if (error) {
    throw new Error(`[darma][ranking] fallo al leer el tablero: ${error.message}`)
  }

  const filas = (Array.isArray(data) ? data : []) as FilaTableroSql[]
  const items = filas.map((fila) => aFilaRanking(fila, periodo))

  // El cursor se emite solo cuando la página vino LLENA. Emitirlo siempre haría
  // que la UI pidiera una página más para descubrir que no hay nada: una
  // petición de más por cada persona que llega al final de la lista.
  const ultima = filas.length === limite ? filas[filas.length - 1] : undefined

  return {
    periodo,
    corte,
    // `built_at` sale de la propia página. Sin filas no hay foto que datar, y
    // gastar una consulta extra para poner fecha a un tablero vacío rompería el
    // presupuesto de 2 consultas por render.
    construidoEn: filas[0]?.built_at ?? null,
    items,
    siguienteCursor: ultima
      ? codificarCursor({ rank: ultima.rank, userId: ultima.user_id })
      : null,
  }
}

/**
 * Tu fila (o la de quien se indique), aunque estés en el puesto 40 000.
 *
 * Lectura por clave primaria `(period, period_start, user_id)`: nunca se pagina
 * hasta ti. Sin esto, «tu posición» solo sería visible para quien ya está
 * arriba, que es exactamente la gente que menos lo necesita.
 *
 * NO ESTAR EN LA FOTO NO ES UN ERROR: quien no ha escuchado a nadie esta semana
 * simplemente no aparece, y la respuesta correcta es `null`. Un 404 ahí
 * convertiría «todavía no has empezado» en «algo ha fallado».
 */
export async function consultarMiFila(
  supabase: SupabaseClient,
  periodo: PeriodoRanking,
  corte: string,
  usuario?: string | null,
): Promise<FilaRanking | null> {
  const { data, error } = await supabase.rpc('ranking_fila', {
    p_periodo: periodo,
    p_corte: corte,
    p_usuario: usuario ?? null,
  })

  if (error) {
    throw new Error(`[darma][ranking] fallo al leer la fila propia: ${error.message}`)
  }

  const filas = (Array.isArray(data) ? data : []) as FilaTableroSql[]
  const fila = filas[0]

  return fila ? aFilaRanking(fila, periodo) : null
}
