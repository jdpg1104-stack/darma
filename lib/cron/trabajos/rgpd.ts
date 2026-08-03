// ============================================================================
// B00 · integración · los dos trabajos con plazo legal.
//
// Van LOS PRIMEROS de la lista diaria y no es una preferencia de estilo: el
// art. 12.3 del RGPD da un mes para atender la solicitud, `borrados_vencidos()`
// ya solo devuelve las que llevan 30 días confirmadas, y `purgar_retencion()`
// es lo que hace verdad los plazos que `/legal/retencion` promete por escrito.
// Todo lo demás de la lista —el ranking, las métricas, el feed— puede esperar
// veinticuatro horas sin que nadie incumpla nada.
//
// Las dos piezas de Postgres ya existían y no las llamaba nadie
// (`0201_1_b20_privacidad.sql`). Este archivo es solo el brazo.
// ============================================================================

import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/** Cuántas cuentas se piden por pasada. `borrados_vencidos` tope a 500. */
export const LOTE_BORRADOS = 50

/** Filas por lote de purga. Igual que el defecto de `purgar_retencion`. */
export const LOTE_RETENCION = 1_000

/** Tablas que `purgar_retencion()` devuelve en su jsonb. */
const TABLAS_PURGA = [
  'content_views',
  'rate_limits',
  'refuge_messages',
  'moderation_flags',
  'crisis_events',
] as const

interface FilaVencida {
  user_id: string
  solicitud_id: string
}

/**
 * Ejecuta los borrados confirmados cuyos 30 días ya pasaron.
 *
 * ── POR QUÉ NO SE MARCA `processing` ANTES DE BORRAR ──────────────────────
 * Sería el patrón habitual, y aquí es una trampa: si la función muere entre el
 * `processing` y el `done` —y muere, porque `maxDuration` son 60 s—, la fila
 * queda fuera de `borrados_vencidos()` (que solo mira `confirmed`) y ese
 * borrado no se vuelve a intentar JAMÁS. Un plazo legal incumplido en silencio.
 * Como `borrar_usuario()` es idempotente por diseño (devuelve el estado final,
 * no las filas tocadas), es estrictamente mejor dejar la fila en `confirmed`
 * hasta que el borrado haya terminado de verdad: en el peor caso se reintenta
 * un borrado ya hecho, que no cuesta nada y no cambia nada.
 *
 * ── POR QUÉ UN FALLO NO MARCA `failed` ────────────────────────────────────
 * `failed` saca la fila de la cola para siempre. El error se anota en la
 * columna `error` y el estado se queda en `confirmed`: mañana se reintenta.
 * Una solicitud de borrado no se «da por perdida» sin que un humano lo decida.
 *
 * ── POR QUÉ EL BUCLE NO SE PARA EN EL PRIMER FALLO ────────────────────────
 * Que el borrado de una persona choque con un dato raro no puede retrasar el de
 * las otras cuarenta y nueve. Mismo principio que el despachador, un nivel más
 * abajo.
 */
export async function ejecutarBorradosRgpd(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const { data, error } = await ctx.admin.rpc('borrados_vencidos', { p_limite: LOTE_BORRADOS })
  if (error) throw new Error(error.message)

  const cola = (data ?? []) as FilaVencida[]

  let borrados = 0
  let fallidos = 0
  let pendientes = cola.length

  for (const fila of cola) {
    if (ctx.agotado()) break
    pendientes -= 1

    const { error: errorBorrado } = await ctx.admin.rpc('borrar_usuario', { p_user: fila.user_id })

    if (errorBorrado) {
      fallidos += 1
      // El detalle del error SÍ se guarda en `privacy_requests.error`: esa tabla
      // tiene RLS sin políticas y su contenido no sale nunca por una API.
      await ctx.admin
        .from('privacy_requests')
        .update({ error: errorBorrado.message.slice(0, 500) })
        .eq('id', fila.solicitud_id)
      console.error('[darma][cron] borrado RGPD fallido', { motivo: 'rpc' })
      continue
    }

    // `eq('state', 'confirmed')` para no pisar una cancelación que entrara
    // entre medias: la transición la gana quien llegue primero, y si ya no está
    // en `confirmed` es que otro disparo la cerró.
    const { error: errorCierre } = await ctx.admin
      .from('privacy_requests')
      .update({ state: 'done', completed_at: new Date().toISOString(), error: null })
      .eq('id', fila.solicitud_id)
      .eq('state', 'confirmed')

    if (errorCierre) {
      // El borrado YA se hizo; solo falló el cierre administrativo. Mañana
      // `borrados_vencidos()` la devolverá otra vez y `borrar_usuario()`
      // devolverá `ya_estaba_borrado: true` sin tocar nada. Por eso esto no
      // cuenta como borrado fallido.
      fallidos += 1
      console.error('[darma][cron] borrado hecho pero solicitud sin cerrar', { motivo: 'update' })
      continue
    }

    borrados += 1
  }

  return {
    // `parcial` si quedaron filas del lote sin tocar O si el lote vino lleno
    // (puede haber más cola detrás del `limit`).
    estado: pendientes > 0 || cola.length === LOTE_BORRADOS ? 'parcial' : 'ok',
    // Conteos, nunca uuids: la lista de quién se fue no se escribe en un
    // registro de operación (ver la cabecera de 0210).
    detalle: { en_cola: cola.length, borrados, fallidos, sin_tocar: Math.max(0, pendientes) },
  }
}

/**
 * Purga de retención por lotes acotados.
 *
 * Encadena pasadas mientras algo se borre y quede presupuesto. Una sola pasada
 * de 1 000 filas no vacía un backlog de meses, y un `delete` sin `limit` sobre
 * `content_views` bloquea la tabla y tumba la app — que es justo por lo que
 * `purgar_retencion()` está escrita con `where ctid in (… limit N)`.
 */
export async function ejecutarRetencionRgpd(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const totales: Record<string, number> = Object.fromEntries(TABLAS_PURGA.map((t) => [t, 0]))
  let pasadas = 0
  let quedaCola = false

  while (!ctx.agotado()) {
    const { data, error } = await ctx.admin.rpc('purgar_retencion', { p_lote: LOTE_RETENCION })
    if (error) throw new Error(error.message)

    pasadas += 1
    const lote = (data ?? {}) as Record<string, number>
    let borradasEnLaPasada = 0

    for (const tabla of TABLAS_PURGA) {
      const n = Number(lote[tabla] ?? 0)
      totales[tabla] += n
      borradasEnLaPasada += n
    }

    // Ninguna tabla tenía nada más que borrar: no queda cola, se sale.
    if (borradasEnLaPasada === 0) break

    // Un lote lleno en cualquier tabla significa que seguro queda más.
    quedaCola = TABLAS_PURGA.some((t) => Number(lote[t] ?? 0) >= LOTE_RETENCION)
  }

  return {
    estado: quedaCola ? 'parcial' : 'ok',
    detalle: { pasadas, ...totales },
  }
}

export const TRABAJO_RGPD_BORRADOS: Trabajo = {
  id: 'rgpd-borrados',
  presupuestoMs: 12_000,
  minimoMs: 2_000,
  ejecutar: ejecutarBorradosRgpd,
}

export const TRABAJO_RGPD_RETENCION: Trabajo = {
  id: 'rgpd-retencion',
  presupuestoMs: 7_000,
  minimoMs: 1_500,
  ejecutar: ejecutarRetencionRgpd,
}
