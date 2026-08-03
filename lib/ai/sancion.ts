// ============================================================================
// B11 · Shadow-ban y penalizaciones de karma
//
// ── POR QUÉ SHADOW-BAN Y NO BANEO DURO ─────────────────────────────────────
// Un baneo duro le dice al troll que le han pillado, y lo único que provoca es
// que se cree otra cuenta. El shadow-ban le deja la app funcionando igual: su
// contenido desaparece del feed de los demás pero él lo sigue viendo. La
// política `posts_read` de 0001 está escrita exactamente para eso.
//
// Ojo al comprobarlo: como el autor SIGUE viendo sus posts, mirar su perfil
// desde su propia sesión no demuestra nada. Hay que mirarlo desde otra.
//
// ── POR QUÉ TODO PASA POR EL CLIENTE ADMIN ─────────────────────────────────
// `profiles.shadow_banned` no está en el `grant update` de `authenticated`
// (0001 concede solo alias, avatar_seed, bio, availability) y `award_karma()`
// está revocada a `authenticated`. Correcto y deliberado: sancionar es una
// operación de servidor.
//
// ── LOS NÚMEROS NO SE ESCRIBEN AQUÍ ────────────────────────────────────────
// −40 y −30 se IMPORTAN de `lib/karma.ts`. CONTRATOS §8: los valores viven en
// TypeScript y en `karma_weights`, y hay un test que comprueba que coinciden.
// Copiarlos a un tercer sitio es garantizar que un día los tres discrepen.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { KARMA_WEIGHTS, type KarmaKind } from '../karma.ts'

/** Sanciones que este bloque puede aplicar. */
export type TipoSancion = Extract<KarmaKind, 'spam_penalty' | 'report_upheld'>

export interface ResultadoSancion {
  aplicada: boolean
  /** Delta de reputación aplicado (negativo). Sale de KARMA_WEIGHTS. */
  delta: number
  /** Motivo legible cuando no se aplicó. Nunca detalle interno del proveedor. */
  motivo?: string
}

/** Delta de una sanción. PURA. Nunca un número literal. */
export function deltaDeSancion(tipo: TipoSancion): number {
  return KARMA_WEIGHTS[tipo].reputation
}

export interface DepsSancion {
  /** Cliente ADMIN. Obligatorio: sin él no hay sanción, no hay atajo. */
  admin?: SupabaseClient
}

/**
 * Aplica una penalización de karma vía `award_karma()`. NUNCA lanza.
 *
 * `idempotencyKey` es lo que hace que un reintento tras un timeout no cobre
 * dos veces: `karma_events.idempotency_key` lleva `ON CONFLICT DO NOTHING`.
 * Se construye con el id del flag, que es único por decisión de moderación.
 *
 * ⚠️ Comprobado contra `darma-dev`: `award_karma(uuid,text,text,uuid,text)`
 * tiene `execute` para `service_role` (0001 lo concede explícitamente en la
 * línea siguiente al `revoke`). No hace falta migración de permisos.
 */
export async function penalizar(
  userId: string,
  tipo: TipoSancion,
  refId: string | null,
  idempotencyKey: string,
  deps: DepsSancion = {},
): Promise<ResultadoSancion> {
  const delta = deltaDeSancion(tipo)
  if (!deps.admin) return { aplicada: false, delta, motivo: 'sin_cliente_admin' }

  try {
    const { error } = await deps.admin.rpc('award_karma', {
      p_user: userId,
      p_kind: tipo,
      p_ref_type: 'comment',
      p_ref_id: refId,
      p_idem: idempotencyKey,
    })
    if (error) throw new Error(error.message)
    return { aplicada: true, delta }
  } catch (causa) {
    console.error('[darma][b11] penalización no aplicada', {
      tipo,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
    return { aplicada: false, delta, motivo: 'fallo_al_aplicar' }
  }
}

/** Activa o levanta el shadow-ban. NUNCA lanza. */
export async function aplicarShadowBan(
  userId: string,
  activo: boolean,
  deps: DepsSancion = {},
): Promise<boolean> {
  if (!deps.admin) return false
  try {
    const { error } = await deps.admin
      .from('profiles')
      .update({ shadow_banned: activo })
      .eq('id', userId)
    if (error) throw new Error(error.message)
    return true
  } catch (causa) {
    console.error('[darma][b11] shadow-ban no aplicado', {
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
    return false
  }
}

/**
 * Reincidencia en 90 días.
 *
 * Éste es el ÚNICO `count(*)` permitido en el bloque, y solo porque corre en
 * el camino de ESCRITURA de una sanción (poco frecuente) y `idx_moderation_subject`
 * —parcial sobre `subject_id is not null`— lo acota a las filas de esa persona.
 * En una lectura de feed sería inaceptable.
 */
export async function reincidencia(
  userId: string,
  deps: DepsSancion = {},
): Promise<number> {
  if (!deps.admin) return 0
  try {
    const desde = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { count, error } = await deps.admin
      .from('moderation_flags')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', userId)
      .eq('state', 'resolved')
      .gt('created_at', desde)
    if (error) throw new Error(error.message)
    return count ?? 0
  } catch {
    return 0
  }
}

/**
 * Política de sanción a partir de la reincidencia. PURA.
 *
 * Escalonada a propósito: la primera vez se penaliza y ya está. El shadow-ban
 * llega a la tercera señal confirmada en 90 días, porque a esas alturas ya no
 * es un mal día — es un patrón.
 */
export function decidirSancion(reincidencias: number): {
  penalizar: TipoSancion
  shadowBan: boolean
} {
  return {
    penalizar: reincidencias >= 1 ? 'report_upheld' : 'spam_penalty',
    shadowBan: reincidencias >= 2,
  }
}
