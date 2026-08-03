// ============================================================================
// B06 · El constructor de la foto
//
// Se ejecuta una vez por hora desde POST /api/ranking/snapshot. Es el ÚNICO
// sitio de todo el bloque donde aparece el cliente `service_role`, y lo hace
// por la razón que exige CONTRATOS §6 documentar: la agregación tiene que ver
// `profiles.shadow_banned` y `profiles.banned_until`, dos columnas que
// `authenticated` no puede leer ni debe poder leer (0001 y 0006 — si el troll
// puede consultar si está silenciado, se crea otra cuenta en cinco minutos).
// No es «el admin porque así funciona»: no existe una política que pueda dar
// este acceso sin romper el shadow-ban.
//
// ── QUÉ HACE ESTE ARCHIVO Y QUÉ HACE POSTGRES ──────────────────────────────
// Casi todo lo hace Postgres, dentro de `construir_ranking_snapshot()`. Aquí
// solo vive lo que no puede vivir allí:
//   · resolver los cortes de calendario con el reloj de negocio (periodos.ts),
//   · pasar el techo antifarmeo derivado de lib/karma.ts,
//   · llevar el PRESUPUESTO DE TIEMPO y encadenar lotes.
// Traer las filas a Node para ordenarlas aquí sería un N+1 monumental y además
// dejaría la clasificación fuera de la transacción.
//
// ── EL PRESUPUESTO DE TIEMPO ───────────────────────────────────────────────
// Una función de Vercel muere a los 60 s. El presupuesto interno es de 50 s: al
// agotarse se devuelve `completado: false` con el último `user_id` escrito y el
// disparo siguiente continúa exactamente desde ahí. La alternativa —escribir
// «los primeros N» y dar la foto por buena— produce un tablero que se corta en
// un punto arbitrario y que cambia de longitud según la carga del servidor.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { corteAnteriorDe, esFechaIso, finPeriodo, inicioPeriodo } from './periodos.ts'
import { LISTENS_DIA_MAX } from './techo.ts'
import { esPeriodo, type PeriodoRanking, type ResultadoSnapshot } from './tipos.ts'

/** Presupuesto por invocación. 50 s de 60: los 10 restantes son el margen para
 *  serializar la respuesta y salir limpiamente en vez de que Vercel corte. */
export const PRESUPUESTO_MS = 50_000

/**
 * Filas por lote. 20 000 es un compromiso medido en la forma del problema, no
 * un número redondo: un lote muy pequeño multiplica el coste, porque cada lote
 * REAGREGA la ventana entera (es lo que mantiene `dense_rank()` global y por
 * tanto la construcción idempotente); uno muy grande se pasa del presupuesto en
 * una sola sentencia, que es justo lo que no se puede reanudar.
 */
export const FILAS_POR_LOTE = 20_000

export interface OpcionesSnapshot {
  periodo: PeriodoRanking
  /** Corte a reconstruir. Por defecto, el periodo en curso. */
  corte?: string
  /** Continuación de una pasada anterior. */
  desdeUsuario?: string | null
  /** Inyectables para los tests; en producción no se tocan. */
  ahora?: Date
  presupuestoMs?: number
  filasPorLote?: number
  reloj?: () => number
}

interface FilaResultadoSql {
  filas: number
  ultimo_usuario: string | null
  completado: boolean
}

/**
 * Construye (o reconstruye) un corte. Idempotente: correrlo dos veces sobre el
 * mismo corte deja exactamente las mismas filas, salvo `built_at`.
 *
 * @param admin cliente con `service_role`. Ver cabecera para el porqué.
 */
export async function construirSnapshot(
  admin: SupabaseClient,
  opciones: OpcionesSnapshot,
): Promise<ResultadoSnapshot> {
  const { periodo } = opciones

  if (!esPeriodo(periodo)) {
    throw new RangeError('[darma][ranking] periodo desconocido')
  }

  const ahora = opciones.ahora ?? new Date()
  const corte = opciones.corte ?? inicioPeriodo(periodo, ahora)

  if (!esFechaIso(corte)) {
    throw new RangeError('[darma][ranking] corte inválido')
  }

  // El corte anterior se calcula SOBRE EL CORTE, no sobre hoy. Reconstruir a
  // mano la semana del 2 de marzo tiene que comparar con la del 23 de febrero;
  // usar «el periodo anterior a ahora» daría el movimiento respecto a la semana
  // pasada y la insignia mentiría en toda la tabla.
  const corteAnterior = corteAnteriorDe(periodo, corte)
  const corteFin = finPeriodo(periodo, corte)

  const presupuesto = opciones.presupuestoMs ?? PRESUPUESTO_MS
  const filasPorLote = opciones.filasPorLote ?? FILAS_POR_LOTE
  const reloj = opciones.reloj ?? (() => Date.now())
  const arranque = reloj()

  let desdeUsuario: string | null = opciones.desdeUsuario ?? null
  let filasTotales = 0
  let completado = false

  // `do…while` y no `while`: siempre se ejecuta al menos un lote. Con un
  // presupuesto ya agotado al entrar (un disparo que llega tarde), un `while`
  // devolvería `completado: false` sin haber escrito nada y el cron se quedaría
  // dando vueltas sin avanzar nunca.
  do {
    const { data, error } = await admin.rpc('construir_ranking_snapshot', {
      p_periodo: periodo,
      p_corte: corte,
      p_corte_fin: corteFin,
      p_corte_anterior: corteAnterior,
      p_listens_dia_max: LISTENS_DIA_MAX,
      p_desde_usuario: desdeUsuario,
      p_max_filas: filasPorLote,
    })

    if (error) {
      // Se propaga con el mensaje de Postgres INTACTO: quien llama es la ruta,
      // que lo registra y devuelve un `error_interno` genérico. El detalle no
      // sale de aquí, pero tampoco se pierde.
      throw new Error(`[darma][ranking] fallo al construir el snapshot: ${error.message}`)
    }

    const fila = (Array.isArray(data) ? data[0] : data) as FilaResultadoSql | undefined
    if (!fila) {
      throw new Error('[darma][ranking] el constructor no devolvió resultado')
    }

    filasTotales += fila.filas
    desdeUsuario = fila.ultimo_usuario ?? desdeUsuario
    completado = fila.completado

    if (completado) break
  } while (reloj() - arranque < presupuesto)

  return { periodo, corte, filas: filasTotales, completado, ultimoUsuario: desdeUsuario }
}
