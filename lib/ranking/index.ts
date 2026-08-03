// ============================================================================
// B06 · El barril de `lib/ranking`. La superficie que consumen otros bloques.
//
// B05 (perfil: «tu posición») y B13 (push: «has entrado al podio») dependen de
// `obtenerPosicionDe()`. Esa función es el contrato con ellos: si cambia su
// firma, hay que avisar en PEDIDOS.md antes de tocarla.
// ============================================================================

export type {
  FilaRanking,
  PeriodoRanking,
  ResultadoSnapshot,
  TableroRanking,
} from './tipos.ts'
export { ETIQUETA_PERIODO, PERIODOS, esPeriodo } from './tipos.ts'

export {
  INICIO_HISTORICO,
  ZONA_NEGOCIO,
  corteAnteriorDe,
  esFechaIso,
  finPeriodo,
  inicioPeriodo,
  inicioPeriodoAnterior,
} from './periodos.ts'

export { LISTENS_DIA_MAX, escuchasConTecho } from './techo.ts'
export { calcularMovimiento } from './movimiento.ts'
export { codificarCursor, decodificarCursor, type CursorTablero } from './cursor.ts'
export { LIMITE_MAXIMO, LIMITE_POR_DEFECTO, consultarMiFila, consultarTablero } from './consulta.ts'
export { construirSnapshot, type OpcionesSnapshot } from './construirSnapshot.ts'

import { consultarMiFila } from './consulta.ts'
import { inicioPeriodo } from './periodos.ts'
import type { FilaRanking, PeriodoRanking } from './tipos.ts'

/**
 * Posición de una persona en el periodo indicado, o `null` si no está en la
 * foto. Para B05 (perfil) y B13 (push).
 *
 * ── POR QUÉ NO RECIBE EL CLIENTE DE SUPABASE ───────────────────────────────
 * Para que quien la consume no tenga que saber que existe un cliente RLS ni de
 * dónde sale. Se construye dentro, con importación diferida: `lib/supabase/
 * server.ts` importa `next/headers`, que no se puede cargar fuera del runtime
 * de Next, y con el import arriba este módulo sería imposible de cargar desde
 * `node --test`. Mismo patrón que `lib/auth/session.ts`.
 *
 * ── POR QUÉ EL CLIENTE RLS Y NO EL ADMIN ───────────────────────────────────
 * Porque no hace falta: `ranking_snapshots` es legible por cualquiera con
 * sesión (la foto ya viene filtrada de shadow-baneados en construcción) y las
 * columnas de `profiles` que devuelve son las públicas. Usar el admin aquí
 * expondría `identity_vault` en la cadena de imports de una pantalla de perfil,
 * a cambio de nada.
 *
 * ── POR QUÉ NO LANZA CUANDO NO HAY FOTO ────────────────────────────────────
 * `null` es un resultado legítimo: quien no ha escuchado a nadie esta semana no
 * está en el tablero. Quien llama pinta «todavía no apareces», no un error.
 */
export async function obtenerPosicionDe(
  userId: string,
  periodo: PeriodoRanking,
): Promise<FilaRanking | null> {
  const { createClient } = await import('../supabase/server.ts')
  const supabase = await createClient()

  return consultarMiFila(supabase, periodo, inicioPeriodo(periodo), userId)
}
