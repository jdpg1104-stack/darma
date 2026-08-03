// ============================================================================
// B10 · Validación de entrada de /api/refuges/*
//
// ── TODOS LOS ESQUEMAS SON `.strict()`, Y NO ES UN DETALLE ─────────────────
// Con `.strict()`, un campo no declarado en el esquema hace fallar la petición
// con 422 en vez de ignorarse. En este bloque eso es la barrera que impide que
// alguien añada dentro de seis meses «solo un preview del mensaje» a un body y
// que el servidor lo acepte sin que nadie lo note. La prueba nº 11 de la ficha
// existe exactamente para eso y es obligatoria.
//
// El servidor NO valida el contenido de un mensaje porque no puede: recibe un
// blob cifrado. Lo que sí valida son tamaños, formatos y que nada que se
// parezca a texto en claro entre por ninguna ruta.
// ============================================================================

import { z } from 'zod'

/** Los límites de bytea de `refuge_messages` en 0002. Se replican aquí para
 *  devolver un 422 legible en vez de dejar que reviente el CHECK y traducir un
 *  error de Postgres. La barrera REAL sigue siendo el CHECK. */
export const CIPHERTEXT_MAX_BYTES = 65536
export const NONCE_MIN_BYTES = 12
export const NONCE_MAX_BYTES = 24

const uuid = z.string().uuid()

/** base64 estricto. Sin espacios, sin base64url, sin relleno de más. */
const base64 = z
  .string()
  .min(4)
  .max(200_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'base64 inválido')

/** Huella SHA-256 en hex, tal cual la produce `lib/crypto/huella.ts`. */
const huellaHex = z.string().regex(/^[0-9a-f]{64}$/)

/** Bytes que ocupa una cadena base64 una vez decodificada. */
export function bytesDeBase64(b64: string): number {
  const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - relleno
}

// ── Paginación ──────────────────────────────────────────────────────────────

export const esquemaLimite = z.coerce.number().int().min(1).max(50).default(20)

/**
 * Cursor de la bandeja: `<epoch_ms>|<uuid>` en base64.
 *
 * Opaco para el cliente (CONTRATOS §5) pero legible para nosotros, porque el
 * keyset de `b10_bandeja` necesita las DOS componentes de la tupla que ordena.
 */
export function cursorBandeja(lastMessageAt: string, id: string): string {
  return Buffer.from(`${new Date(lastMessageAt).getTime()}|${id}`, 'utf8').toString('base64')
}

export function leerCursorBandeja(cursor: string | null): { ts: string; id: string } | null {
  if (!cursor) return null
  let crudo: string
  try {
    crudo = Buffer.from(cursor, 'base64').toString('utf8')
  } catch {
    throw new Error('cursor inválido')
  }
  const [ms, id] = crudo.split('|')
  const numero = Number(ms)
  if (!Number.isSafeInteger(numero) || numero < 0 || !uuid.safeParse(id).success) {
    throw new Error('cursor inválido')
  }
  return { ts: new Date(numero).toISOString(), id }
}

/**
 * Cursor del hilo: el `bigint id` del mensaje, en base64.
 *
 * Es el mismo valor que ordena y que indexa (`idx_refuge_messages_keyset`), así
 * que no hay ambigüedad posible: dos mensajes en el mismo milisegundo tienen
 * ids distintos, y `created_at` no.
 */
export function cursorHilo(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64')
}

export function leerCursorHilo(cursor: string | null): number | null {
  if (!cursor) return null
  let crudo: string
  try {
    crudo = Buffer.from(cursor, 'base64').toString('utf8')
  } catch {
    throw new Error('cursor inválido')
  }
  if (!/^\d{1,18}$/.test(crudo)) throw new Error('cursor inválido')
  const id = Number(crudo)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('cursor inválido')
  return id
}

// ── Cuerpos ─────────────────────────────────────────────────────────────────

/** Un sobre, tal cual lo sube el cliente. El `refugeId` va en la ruta o lo pone
 *  el servidor: nunca viaja en el cuerpo de una acción sobre una sala concreta. */
export const esquemaSobre = z
  .object({
    recipientId: uuid,
    wrappedKeyB64: base64,
    wrapNonceB64: base64,
    senderFingerprint: huellaHex,
    keyVersion: z.number().int().min(1).max(32767).default(1),
  })
  .strict()

export const esquemaCrearRefugio = z
  .object({
    kind: z.enum(['duo', 'circulo']),
    // El título va SIN cifrar (0002 lo permite y lo limita a algo inocuo). Es
    // el único texto en claro de todo el bloque y por eso está aquí acotado y
    // documentado: nunca se rellena con parte de un mensaje.
    title: z.string().trim().min(1).max(60).nullish(),
    topic: z.string().trim().min(1).max(60).nullish(),
    miembros: z.array(uuid).min(1).max(7),
    sobres: z.array(esquemaSobre).max(8).default([]),
  })
  .strict()

export const esquemaEnviarMensaje = z
  .object({
    ciphertextB64: base64,
    nonceB64: base64,
    encVersion: z.number().int().min(1).max(32767),
    // 'audio' NO se implementa en este bloque (la ficha lo deja fuera: sin
    // micrófono ni cámara). 'system' lo escribe el propio cliente para el aviso
    // de cambio de clave, y va cifrado igual que el resto.
    kind: z.enum(['text', 'system']),
    byteSize: z.number().int().min(0).max(CIPHERTEXT_MAX_BYTES),
  })
  .strict()

export const esquemaLeido = z.object({ hastaId: z.number().int().positive() }).strict()

export const esquemaPublicarClave = z
  .object({
    publicJwk: z
      .object({
        kty: z.literal('EC'),
        crv: z.literal('P-256'),
        x: z.string().min(1).max(128),
        y: z.string().min(1).max(128),
      })
      // `.strict()` aquí es una barrera criptográfica, no de higiene: rechaza
      // una JWK que traiga `d`, que es la componente PRIVADA. Si esto pasara,
      // alguien estaría subiendo su clave privada al servidor.
      .strict(),
    fingerprint: huellaHex,
    keyVersion: z.number().int().min(1).max(32767).default(1),
  })
  .strict()

export const esquemaKindred = z.object({ kindredId: uuid }).strict()

export const esquemaNotaKindred = z
  .object({ note: z.string().trim().max(140).nullable() })
  .strict()

export const esquemaBloquear = z
  .object({
    userId: uuid,
    mode: z.enum(['block', 'mute']).default('block'),
    // `reason` es para la persona que bloquea, no para nadie más: 0002 no lo
    // enseña a la parte bloqueada. Se acota y no se registra en ningún log.
    reason: z.string().trim().max(140).nullish(),
  })
  .strict()

/**
 * Crisis dentro de un refugio.
 *
 * ⚠️ AQUÍ NO HAY, NI PUEDE HABER, UN CAMPO DE TEXTO. `evaluarRiesgo()` corre en
 * el cliente sobre el texto en claro antes de cifrar; lo único que viaja al
 * servidor es el nivel y la sala. `.strict()` convierte cualquier intento de
 * añadir «solo un preview» en un 422, y hay una prueba que lo comprueba.
 */
export const esquemaCrisis = z
  .object({
    refugeId: uuid,
    risk: z.enum(['none', 'low', 'high', 'critical']),
    /** Qué recursos se le enseñaron, para poder auditarlo. Lista cerrada de
     *  identificadores, nunca texto libre. */
    recursos: z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/)).max(10).default([]),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullish(),
  })
  .strict()

export const esquemaBusquedaClaves = z
  .object({ userIds: z.array(uuid).min(1).max(20) })
  .strict()
