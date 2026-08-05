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
// (`0201_1_b20_privacidad.sql`). Este archivo es solo el brazo. Desde
// `0215_1_b00_circulos_privacidad.sql` el trabajo de retención barre además
// las solicitudes `pending_confirm` cuyo token caducó — mismo brazo, misma
// razón: una función de Postgres sin nadie que la llame es un plazo que no se
// cumple.
// ============================================================================

import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/** Cuántas cuentas se piden por pasada. `borrados_vencidos` tope a 500. */
export const LOTE_BORRADOS = 50

/** Filas por lote de purga. Igual que el defecto de `purgar_retencion`. */
export const LOTE_RETENCION = 1_000

/** Solicitudes caducadas por lote. Igual que el defecto de
 *  `barrer_solicitudes_caducadas` (0215; tope duro de 500 en la función). */
export const LOTE_CADUCADAS = 200

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
 * Purga de retención por lotes acotados, precedida por el barrido de
 * solicitudes `pending_confirm` caducadas.
 *
 * ── POR QUÉ EL BARRIDO VIVE EN ESTE TRABAJO Y NO EN UNO NUEVO ─────────────
 * Un trabajo nuevo exigiría su hueco en el reparto de `plan.ts`, cuya suma
 * cierra justa en 52 s, para una operación que en el día normal toca cero o
 * una fila (la tabla tiene una fila por solicitud de privacidad, no por post).
 * Es higiene del mismo dominio que la purga —hacer verdad los plazos escritos—
 * y va ANTES de ella porque es diminuta y acotada: si el presupuesto muere en
 * la purga, el panel de privacidad ya quedó sin madera muerta.
 *
 * Encadena pasadas mientras algo se borre y quede presupuesto. Una sola pasada
 * de 1 000 filas no vacía un backlog de meses, y un `delete` sin `limit` sobre
 * `content_views` bloquea la tabla y tumba la app — que es justo por lo que
 * `purgar_retencion()` está escrita con `where ctid in (… limit N)`.
 */
export async function ejecutarRetencionRgpd(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  // ── Barrido de `pending_confirm` caducadas (0215) ─────────────────────────
  // Idempotente y por lotes: un lote lleno significa que seguro queda más.
  let caducadas = 0
  let quedanCaducadas = false

  while (!ctx.agotado()) {
    const { data, error } = await ctx.admin.rpc('barrer_solicitudes_caducadas', {
      p_limite: LOTE_CADUCADAS,
    })
    if (error) throw new Error(error.message)

    const n = Number(data ?? 0)
    caducadas += n
    quedanCaducadas = n >= LOTE_CADUCADAS
    if (!quedanCaducadas) break
  }

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
    estado: quedaCola || quedanCaducadas ? 'parcial' : 'ok',
    // `solicitudes_caducadas` es un CONTEO, nunca ids: misma regla que arriba.
    detalle: { pasadas, solicitudes_caducadas: caducadas, ...totales },
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
