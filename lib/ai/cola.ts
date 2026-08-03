// ============================================================================
// B11 · Las dos colas de revisión humana
//
// ── ORDEN VISUAL Y DE DATOS: LA CRISIS PRIMERO, SIEMPRE ────────────────────
// La cola de crisis va antes que la de moderación en el panel y antes en el
// código. Ninguna optimización, caché, boost o experimento puede retrasarla,
// ocultarla ni desordenarla.
//
// ── PAGINACIÓN: KEYSET, NUNCA OFFSET ───────────────────────────────────────
// `OFFSET 10000` obliga a Postgres a leer y descartar diez mil filas en cada
// página, y además la lista se desplaza si entra una fila mientras lees. El
// predicado es siempre una comparación de tupla sobre EL MISMO par que ordena
// y que indexa:
//   · crisis     → (created_at, id) sobre idx_crisis_pending
//   · moderación → (severity, created_at) sobre idx_moderation_queue
//
// Los dos índices son PARCIALES con exactamente el `WHERE` de su consulta, así
// que su tamaño es el del backlog real y no el del histórico. Verificado
// contra `darma-dev` con 20 000 filas sembradas: Index Scan en las dos, cero
// Seq Scan (los planes están en el resumen del bloque).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NivelRiesgo } from './esquemas.ts'

/** Página con cursor opaco (CONTRATOS §5). */
export interface PaginaCursor<T> {
  items: T[]
  /** Opaco (base64). `null` cuando no hay más. El cliente NO lo interpreta. */
  siguienteCursor: string | null
}

export const LIMITE_MAXIMO = 50
export const LIMITE_POR_DEFECTO = 20

/**
 * Item de la cola de moderación.
 *
 * ⚠️ NO lleva `reporter_id`. Decirle a alguien quién le ha reportado es
 * entregarle un objetivo. `subject_id` sí viaja, pero solo dentro del panel de
 * moderación, que exige rol comprobado en el servidor.
 */
export interface ItemCola {
  id: string
  refType: string
  refId: string | null
  refBigint: number | null
  subjectId: string | null
  signal: string
  severity: number
  createdAt: string
}

/** Item de la cola de crisis. Sin país suelto: el país solo va en la tarjeta. */
export interface ItemCrisis {
  id: string
  userId: string
  refType: string | null
  refId: string | null
  risk: NivelRiesgo
  createdAt: string
}

// ── Cursor ──────────────────────────────────────────────────────────────────

/**
 * Codifica un cursor. Base64 de un JSON: opaco para el cliente, trivial de
 * depurar para nosotros. No va firmado a propósito — no protege nada, solo
 * marca una posición dentro de una lista que el moderador ya puede leer
 * entera; firmarlo sería ceremonia sin ganancia.
 */
export function codificarCursor(valor: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url')
}

/** Decodifica. Un cursor manipulado devuelve `null`, nunca lanza. */
export function decodificarCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor) return null
  try {
    const crudo = Buffer.from(cursor, 'base64url').toString('utf8')
    const valor: unknown = JSON.parse(crudo)
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null
    return valor as Record<string, unknown>
  } catch {
    return null
  }
}

/** Normaliza el límite pedido. Nunca por encima de 50 (CONTRATOS §5). */
export function normalizarLimite(valor: unknown): number {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return LIMITE_POR_DEFECTO
  return Math.min(LIMITE_MAXIMO, Math.floor(n))
}

// ── Consultas ───────────────────────────────────────────────────────────────

interface FilaCrisis {
  id: number
  user_id: string
  ref_type: string | null
  ref_id: string | null
  risk: NivelRiesgo
  created_at: string
}

interface FilaFlag {
  id: number
  ref_type: string
  ref_id: string | null
  ref_bigint: number | null
  subject_id: string | null
  signal: string
  severity: number
  created_at: string
}

/**
 * Cola de crisis viva. Réplica literal del `WHERE` de `idx_crisis_pending`:
 * `attended_at is null and risk in ('high','critical')`, ordenada por
 * `created_at` ascendente — lo más antiguo sin atender es lo más urgente.
 */
export async function leerColaCrisis(
  admin: SupabaseClient,
  opciones: { cursor?: string | null; limite?: number } = {},
): Promise<PaginaCursor<ItemCrisis>> {
  const limite = normalizarLimite(opciones.limite)
  const cursor = decodificarCursor(opciones.cursor)

  let consulta = admin
    .from('crisis_events')
    .select('id, user_id, ref_type, ref_id, risk, created_at')
    .is('attended_at', null)
    .in('risk', ['high', 'critical'])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite + 1)

  if (cursor && typeof cursor.t === 'string') {
    // Desempate por id: dos eventos con el mismo `created_at` no pueden
    // repetirse ni perderse entre páginas.
    consulta = consulta.or(
      `created_at.gt.${cursor.t},and(created_at.eq.${cursor.t},id.gt.${Number(cursor.i) || 0})`,
    )
  }

  const { data, error } = await consulta
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as FilaCrisis[]
  const hayMas = filas.length > limite
  const visibles = hayMas ? filas.slice(0, limite) : filas

  return {
    items: visibles.map((f) => ({
      id: String(f.id),
      userId: f.user_id,
      refType: f.ref_type,
      refId: f.ref_id,
      risk: f.risk,
      createdAt: f.created_at,
    })),
    siguienteCursor: hayMas
      ? codificarCursor({ t: visibles[visibles.length - 1].created_at, i: visibles[visibles.length - 1].id })
      : null,
  }
}

/**
 * Cola de moderación. Réplica literal del `WHERE` de `idx_moderation_queue`
 * (`state = 'pending'`), ordenada por severidad descendente y luego por
 * antigüedad: lo grave primero, y a igual gravedad lo que lleva más esperando.
 */
export async function leerColaModeracion(
  admin: SupabaseClient,
  opciones: { cursor?: string | null; limite?: number } = {},
): Promise<PaginaCursor<ItemCola>> {
  const limite = normalizarLimite(opciones.limite)
  const cursor = decodificarCursor(opciones.cursor)

  let consulta = admin
    .from('moderation_flags')
    .select('id, ref_type, ref_id, ref_bigint, subject_id, signal, severity, created_at')
    .eq('state', 'pending')
    .order('severity', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limite + 1)

  if (cursor && typeof cursor.s === 'number' && typeof cursor.t === 'string') {
    consulta = consulta.or(
      `severity.lt.${cursor.s},and(severity.eq.${cursor.s},created_at.gt.${cursor.t})`,
    )
  }

  const { data, error } = await consulta
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as FilaFlag[]
  const hayMas = filas.length > limite
  const visibles = hayMas ? filas.slice(0, limite) : filas

  return {
    items: visibles.map((f) => ({
      id: String(f.id),
      refType: f.ref_type,
      refId: f.ref_id,
      refBigint: f.ref_bigint,
      subjectId: f.subject_id,
      signal: f.signal,
      severity: f.severity,
      createdAt: f.created_at,
    })),
    siguienteCursor: hayMas
      ? codificarCursor({
          s: visibles[visibles.length - 1].severity,
          t: visibles[visibles.length - 1].created_at,
        })
      : null,
  }
}

// ── Acciones del revisor ────────────────────────────────────────────────────

export type AccionFlag = 'resolved' | 'dismissed'

/** Resuelve o descarta un flag. Devuelve el estado final. */
export async function resolverFlag(
  admin: SupabaseClient,
  flagId: string,
  accion: AccionFlag,
  revisorId: string,
  nota?: string,
): Promise<AccionFlag> {
  const ahora = new Date().toISOString()
  const { error } = await admin
    .from('moderation_flags')
    .update({
      state: accion,
      reviewer_id: revisorId,
      reviewed_at: ahora,
      resolved_at: ahora,
      // La nota del revisor sí se guarda: la escribe un moderador sobre su
      // propia decisión, no es el desahogo de nadie.
      ...(nota ? { detail: nota.slice(0, 500) } : {}),
    })
    .eq('id', flagId)
  if (error) throw new Error(error.message)
  return accion
}

/**
 * Marca un evento de crisis como atendido.
 *
 * `outcome` es texto libre del revisor sobre lo que hizo. Se recorta y no se
 * mezcla nunca con el contenido de la persona.
 */
export async function atenderCrisis(
  admin: SupabaseClient,
  eventoId: string,
  outcome: string,
  revisorId: string,
): Promise<void> {
  const { error } = await admin
    .from('crisis_events')
    .update({
      attended_at: new Date().toISOString(),
      human_reviewed: true,
      reviewer_id: revisorId,
      outcome: outcome.slice(0, 500),
    })
    .eq('id', eventoId)
  if (error) throw new Error(error.message)
}
