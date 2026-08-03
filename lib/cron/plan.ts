// ============================================================================
// B00 · integración · EL REPARTO DE TRABAJOS.
//
// ── LA RESTRICCIÓN ─────────────────────────────────────────────────────────
// El plan Hobby de Vercel permite DOS entradas en `vercel.json`. La lista real
// de trabajos que hay que ejecutar es de ocho. Las dos entradas no apuntan a
// dos trabajos: apuntan a dos DESPACHADORES, cada uno con su lista.
//
//   1. `/api/cron/diario`     → la lista completa del día, en orden de
//                               prioridad, encabezada por lo que tiene plazo
//                               legal.
//   2. `/api/cron/frecuente`  → lo volátil: la foto del ranking, y el rollup de
//                               métricas en las últimas horas del día UTC.
//
// ── POR QUÉ EL RANKING ESTÁ EN LAS DOS LISTAS ──────────────────────────────
// No es un descuido y no duplica trabajo de forma peligrosa: `construirSnapshot`
// es idempotente sobre un corte. Está en la diaria como RED DE SEGURIDAD. El
// plan Hobby, además del tope de dos crons, restringe la frecuencia real de
// disparo; si el despachador horario acabara disparándose una vez al día o
// dejara de dispararse, el tablero seguiría refrescándose desde la lista
// diaria en vez de congelarse en silencio, que es el fallo que este trabajo
// existe para evitar. Cuesta 5 s de una función que ya está caliente.
//
// ── EL ORDEN DE LA LISTA DIARIA, Y POR QUÉ ES ESE ──────────────────────────
//
//   1. rgpd-borrados        12 s  · PLAZO LEGAL (art. 12.3: un mes). Va primero
//                                   porque es lo único de esta lista cuyo
//                                   retraso es un incumplimiento, no una
//                                   molestia.
//   2. rgpd-retencion        7 s  · PLAZO LEGAL. `/legal/retencion` promete
//                                   plazos por escrito; sin esto son mentira.
//   3. moderacion-pendiente  8 s  · Karma y reciprocidad que alguien ganó y no
//                                   cobró. Es deuda con una persona concreta,
//                                   así que va por delante del contenido.
//   4. contenido-reverificar 6 s  · Retirar lo que se ha roto. Antes que añadir
//                                   nada nuevo: un recuadro negro en el feed de
//                                   madrugada es peor que un feed corto.
//   5. contenido-videos      6 s  · Alimenta el feed.
//   6. contenido-articulos   6 s  · Ídem.
//   7. ranking-snapshot      5 s  · Red de seguridad del tablero.
//   8. purga-registro-cron   2 s  · Higiene. Lo único que puede saltarse un día
//                                   sin que le importe a nadie.
//                          ─────
//                            52 s = el presupuesto global. `maxDuration` es 60,
//                                   y esos 8 s de margen son para escribir el
//                                   último registro, soltar el arrendamiento y
//                                   devolver el JSON.
//
// ── QUÉ PASA AL AGOTARSE EL PRESUPUESTO ────────────────────────────────────
// La suma nominal cabe justa en el presupuesto, así que en un día normal corren
// los ocho. En un día en que los primeros se pasen —un backlog de borrados, una
// purga de meses—, el despachador va restando: cuando lo que queda no llega al
// `minimoMs` del trabajo siguiente, ese trabajo NO arranca y se registra
// `sin_tiempo` en `cron_runs`. El sacrificio cae siempre por el final de la
// lista, que es donde debe caer, y queda escrito en vez de deducirse de que el
// feed está viejo. Todo lo largo es reanudable: lo que no cupo hoy sale
// `parcial` con su cursor guardado y continúa mañana.
//
// ── LO QUE ESTE REPARTO NO CUBRE (y hay que pedir) ─────────────────────────
// `/api/polls/reponer` (B09) y la entrega de notificaciones diferidas (B13)
// también piden cron en PEDIDOS.md. Encajan en la lista diaria en cuanto sus
// bloques expongan una función invocable en proceso; hoy no se han añadido
// porque tocarlas exigiría entrar en directorios que no son de este bloque.
// ============================================================================

import type { Trabajo } from './tipos.ts'
import { TRABAJO_RGPD_BORRADOS, TRABAJO_RGPD_RETENCION } from './trabajos/rgpd.ts'
import { TRABAJO_MODERACION_PENDIENTE } from './trabajos/moderacionPendiente.ts'
import {
  TRABAJO_CONTENIDO_ARTICULOS,
  TRABAJO_CONTENIDO_REVERIFICAR,
  TRABAJO_CONTENIDO_VIDEOS,
} from './trabajos/contenido.ts'
import {
  TRABAJO_RANKING_SNAPSHOT,
  TRABAJO_RANKING_SNAPSHOT_AMPLIO,
  TRABAJO_ROLLUP_METRICAS,
} from './trabajos/tablero.ts'
import { TRABAJO_PURGA_REGISTRO } from './trabajos/mantenimiento.ts'
import { TRABAJO_PUSH_DIFERIDO, TRABAJO_REPONER_ENCUESTAS } from './trabajos/comunidad.ts'

/** La lista diaria, EN ORDEN. Lo de plazo legal primero. */
export const PLAN_DIARIO: readonly Trabajo[] = [
  // Los presupuestos se fijan AQUÍ y no en cada trabajo porque el reparto es una
  // propiedad de la lista, no de sus piezas: al entrar `push-diferido` y
  // `reponer-encuestas` la suma se pasó de 52 s, y el test que lo vigila hizo
  // exactamente su trabajo. Si no cupiera, los últimos saldrían `sin_tiempo`
  // TODOS los días en vez de solo los malos, y el orden sería una ficción.
  //
  // Suma exacta: 10+6+7+5+5+5+5+2+5+2 = 52 s.
  //
  // Lo que se recorta y por qué: los tres de contenido son reanudables por
  // cursor, así que quedarse cortos les cuesta un día de retraso, no una pérdida.
  // Lo de plazo legal (RGPD) es lo único que NO se recorta por debajo de lo que
  // necesita para vaciar su cola en un disparo normal.
  { ...TRABAJO_RGPD_BORRADOS, presupuestoMs: 10_000 },
  { ...TRABAJO_RGPD_RETENCION, presupuestoMs: 6_000 },
  { ...TRABAJO_MODERACION_PENDIENTE, presupuestoMs: 7_000 },
  // Pronto y no al final: lo que se difirió anoche por las horas de silencio es
  // el aviso de que alguien te escuchó, y entregarlo pasado mañana es no
  // entregarlo. Además no depende de ningún servicio externo, así que su tiempo
  // es predecible.
  { ...TRABAJO_PUSH_DIFERIDO, presupuestoMs: 5_000 },
  { ...TRABAJO_CONTENIDO_REVERIFICAR, presupuestoMs: 5_000 },
  { ...TRABAJO_CONTENIDO_VIDEOS, presupuestoMs: 5_000 },
  { ...TRABAJO_CONTENIDO_ARTICULOS, presupuestoMs: 5_000 },
  // Detrás del contenido: el banco de encuestas se agota en días, no en horas,
  // así que perder un disparo no se nota. La ingesta trae lo que se ve mañana.
  { ...TRABAJO_REPONER_ENCUESTAS, presupuestoMs: 2_000 },
  { ...TRABAJO_RANKING_SNAPSHOT, presupuestoMs: 5_000 },
  { ...TRABAJO_PURGA_REGISTRO, presupuestoMs: 2_000 },
]

/**
 * Horas UTC en las que el despachador frecuente añade el rollup de métricas.
 *
 * Dos horas y no una: si el disparo de las 22 se pierde, el de las 23 todavía
 * mide el día casi entero. Una sola hora convierte cualquier disparo perdido en
 * un día sin métricas que NO se puede reconstruir después (ver el porqué en
 * `trabajos/tablero.ts`).
 */
export const HORAS_ROLLUP: readonly number[] = [22, 23]

/**
 * La lista del despachador frecuente. Depende de la hora UTC porque el rollup
 * solo tiene sentido al final del día que mide.
 *
 * @param horaUtc 0–23. Se pasa en vez de leerse dentro para poder probarlo.
 */
export function planFrecuente(horaUtc: number): readonly Trabajo[] {
  const lista: Trabajo[] = [TRABAJO_RANKING_SNAPSHOT_AMPLIO]
  if (HORAS_ROLLUP.includes(horaUtc)) lista.push(TRABAJO_ROLLUP_METRICAS)
  return lista
}

/** La lista de la ruta suelta que pidió B11. Un solo trabajo, todo el reloj. */
export const PLAN_MODERACION: readonly Trabajo[] = [
  { ...TRABAJO_MODERACION_PENDIENTE, presupuestoMs: 45_000, minimoMs: 1_500 },
]
