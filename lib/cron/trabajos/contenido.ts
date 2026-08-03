// ============================================================================
// B00 · integración · los tres trabajos de ingesta de contenido (B08).
//
// Las rutas `/api/cron/content/{videos,articulos,reverificar}` ya existían y ya
// estaban probadas; lo que faltaba era que alguien las disparara. Aquí NO se
// las llama por HTTP: se invoca `ejecutarIngesta()`, que es exactamente lo que
// hace cada una de esas rutas tras comprobar su Bearer.
//
// POR QUÉ NO POR HTTP: un `fetch` a nuestro propio dominio desde dentro de una
// función de Vercel gasta una invocación más, obliga a conocer la URL del
// despliegue (que cambia en cada preview), añade el round-trip a la red y
// convierte un fallo de DNS en un fallo de la ingesta. La ruta y este trabajo
// comparten la misma función y no pueden divergir.
//
// LAS TRES RUTAS SIGUEN EXISTIENDO y siguen siendo válidas: son la vía de
// disparo manual tras un incidente, y `vercel.json` podría apuntarles un cron
// directo el día que el plan deje de estar limitado a dos.
// ============================================================================

import { ejecutarIngesta, type TipoEjecucion } from '../../ingest/ejecutar.ts'
import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/**
 * `ejecutarIngesta` ya lleva su propio presupuesto de reloj y su propio cursor
 * en `ingest_state`: se le pasa el del despachador y él decide cuándo guardar y
 * salir. Reanudable por construcción — de ahí que baste con propagar el número.
 */
function trabajoIngesta(id: string, tipo: TipoEjecucion, presupuestoMs: number): Trabajo {
  return {
    id,
    presupuestoMs,
    minimoMs: 1_500,
    ejecutar: async (ctx: ContextoTrabajo): Promise<ResultadoTrabajo> => {
      const r = await ejecutarIngesta({ tipo, presupuestoMs: ctx.presupuestoMs })
      return {
        estado: r.completado ? 'ok' : 'parcial',
        detalle: {
          fuentes: r.fuentesVistas,
          insertados: r.insertados,
          duplicados: r.duplicados,
          pendientes: r.pendientes,
          rechazados_seguridad: r.rechazados.seguridad,
          rechazados_embed: r.rechazados.embed,
          rechazados_calidad: r.rechazados.calidad,
          errores: r.errores,
        },
      }
    },
  }
}

// El barrido de salud va ANTES que las dos ingestas: retirar un vídeo que se ha
// vuelto un recuadro negro le importa más a quien abre el feed a las tres de la
// mañana que añadir tres vídeos nuevos. Y es el más barato de los tres.
export const TRABAJO_CONTENIDO_REVERIFICAR = trabajoIngesta(
  'contenido-reverificar',
  'reverificar',
  6_000,
)

export const TRABAJO_CONTENIDO_VIDEOS = trabajoIngesta('contenido-videos', 'videos', 6_000)

export const TRABAJO_CONTENIDO_ARTICULOS = trabajoIngesta(
  'contenido-articulos',
  'articulos',
  6_000,
)
