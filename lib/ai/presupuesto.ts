// ============================================================================
// B11 · Presupuesto y cortacircuitos del clasificador
//
// A ~0,00485 $ por clasificación, 100 000 comentarios al día son ~485 $/día.
// Ese número es la razón de que esto sea un requisito duro y no una
// optimización: sin cortacircuitos, un bucle roto, un bot o un pico de tráfico
// convierten un incidente de producto en una factura de cinco cifras.
//
// ── DÓNDE VIVE EL CONTADOR ─────────────────────────────────────────────────
// En `public.rate_limits`, con `check_rate_limit()` — la misma función atómica
// que usa el resto de la app. No en memoria: en serverless cada instancia
// tiene su propio Map, así que "60 llamadas/hora" con 20 instancias vivas son
// 1 200. El único estado compartido y transaccional que tenemos es Postgres.
//
// ── QUÉ PASA AL LLEGAR AL LÍMITE ───────────────────────────────────────────
// Al 80 %: aviso + flag `ai_budget_warning` para que un humano lo mire.
// Al 100 %: el clasificador devuelve `indeterminado` SIN tocar la red y se
// aplica la degradación completa. La etapa de REGLAS nunca se apaga: no cuesta
// dinero y es la que detecta la crisis. Quedarse sin presupuesto puede costar
// karma; no puede costar una detección.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLAVE_PRESUPUESTO_GLOBAL,
  LIMITE_USUARIO,
  UMBRAL_AVISO,
  llamadasDiariasMaximas,
  COSTE_ESTIMADO_LLAMADA_USD,
} from './modelo.ts'

export interface EstadoPresupuesto {
  /** Llamadas contabilizadas hoy. */
  usadas: number
  /** Cupo de hoy, derivado del presupuesto en dólares. */
  maximo: number
  /** 0–1+. Puede pasar de 1 si el contador se dispara entre lecturas. */
  fraccion: number
  /** ≥ 80 %: hay que avisar. */
  aviso: boolean
  /** ≥ 100 %: no se llama a la red. */
  agotado: boolean
  /** Gasto estimado de hoy, en dólares. Para el panel y los logs. */
  gastoEstimadoUsd: number
}

/** Evaluación PURA del estado. Todas las pruebas del umbral pasan por aquí. */
export function evaluarPresupuesto(usadas: number, maximo: number): EstadoPresupuesto {
  const tope = Math.max(1, maximo)
  const consumidas = Math.max(0, usadas)
  const fraccion = consumidas / tope
  return {
    usadas: consumidas,
    maximo: tope,
    fraccion,
    aviso: fraccion >= UMBRAL_AVISO,
    agotado: fraccion >= 1,
    gastoEstimadoUsd: Math.round(consumidas * COSTE_ESTIMADO_LLAMADA_USD * 10000) / 10000,
  }
}

export interface DepsPresupuesto {
  /** Cliente ADMIN. `rate_limits` está revocada a `authenticated`. */
  admin?: SupabaseClient
  /** Sustituye la lectura real. Solo para tests. */
  leerContador?: () => Promise<number>
  /** Sustituye el incremento real. Solo para tests. */
  incrementar?: () => Promise<boolean>
}

/** Lee el contador global de hoy sin incrementarlo. Lectura por PK, sin count(*). */
async function leerUsadas(deps: DepsPresupuesto): Promise<number> {
  if (deps.leerContador) return deps.leerContador()
  if (!deps.admin) return 0

  const { data, error } = await deps.admin
    .from('rate_limits')
    .select('count, window_start')
    .eq('key', CLAVE_PRESUPUESTO_GLOBAL)
    .maybeSingle()

  if (error || !data) return 0

  // La ventana es fija y de 24 h. Si la fila es de una ventana anterior, el
  // contador que se ve ya no es de hoy: se cuenta como cero.
  const fila = data as { count?: number; window_start?: string }
  const inicio = fila.window_start ? Date.parse(fila.window_start) : NaN
  if (Number.isFinite(inicio) && Date.now() - inicio > 86_400_000) return 0

  return typeof fila.count === 'number' ? fila.count : 0
}

/**
 * Reserva una llamada al clasificador.
 *
 * Devuelve `permitido: false` cuando el cupo diario está agotado — y entonces
 * NO se hace ninguna llamada de red. El incremento y la comprobación ocurren
 * dentro de `check_rate_limit`, en una sola sentencia, así que dos peticiones
 * simultáneas no pueden gastar el mismo hueco.
 *
 * NUNCA lanza. Si Postgres no responde, se permite (fail-open): quedarse sin
 * contador no puede dejar a la comunidad sin moderación. El coste de ese
 * fail-open está acotado por el límite por usuario, que es la otra barrera.
 */
export async function reservarLlamada(
  deps: DepsPresupuesto = {},
): Promise<EstadoPresupuesto & { permitido: boolean }> {
  const maximo = llamadasDiariasMaximas()

  let usadas = 0
  try {
    usadas = await leerUsadas(deps)
  } catch {
    usadas = 0
  }

  const estado = evaluarPresupuesto(usadas, maximo)
  if (estado.agotado) return { ...estado, permitido: false }

  try {
    if (deps.incrementar) {
      const ok = await deps.incrementar()
      return { ...evaluarPresupuesto(usadas + 1, maximo), permitido: ok }
    }
    if (deps.admin) {
      const { data, error } = await deps.admin.rpc('check_rate_limit', {
        p_key: CLAVE_PRESUPUESTO_GLOBAL,
        p_limit: maximo,
        p_window_seconds: 86_400,
      })
      if (error) throw new Error(error.message)
      return { ...evaluarPresupuesto(usadas + 1, maximo), permitido: data === true }
    }
  } catch {
    // Fail-open explícito: ver la cabecera.
    return { ...estado, permitido: true }
  }

  return { ...estado, permitido: true }
}

/**
 * Límite por persona: 20 clasificaciones/hora.
 *
 * Fail-open por el mismo motivo que arriba, y con el mismo consuelo: por
 * encima está el cupo global, que sí es duro.
 */
export async function limitarUsuario(
  userId: string,
  deps: DepsPresupuesto = {},
): Promise<boolean> {
  if (!deps.admin) return true
  try {
    const { data, error } = await deps.admin.rpc('check_rate_limit', {
      p_key: `ia:${userId}`,
      p_limit: LIMITE_USUARIO.limite,
      p_window_seconds: LIMITE_USUARIO.ventanaSegundos,
    })
    if (error) throw new Error(error.message)
    return data === true
  } catch {
    return true
  }
}
