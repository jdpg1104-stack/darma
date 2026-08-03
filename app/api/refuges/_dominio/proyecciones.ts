// ============================================================================
// B10 · Proyecciones puras: de fila de Postgres a la forma que sale por la API.
//
// Están AQUÍ y no dentro de las rutas para que se puedan probar sin red y sin
// base de datos. La prueba que importa no es «convierte bien», es «no deja
// salir ni un campo de más»: la forma del JSON de `AlmaAfin` es el contrato de
// anonimato de CONTRATOS §2 hecho código.
// ============================================================================

import type { AlmaAfin } from '@/lib/crypto/tipos'

export interface FilaKindred {
  kindred_id: string
  note: string | null
  profiles: {
    id: string
    alias: string
    avatar_seed: string
    level: 'semilla' | 'brote' | 'guia' | 'mentor'
    karma_reputation: number
    availability: 'disponible' | 'necesito_hablar' | 'ausente'
  } | null
}

/**
 * Proyección EXPLÍCITA, campo a campo.
 *
 * Un `...fila` con spread sería más corto y es justo el bug que este bloque no
 * se puede permitir: bastaría con que mañana el `select` trajera una columna
 * más para que se publicara sola. Aquí, añadir un campo a la respuesta exige
 * escribirlo, y escribirlo hace fallar la prueba de forma.
 */
export function aAlmaAfin(f: FilaKindred): AlmaAfin | null {
  const p = f.profiles
  if (!p) return null
  return {
    id: p.id,
    alias: p.alias,
    avatarSeed: p.avatar_seed,
    nivel: p.level,
    karmaReputacion: p.karma_reputation,
    disponibilidad: p.availability,
    esMentor: p.level === 'mentor',
    note: f.note,
  }
}

/** Las claves EXACTAS que puede tener un `AlmaAfin`. La prueba compara contra
 *  esta lista, así que cualquier campo nuevo tiene que pasar por aquí. */
export const CLAVES_ALMA_AFIN: readonly string[] = [
  'id',
  'alias',
  'avatarSeed',
  'nivel',
  'karmaReputacion',
  'disponibilidad',
  'esMentor',
  'note',
] as const

/**
 * Campos que NUNCA pueden aparecer en una respuesta de este bloque.
 *
 * La lista mezcla identificadores (CONTRATOS §2), saldos privados y todo lo
 * que huela al estado de salud mental de una persona. Se usa como aserción en
 * las pruebas de forma, no como filtro en tiempo de ejecución: filtrar en
 * runtime enseñaría a construir respuestas descuidadas confiando en el filtro.
 */
export const CAMPOS_PROHIBIDOS: readonly string[] = [
  'email',
  'phone',
  'real_name',
  'ip',
  'user_agent',
  'contact_hash',
  'country',
  'karma_spendable',
  'karmaSpendable',
  'crystals',
  'listen_credits',
  'shadow_banned',
  'banned_until',
  'crisis',
  'crisis_events',
  'risk',
  'texto',
  'preview',
] as const
