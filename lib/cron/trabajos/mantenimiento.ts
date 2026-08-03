// ============================================================================
// B00 · integración · retención del propio registro de crons.
//
// El despachador escribe una fila por trabajo y por disparo. A ocho trabajos
// diarios más dos por hora, son unas 8 000 filas al año — poco, pero una tabla
// que solo crece acaba siendo la que llena el plan gratuito de 500 MB mientras
// nadie mira. La misma lógica que aplicamos a `content_views` se aplica aquí.
//
// Va EL ÚLTIMO de la lista diaria a propósito: es lo único que puede quedarse
// sin correr un día sin que le importe a nadie.
// ============================================================================

import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/** Días de retención del registro operativo. Ver 0210 para el porqué de 90. */
export const DIAS_RETENCION_CRON = 90

export async function ejecutarPurgaRegistro(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const { data, error } = await ctx.admin.rpc('purgar_cron_runs', {
    p_dias: DIAS_RETENCION_CRON,
    p_lote: 2_000,
  })
  if (error) throw new Error(error.message)
  const borradas = Number(data ?? 0)
  return {
    // Lote lleno ⇒ seguro queda más; el disparo de mañana sigue.
    estado: borradas >= 2_000 ? 'parcial' : 'ok',
    detalle: { borradas },
  }
}

export const TRABAJO_PURGA_REGISTRO: Trabajo = {
  id: 'purga-registro-cron',
  presupuestoMs: 2_000,
  minimoMs: 500,
  ejecutar: ejecutarPurgaRegistro,
}
