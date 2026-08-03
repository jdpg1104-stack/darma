// ============================================================================
// B11 · Rastro de cada decisión automática
//
// ── LA REGLA QUE MANDA AQUÍ: SIN EL TEXTO DEL USUARIO ──────────────────────
// Ni el cuerpo, ni un extracto, ni el fragmento que casó con un patrón de
// crisis, ni el `motivo` si citara algo. Un log de moderación que contenga
// desahogos es una base de datos de confesiones esperando a filtrarse, y en
// una app cuyo único activo es el anonimato eso no es un riesgo aceptable.
// Se guarda el `ref_id`: quien tenga permiso para leer el contenido, que lo
// lea de su tabla, con su política y su registro de acceso.
//
// ── DÓNDE SE ESCRIBE ───────────────────────────────────────────────────────
// En `moderation_flags`, que es la única tabla de moderación que existe. Las
// filas de auditoría pura nacen con `state = 'dismissed'` A PROPÓSITO:
// `idx_moderation_queue` es un índice PARCIAL sobre `state = 'pending'`, así
// que una fila 'dismissed' no entra en la cola ni la ensancha. Con 100 000
// clasificaciones al día, escribirlas como 'pending' haría inservible el panel
// en una semana.
//
// Una tabla `ai_decisions` dedicada sería mejor (columnas tipadas, retención
// propia, sin FK a perfiles). Está anotado en HANDOFF/PEDIDOS.md para B19/F2.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { PROMPT_VERSION, costeUsd, modeloActivo, type UsoTokens } from './modelo.ts'
import type { CausaDegradacion } from './clasificarComentario.ts'
import type { NivelRiesgo, VeredictoCalidad } from './esquemas.ts'

/** Tipos de referencia aceptados por el CHECK de `moderation_flags.ref_type`. */
export type RefTipo = 'post' | 'comment' | 'refuge_message' | 'profile' | 'content_item'

/** Señales que emite este bloque. Estables: la analítica las agrupa. */
export type SenalModeracion =
  | 'ai_decision'
  | 'ai_unavailable'
  | 'ai_budget_warning'
  | 'ai_toxicity'
  | 'user_report'

export interface EntradaAuditoria {
  refTipo: RefTipo
  /** uuid del contenido. NUNCA su cuerpo. */
  refId?: string
  /** Sobre quién recae la señal. */
  sujetoId?: string
  calidad: VeredictoCalidad
  puntuacion: number | null
  riesgo: NivelRiesgo
  /** Frase del clasificador. Se trunca; la rúbrica prohíbe que cite el texto. */
  motivo: string
  degradado: boolean
  causa: CausaDegradacion
  uso: UsoTokens
  latenciaMs: number
  cacheAcertada: boolean
}

export interface FilaAuditoria {
  ref_type: RefTipo
  ref_id: string | null
  subject_id: string | null
  signal: SenalModeracion
  severity: number
  detail: string
  state: 'pending' | 'dismissed'
}

/**
 * Severidad 1–5 (CHECK de la columna). Solo lo que un humano debería mirar
 * antes que otra cosa; la auditoría rutinaria se queda en 1.
 */
function severidadDe(entrada: EntradaAuditoria): number {
  if (entrada.riesgo === 'critical') return 5
  if (entrada.riesgo === 'high') return 4
  if (entrada.calidad === 'toxico') return 4
  if (entrada.degradado) return 3
  return 1
}

/**
 * ¿Merece cola humana? Solo lo accionable. Una clasificación limpia se guarda
 * pero nace 'dismissed' para no entrar en `idx_moderation_queue`.
 */
function esAccionable(entrada: EntradaAuditoria): boolean {
  return entrada.degradado || entrada.calidad === 'toxico' || entrada.riesgo === 'high' || entrada.riesgo === 'critical'
}

/**
 * Construye la fila. PURA — y por eso testeable: la prueba que importa es que
 * el texto del usuario NO aparece por ninguna parte del objeto resultante.
 *
 * `detail` es un JSON compacto con los metadatos del modelo. Lleva versión de
 * prompt, tokens, latencia, coste y si la caché acertó: sin esos campos, "el
 * clasificador empezó a fallar el martes" no se puede correlacionar con nada.
 */
export function construirFilaAuditoria(entrada: EntradaAuditoria): FilaAuditoria {
  const detalle = {
    modelo: modeloActivo(),
    prompt: PROMPT_VERSION,
    calidad: entrada.calidad,
    puntuacion: entrada.puntuacion,
    riesgo: entrada.riesgo,
    // Recortado por si un motivo larguísimo intentara colar contenido. La
    // rúbrica ya lo prohíbe; esto es el cinturón sobre los tirantes.
    motivo: entrada.motivo.slice(0, 160),
    degradado: entrada.degradado,
    causa: entrada.causa,
    tokens: entrada.uso,
    coste_usd: Math.round(costeUsd(entrada.uso) * 1e6) / 1e6,
    latencia_ms: Math.round(entrada.latenciaMs),
    cache: entrada.cacheAcertada,
  }

  return {
    ref_type: entrada.refTipo,
    ref_id: entrada.refId ?? null,
    subject_id: entrada.sujetoId ?? null,
    signal: entrada.degradado ? 'ai_unavailable' : entrada.calidad === 'toxico' ? 'ai_toxicity' : 'ai_decision',
    severity: severidadDe(entrada),
    detail: JSON.stringify(detalle),
    state: esAccionable(entrada) ? 'pending' : 'dismissed',
  }
}

export interface DepsAuditoria {
  /** Cliente ADMIN: `moderation_flags` no tiene ni una política RLS. */
  admin?: SupabaseClient
}

/**
 * Escribe la fila. NUNCA lanza y NUNCA bloquea la respuesta al usuario.
 *
 * Si la auditoría falla, se registra el fallo y se sigue. Que no se pueda
 * anotar una decisión no puede impedir que alguien publique, y desde luego no
 * puede impedir que se le enseñe la tarjeta de ayuda.
 */
export async function registrarDecision(
  entrada: EntradaAuditoria,
  deps: DepsAuditoria = {},
): Promise<FilaAuditoria> {
  const fila = construirFilaAuditoria(entrada)
  if (!deps.admin) return fila
  try {
    await deps.admin.from('moderation_flags').insert(fila)
  } catch (causa) {
    console.error('[darma][b11] no se pudo auditar la decisión', {
      ref_type: fila.ref_type,
      signal: fila.signal,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
  }
  return fila
}

/** Flag suelto (aviso de presupuesto, reporte de usuario). NUNCA lanza. */
export async function abrirFlag(
  fila: {
    refTipo: RefTipo
    refId?: string
    sujetoId?: string
    reporterId?: string
    senal: SenalModeracion
    severidad: number
    detalle?: string
  },
  deps: DepsAuditoria = {},
): Promise<void> {
  if (!deps.admin) return
  try {
    await deps.admin.from('moderation_flags').insert({
      ref_type: fila.refTipo,
      ref_id: fila.refId ?? null,
      subject_id: fila.sujetoId ?? null,
      reporter_id: fila.reporterId ?? null,
      signal: fila.senal,
      severity: Math.min(5, Math.max(1, Math.round(fila.severidad))),
      // El motivo del reportante NO se guarda en crudo: es texto de usuario y
      // puede contener el propio contenido reportado. Solo se guarda la
      // categoría, que ya viene validada por zod en la ruta.
      detail: fila.detalle ?? null,
      state: 'pending',
    })
  } catch (causa) {
    console.error('[darma][b11] no se pudo abrir el flag', {
      signal: fila.senal,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
  }
}
