// ============================================================================
// B00 · integración · los dos trabajos que quedaron sin programar.
//
// Ambos estaban escritos y probados por sus bloques, y ninguno se ejecutaba
// nunca porque nadie los enganchó a un disparador. Es el mismo patrón que dejó
// `/ayuda` sin escribir: la pieza que une dos bloques no es de ninguno.
//
//  · `reponer-encuestas` — sin él, el banco se agota y el feed se queda sin
//    encuestas de forma silenciosa: nada falla, simplemente deja de aparecer
//    una de las tres cosas que el feed intercala.
//  · `push-diferido` — sin él, lo que se acumula durante las horas de silencio
//    NO se entrega nunca. Y esto es peor de lo que parece: la política
//    antiadicción difiere en vez de descartar precisamente para no perder el
//    aviso de que alguien te escuchó. Sin la entrega, «diferir» es «tirar».
// ============================================================================

import { reponerBanco } from '../../polls/reponer.ts'
import { construirCarga } from '../../push/plantillas.ts'
import { enviarAVarias } from '../../push/enviar.ts'
import { pushConfigurado } from '../../push/vapid.ts'
import type { Suscripcion } from '../../push/tipos.ts'
import type { TipoNotificacion } from '../../push/preferencias.ts'
import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

// ── Reposición del banco de encuestas ───────────────────────────────────────

export async function ejecutarReponerEncuestas(_ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const { activadas, cerradas } = await reponerBanco()
  return { estado: 'ok', detalle: { activadas, cerradas } }
}

export const TRABAJO_REPONER_ENCUESTAS: Trabajo = {
  id: 'reponer-encuestas',
  presupuestoMs: 4_000,
  minimoMs: 800,
  ejecutar: ejecutarReponerEncuestas,
}

// ── Entrega de las notificaciones diferidas ─────────────────────────────────

/** Cuántas filas se atienden por disparo. Acotado para no desbordar el reloj. */
const LOTE_DIFERIDO = 500

export async function ejecutarPushDiferido(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  // Sin claves VAPID no hay nada que entregar, y vaciar el backlog sería PEOR
  // que no hacer nada: se perdería el aviso sin haberlo enviado. Se sale sin
  // tocar una fila.
  if (!pushConfigurado()) return { estado: 'ok', detalle: { entregados: 0, sinVapid: true } }

  const ahora = new Date().toISOString()

  const { data, error } = await ctx.admin
    .from('push_dispatch_state')
    .select('user_id, tipo, pendientes, diferido_hasta')
    .gt('pendientes', 0)
    .lte('diferido_hasta', ahora)
    .order('diferido_hasta', { ascending: true })
    .limit(LOTE_DIFERIDO)

  if (error) throw new Error(error.message)
  const filas = data ?? []
  if (filas.length === 0) return { estado: 'ok', detalle: { entregados: 0 } }

  let entregados = 0
  let fallidos = 0

  for (const fila of filas) {
    // Un fallo de una persona no puede llevarse por delante la entrega de las
    // demás: cada una va en su propio try. Lo contrario haría que un endpoint
    // caducado bloqueara el backlog entero.
    try {
      const carga = construirCarga({
        tipo: fila.tipo as TipoNotificacion,
        // `null` SIEMPRE: un aviso agrupado y entregado horas después no puede
        // nombrar a nadie. Aunque esa persona revele su alias, aquí se resumen
        // varios eventos y el aviso aparece en una pantalla de bloqueo que puede
        // estar mirando cualquiera.
        aliasEmisor: null,
        // El agregado es lo que convierte «3 avisos» en «3 personas te
        // escucharon», que es la razón de diferir en vez de descartar.
        agregados: fila.pendientes,
        url: '/feed',
      })

      const { data: subs } = await ctx.admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', fila.user_id)

      await enviarAVarias((subs ?? []) as Suscripcion[], carga)

      // El contador se limpia DESPUÉS de entregar. Al revés, un fallo de red
      // dejaría a la persona sin el aviso y sin rastro de que lo tenía pendiente.
      await ctx.admin
        .from('push_dispatch_state')
        .update({ pendientes: 0, diferido_hasta: null, last_sent_at: ahora })
        .eq('user_id', fila.user_id)
        .eq('tipo', fila.tipo)

      entregados += 1
    } catch {
      // Se deja `pendientes` como está: mañana se reintenta. No se escribe el
      // detalle del error porque llevaría dentro el endpoint de push, que es
      // una capability URL.
      fallidos += 1
    }
  }

  return {
    // Lote lleno ⇒ es probable que quede backlog; el siguiente disparo sigue.
    estado: filas.length >= LOTE_DIFERIDO ? 'parcial' : 'ok',
    detalle: { entregados, fallidos, revisados: filas.length },
  }
}

export const TRABAJO_PUSH_DIFERIDO: Trabajo = {
  id: 'push-diferido',
  presupuestoMs: 8_000,
  minimoMs: 1_000,
  ejecutar: ejecutarPushDiferido,
}
