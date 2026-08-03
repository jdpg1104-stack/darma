// ============================================================================
// PerfilPublico y Yo — las dos únicas formas en que una persona sale de la API
//
// `PerfilPublico` es copia literal de CONTRATOS §2. Vive aquí y no en un módulo
// compartido porque ese módulo todavía no existe y B01 no puede crearlo fuera
// de su directorio; está anotado en HANDOFF/PEDIDOS.md para que B00 lo suba a
// `lib/tipos.ts` y todos los bloques importen el mismo.
//
// ── LA REGLA QUE PROTEGE ESTE ARCHIVO ──────────────────────────────────────
// Estos campos NO EXISTEN en ninguna respuesta ni en ninguna prop:
//   email · phone · real_name · ip · user_agent · contact_hash · country
// Y estos otros son PRIVADOS: solo salen por `/api/me`, dirigidos a su dueño:
//   karmaSpendable · crystals · listenCredits · dailyKarmaEarned
//
// `shadowBanned` tampoco sale: si quien está silenciado puede consultarlo, sabe
// que lo está y se crea otra cuenta — y entonces el shadow-ban no sirve de nada.
// Por eso ni siquiera aparece en `Yo`, aunque `Yo` sea para uno mismo.
// ============================================================================

import type { KarmaLevel } from '../karma.ts'
import type { MensajeReciprocidad } from '../reciprocity.ts'
import type { Disponibilidad, FilaSesion, NivelEntrada } from './session.ts'

/** Todo lo que otra persona puede llegar a saber de ti en Darma. */
export interface PerfilPublico {
  /** uuid — sirve para enlazar, no identifica a nadie */
  id: string
  /** seudónimo, 3–24 caracteres */
  alias: string
  /** semilla determinista del avatar generado */
  avatarSeed: string
  /** derivado del karma vitalicio */
  nivel: KarmaLevel
  /** solo la reputación; el gastable es privado */
  karmaReputacion: number
  disponibilidad: Disponibilidad
  esMentor: boolean
}

/** Respuesta de `GET /api/me`. La ÚNICA superficie con campos privados. */
export interface Yo {
  perfil: PerfilPublico
  karmaSpendable: number
  crystals: number
  listenCredits: number
  dailyKarmaEarned: number
  entryLevel: NivelEntrada
  /** Deriva de lib/reciprocity.ts; no se recalcula aquí. */
  reciprocidad: {
    puedePublicar: boolean
    faltanEscuchas: number
    esPrimerPost: boolean
    /** Clave de catálogo + params, no una frase: el servidor no sabe en qué
     *  idioma lee quien pregunta. La pinta la UI con `obtenerTraductor()`. */
    mensaje: MensajeReciprocidad
  }
  dosFactoresActivo: boolean
}

/**
 * Proyección de una fila de `profiles` a su cara pública.
 *
 * Es una función y no un `select` con las columnas justas porque el filtro debe
 * poder auditarse en un solo sitio: aquí se ve, de un vistazo, que no hay forma
 * de que un campo nuevo del esquema se cuele en una respuesta por el simple
 * hecho de existir.
 */
export function perfilPublicoDesde(fila: FilaSesion): PerfilPublico {
  return {
    id: fila.id,
    alias: fila.alias,
    avatarSeed: fila.avatar_seed,
    nivel: fila.level,
    karmaReputacion: fila.karma_reputation,
    disponibilidad: fila.availability,
    esMentor: fila.level === 'mentor',
  }
}
