// ============================================================================
// B00 · integración · la foto del ranking (B06) y el rollup del panel (B19).
//
// Los dos estaban escritos, probados y sin disparar. El síntoma de que falten
// es el mismo en los dos casos y es el peor de todos: no falla nada. El
// tablero enseña la foto de la semana pasada y el panel enseña las métricas del
// día que alguien recalculó a mano, y nadie ve un error en ninguna parte.
// ============================================================================

import { construirSnapshot } from '../../ranking/construirSnapshot.ts'
import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/**
 * Reconstruye los tres cortes del ranking.
 *
 * EL ORDEN ES POR VOLATILIDAD, no por tamaño: la semana es la que más cambia y
 * la que se mira en la portada, así que si el presupuesto se agota lo que queda
 * a medias es el histórico. Es el mismo criterio (y el mismo código) que
 * `POST /api/ranking/snapshot`, que sigue existiendo para reconstruir un corte
 * pasado a mano tras un incidente.
 *
 * El reparto del presupuesto sigue esa prioridad: la mitad para la semana, y el
 * resto a partes iguales. `construirSnapshot` es idempotente sobre un corte
 * (rehacerlo deja las mismas filas salvo `built_at`), así que un reintento del
 * cron no duplica nada.
 */
export async function ejecutarRankingSnapshot(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const mitad = Math.floor(ctx.presupuestoMs / 2)
  const cuarto = Math.floor(ctx.presupuestoMs / 4)

  const semana = await construirSnapshot(ctx.admin, { periodo: 'semana', presupuestoMs: mitad })
  const mes = await construirSnapshot(ctx.admin, { periodo: 'mes', presupuestoMs: cuarto })
  const historico = await construirSnapshot(ctx.admin, {
    periodo: 'historico',
    presupuestoMs: cuarto,
  })

  const completado = semana.completado && mes.completado && historico.completado

  return {
    estado: completado ? 'ok' : 'parcial',
    detalle: {
      corte: semana.corte,
      filas: semana.filas + mes.filas + historico.filas,
      semana_completa: semana.completado,
      mes_completo: mes.completado,
      historico_completo: historico.completado,
    },
  }
}

/**
 * Recalcula el rollup de métricas del panel.
 *
 * ── POR QUÉ SOLO EL DÍA DE HOY, Y NUNCA UN DÍA PASADO ─────────────────────
 * `admin_rollup_dia()` hace upsert sobre `admin_metrics_daily`, así que rehacer
 * un día PISA lo que había. Y dos de sus métricas —`usuarios_activos` y
 * `usuarios_en_tope`— salen de `profiles.daily_karma_earned`, que se reinicia
 * cada día: recalcular el martes el rollup del lunes no devuelve los valores
 * del lunes, devuelve CEROS, y los escribe encima de los buenos. La limitación
 * está documentada en la cabecera de `0191_1_b19_admin.sql`; la consecuencia
 * operativa —«el rollup se ejecuta el mismo día que mide, tarde, y jamás hacia
 * atrás»— es esta función.
 *
 * De ahí que este trabajo viva en el despachador HORARIO y solo en las últimas
 * horas del día UTC (ver `plan.ts`): a las 22 y a las 23 el día ya está casi
 * entero y todavía se puede medir.
 */
export async function ejecutarRollupMetricas(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const dia = new Date().toISOString().slice(0, 10)
  const { error } = await ctx.admin.rpc('admin_rollup_dia', { p_dia: dia })
  if (error) throw new Error(error.message)
  return { estado: 'ok', detalle: { dia } }
}

export const TRABAJO_RANKING_SNAPSHOT: Trabajo = {
  id: 'ranking-snapshot',
  presupuestoMs: 5_000,
  minimoMs: 1_500,
  ejecutar: ejecutarRankingSnapshot,
}

/**
 * El mismo trabajo con el presupuesto del despachador horario, donde solo
 * compite con el rollup en lugar de con los siete trabajos del día.
 */
export const TRABAJO_RANKING_SNAPSHOT_AMPLIO: Trabajo = {
  ...TRABAJO_RANKING_SNAPSHOT,
  presupuestoMs: 34_000,
  minimoMs: 2_000,
}

export const TRABAJO_ROLLUP_METRICAS: Trabajo = {
  id: 'metricas-rollup',
  presupuestoMs: 14_000,
  // Es la operación más cara del panel: arrancarla con dos segundos solo
  // consigue que muera a medias y no deje nada escrito.
  minimoMs: 3_000,
  ejecutar: ejecutarRollupMetricas,
}
