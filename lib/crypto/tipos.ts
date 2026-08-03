// ============================================================================
// B10 · Tipos del cifrado extremo a extremo de los refugios.
//
// Este archivo es CONTRATO (HANDOFF/B10.md §Contrato). Nada de lo que hay aquí
// contiene texto en claro, y esa es la propiedad que hay que defender cada vez
// que se le añada un campo: si mañana alguien mete un `preview: string` en
// `MensajeCifrado` "solo para la lista", el cifrado deja de servir para nada.
// ============================================================================

/** Clave PÚBLICA de identidad de una persona. Pública por definición: es lo que
 *  permite a otra derivar un secreto compartido con ella. */
export interface ClavePublicaPerfil {
  userId: string
  publicJwk: JsonWebKey
  /** SHA-256 en hex (64 caracteres) de la JWK canonicalizada. */
  fingerprint: string
  keyVersion: number
}

/** La clave simétrica de un refugio, envuelta para una persona concreta. */
export interface SobreCifrado {
  refugeId: string
  wrappedKeyB64: string
  wrapNonceB64: string
  /** Huella del emisor EN EL MOMENTO de envolver. Si hoy no coincide con la
   *  clave publicada por esa persona, rotó y este sobre ya no corresponde. */
  senderFingerprint: string
  keyVersion: number
}

export type TipoMensaje = 'text' | 'audio' | 'system'

/** Lo que viaja por la red y lo que guarda Postgres. Opaco para ambos. */
export interface MensajeCifrado {
  /** `bigint identity` del esquema. Llega como number (< 2^53) o como string. */
  id: number
  refugeId: string
  senderId: string
  ciphertextB64: string
  nonceB64: string
  encVersion: number
  kind: TipoMensaje
  /** ISO-8601 */
  createdAt: string
}

/** Lo que la UI pinta. `texto` es null si la clave no está disponible. */
export interface MensajeDescifrado extends Omit<MensajeCifrado, 'ciphertextB64' | 'nonceB64'> {
  texto: string | null
  /** true cuando el fallo es «no tengo la clave», no «el mensaje está corrupto».
   *  La diferencia importa en pantalla: lo primero se arregla pidiendo el sobre
   *  otra vez; lo segundo no se arregla y hay que decirlo. */
  ilegiblePorClave: boolean
}

/** Resumen de un refugio en la bandeja. Sin una sola palabra del contenido. */
export interface ResumenRefugio {
  id: string
  kind: 'duo' | 'circulo'
  /** Título opcional SIN cifrar (0002 lo permite y lo limita a algo inocuo).
   *  Nunca se rellena con parte de un mensaje. */
  title: string | null
  memberCount: number
  messageCount: number
  lastMessageAt: string | null
  lastReadMessageId: number | null
  muted: boolean
  /** Derivado de comparar `lastReadMessageId` con el último id conocido.
   *  NO sale de un count(*) sobre refuge_messages. */
  haySinLeer: boolean
}

/** `PerfilPublico` + la nota privada de quien guarda. Ni un campo más:
 *  CONTRATOS §2 y la prueba 12 de la ficha vigilan exactamente esta forma. */
export interface AlmaAfin {
  id: string
  alias: string
  avatarSeed: string
  nivel: 'semilla' | 'brote' | 'guia' | 'mentor'
  karmaReputacion: number
  disponibilidad: 'disponible' | 'necesito_hablar' | 'ausente'
  esMentor: boolean
  note: string | null
}

/** Página con cursor opaco (CONTRATOS §5). */
export interface PaginaCursor<T> {
  items: T[]
  siguienteCursor: string | null
}

/** Identidad recién generada. La parte privada NO aparece aquí a propósito:
 *  vive como `CryptoKey` no extraíble en IndexedDB y no se serializa nunca. */
export interface IdentidadPublicada {
  publicJwk: JsonWebKey
  fingerprint: string
}

/** Material que solo existe durante el instante de crear la copia de seguridad
 *  opt-in. Ver `lib/crypto/respaldo.ts` y HANDOFF/B10.md §4. */
export interface RespaldoIdentidad {
  wrappedIdentityB64: string
  wrapNonceB64: string
  kdfSaltB64: string
  kdfIterations: number
}
