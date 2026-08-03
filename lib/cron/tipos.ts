// ============================================================================
// B00 · integración · tipos del despachador de crons.
//
// Viven aparte del despachador para que los TRABAJOS (que hablan con Postgres,
// con YouTube y con el clasificador) no tengan que importar el despachador, y
// para que el despachador no tenga que importar ni un solo trabajo. Esa
// dirección única es lo que permite probar el reparto de presupuesto y el
// aislamiento de fallos con trabajos de mentira, sin base de datos y sin red.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lo que se guarda en `cron_runs.detalle`.
 *
 * ⚠️ CONTEOS, NUNCA IDENTIDADES. Ni un uuid de persona, ni un alias, ni un id
 * de solicitud de privacidad, ni un fragmento del texto de nadie. La cabecera
 * de `0210_1_b00_cron.sql` explica por qué; el tipo no puede impedirlo (un
 * uuid es un `string`), así que la regla se sostiene en la revisión y en la
 * prueba que la comprueba.
 */
export type Detalle = Record<string, number | string | boolean | null>

/**
 * Estado final de un trabajo dentro de un disparo.
 *
 * `parcial` NO es un fallo: es el resultado normal de un trabajo reanudable al
 * que se le acabó su presupuesto. Lo que sí es un fallo silencioso —y por eso
 * tiene estado propio— es `sin_tiempo`: el trabajo ni siquiera arrancó.
 */
export type EstadoTrabajo = 'ok' | 'parcial' | 'error' | 'sin_tiempo'

/** Lo que un trabajo devuelve cuando NO lanza. */
export interface ResultadoTrabajo {
  /** `parcial` ⇒ queda cola; el disparo siguiente continúa desde el cursor. */
  estado: 'ok' | 'parcial'
  detalle: Detalle
}

/** Lo que el despachador le presta a cada trabajo. */
export interface ContextoTrabajo {
  /** Cliente `service_role`. Todas estas tablas tienen RLS sin políticas. */
  admin: SupabaseClient
  /** Presupuesto de reloj de ESTE trabajo, ya recortado a lo que queda. */
  presupuestoMs: number
  /** Inyectable para las pruebas. En producción, `Date.now`. */
  ahora: () => number
  /** `true` cuando el trabajo debe guardar el cursor y salir con `parcial`. */
  agotado: () => boolean
}

export interface Trabajo {
  /** Identificador estable: se agrupa por él en la auditoría. */
  id: string
  /** Techo de reloj en el caso normal. */
  presupuestoMs: number
  /**
   * Por debajo de esto no se arranca: se registra `sin_tiempo` y se pasa al
   * siguiente. Arrancar con 200 ms es peor que no arrancar — cuesta las mismas
   * consultas de apertura y no avanza nada, y encima se lleva por delante el
   * presupuesto del trabajo que venía detrás.
   */
  minimoMs: number
  ejecutar: (ctx: ContextoTrabajo) => Promise<ResultadoTrabajo>
}

export interface EjecucionTrabajo {
  trabajo: string
  estado: EstadoTrabajo
  ms: number
  detalle: Detalle
}

export interface ResultadoDespacho {
  despacho: string
  iniciadoEn: string
  msTotales: number
  trabajos: EjecucionTrabajo[]
  /** `false` ⇒ algún trabajo salió `error` o `sin_tiempo`. */
  todoOk: boolean
}
