// ============================================================================
// B00 · integración · EL DESPACHADOR.
//
// ── EL PROBLEMA ────────────────────────────────────────────────────────────
// El plan Hobby de Vercel permite DOS crons y hay ocho trabajos que ejecutar.
// La salida no es «elegir los dos más importantes y abandonar los otros seis»:
// es un despachador — una ruta que corre la lista del día EN ORDEN, con
// presupuesto de reloj por trabajo, y que aísla los fallos.
//
// ── LAS TRES PROPIEDADES QUE NO SE NEGOCIAN ────────────────────────────────
//
//  1. UN FALLO NO BLOQUEA A LOS DEMÁS. Cada trabajo corre dentro de su propio
//     `try`. Que la ingesta de vídeo reviente porque YouTube devolvió un HTML
//     de error NO puede impedir que corra un borrado de datos personales con
//     plazo legal. Este es el requisito que da forma a todo el archivo: la
//     alternativa evidente —un `for` sin `try`, o un `Promise.all`— convierte
//     cualquier avería de un proveedor externo en un incumplimiento del RGPD.
//
//  2. EL ORDEN ES LA PRIORIDAD. La lista se recorre secuencialmente, no en
//     paralelo, y lo que tiene plazo legal va primero. En paralelo los ocho
//     trabajos competirían por el mismo minuto de función y por las mismas
//     conexiones de Postgres, y el que se quedaría a medias sería el que
//     tuviera peor suerte, no el menos importante.
//
//  3. NADA CORRE EN SILENCIO. Cada trabajo devuelve su fila, incluido el que no
//     llegó a arrancar (`sin_tiempo`) y el que lanzó (`error`). El registro lo
//     persiste quien llama (`lib/cron/registro.ts`), trabajo a trabajo y no al
//     final: si la función muere a los 60 s, lo ya corrido ya está escrito.
//
// ── QUÉ PASA AL AGOTARSE EL PRESUPUESTO DE LA FUNCIÓN ──────────────────────
// El techo real es `maxDuration = 60` de Vercel. El presupuesto global de este
// módulo es de 52 s y los 8 s restantes son el margen para escribir el último
// registro, soltar el arrendamiento y devolver el JSON. Dentro de esos 52 s:
//
//   · Antes de cada trabajo se calcula lo que QUEDA. Si queda menos que su
//     `minimoMs`, el trabajo NO arranca y se registra `sin_tiempo`.
//   · Si queda más, su presupuesto es `min(presupuestoMs, restante − reserva)`.
//     Un trabajo que se pasa de su presupuesto no puede robarle el suyo al
//     siguiente por accidente: se lo roba porque lo tenía asignado.
//   · Todo trabajo largo es REANUDABLE (cursor en Postgres) y sale `parcial`.
//     Lo que no cupo hoy se hace en el disparo siguiente, no se pierde.
//
// Consecuencia deliberada: en un día en que el borrado RGPD se coma el
// presupuesto entero, la ingesta de contenido sale `sin_tiempo` y el feed no se
// refresca ese día. Es la dirección correcta del sacrificio, y queda escrito en
// `cron_runs` para que se vea, en vez de deducirse de que el feed está viejo.
//
// ── POR QUÉ EL DESPACHADOR NO IMPORTA NINGÚN TRABAJO ───────────────────────
// Recibe la lista ya construida. Así estas reglas —el reparto, el aislamiento,
// el mínimo— se prueban con trabajos de mentira, sin Postgres, sin red y sin
// esperar 52 s de reloj real.
// ============================================================================

import type {
  Detalle,
  EjecucionTrabajo,
  ResultadoDespacho,
  Trabajo,
} from './tipos.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Presupuesto global de un disparo. `maxDuration` es 60 s (el techo del plan
 * Hobby); estos 52 s dejan 8 s de margen para el cierre.
 */
export const PRESUPUESTO_DESPACHO_MS = 52_000

/**
 * Reserva por trabajo. Ningún trabajo recibe TODO lo que queda: siempre se le
 * descuenta esto para que quede sitio a escribir su propia fila de `cron_runs`.
 * Un registro que no se puede escribir porque el trabajo consumió hasta el
 * último milisegundo es un trabajo que corrió sin dejar rastro.
 */
export const RESERVA_REGISTRO_MS = 1_500

export interface OpcionesDespacho {
  admin: SupabaseClient
  presupuestoMs?: number
  ahora?: () => number
  /**
   * Se invoca tras CADA trabajo, con su fila ya cerrada. Es el gancho del
   * registro incremental. NUNCA debe lanzar: si lanzara, un fallo al auditar
   * tumbaría el despacho entero, que es exactamente lo contrario de lo que la
   * auditoría existe para conseguir. Se envuelve igualmente aquí abajo.
   */
  alTerminarTrabajo?: (fila: EjecucionTrabajo) => Promise<void>
}

/** Motivo de un fallo, sin filtrar nada del proveedor. */
function motivoDe(causa: unknown): Detalle {
  if (causa instanceof Error) {
    return {
      motivo: causa.name,
      // El mensaje SÍ se guarda, pero solo aquí: `cron_runs` tiene RLS sin
      // políticas (solo `service_role`) y nunca viaja al cliente. Sin él,
      // «rgpd-borrados falló» no es depurable. Recortado por si el proveedor
      // devuelve media página de SQL.
      mensaje: causa.message.slice(0, 200),
    }
  }
  return { motivo: 'desconocido', mensaje: null }
}

/**
 * Corre la lista en orden. NUNCA lanza: un despachador que lanza es un
 * despachador que deja los trabajos siguientes sin ejecutar.
 *
 * @param despacho nombre del disparo ('diario', 'frecuente'…). Va al registro.
 * @param trabajos la lista, YA en orden de prioridad.
 */
export async function despachar(
  despacho: string,
  trabajos: readonly Trabajo[],
  opciones: OpcionesDespacho,
): Promise<ResultadoDespacho> {
  const ahora = opciones.ahora ?? Date.now
  const presupuestoGlobal = opciones.presupuestoMs ?? PRESUPUESTO_DESPACHO_MS
  const arranque = ahora()
  const iniciadoEn = new Date().toISOString()

  const filas: EjecucionTrabajo[] = []

  for (const trabajo of trabajos) {
    const restante = presupuestoGlobal - (ahora() - arranque)
    const inicioTrabajo = ahora()

    let fila: EjecucionTrabajo

    if (restante < trabajo.minimoMs) {
      // No arranca. Se registra igual — este es el estado que convierte «el
      // feed lleva tres días congelado» en una fila que alguien puede consultar.
      fila = {
        trabajo: trabajo.id,
        estado: 'sin_tiempo',
        ms: 0,
        detalle: { restante_ms: Math.max(0, Math.round(restante)), minimo_ms: trabajo.minimoMs },
      }
    } else {
      // El techo del trabajo es el menor de: lo suyo, y lo que queda menos la
      // reserva para poder registrar el resultado.
      const presupuestoMs = Math.max(
        trabajo.minimoMs,
        Math.min(trabajo.presupuestoMs, restante - RESERVA_REGISTRO_MS),
      )
      const limite = inicioTrabajo + presupuestoMs

      try {
        const r = await trabajo.ejecutar({
          admin: opciones.admin,
          presupuestoMs,
          ahora,
          agotado: () => ahora() >= limite,
        })
        fila = {
          trabajo: trabajo.id,
          estado: r.estado,
          ms: Math.max(0, Math.round(ahora() - inicioTrabajo)),
          detalle: r.detalle,
        }
      } catch (causa) {
        // ── EL `catch` QUE JUSTIFICA EL ARCHIVO ────────────────────────────
        // Se traga el fallo A PROPÓSITO y sigue con el trabajo siguiente. Un
        // fallo de la ingesta no puede bloquear un borrado con plazo legal.
        fila = {
          trabajo: trabajo.id,
          estado: 'error',
          ms: Math.max(0, Math.round(ahora() - inicioTrabajo)),
          detalle: motivoDe(causa),
        }
        console.error('[darma][cron] trabajo fallido', {
          despacho,
          trabajo: trabajo.id,
          motivo: fila.detalle.motivo,
        })
      }
    }

    filas.push(fila)

    if (opciones.alTerminarTrabajo) {
      try {
        await opciones.alTerminarTrabajo(fila)
      } catch (causa) {
        // Que no se pueda auditar no puede impedir que corra lo que falta.
        console.error('[darma][cron] no se pudo registrar la ejecución', {
          despacho,
          trabajo: trabajo.id,
          motivo: causa instanceof Error ? causa.name : 'desconocido',
        })
      }
    }
  }

  return {
    despacho,
    iniciadoEn,
    msTotales: Math.max(0, Math.round(ahora() - arranque)),
    trabajos: filas,
    todoOk: filas.every((f) => f.estado === 'ok' || f.estado === 'parcial'),
  }
}
