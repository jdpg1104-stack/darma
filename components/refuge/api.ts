// ============================================================================
// B10 · El cliente HTTP del bloque. Se ejecuta en el navegador.
//
// Todo lo que sale de aquí hacia la red va YA CIFRADO. Este archivo no conoce
// ni una palabra en claro: recibe base64 y lo manda. Si algún día alguien
// necesita añadir un parámetro a una de estas funciones y ese parámetro es
// texto que escribió una persona, la respuesta es que no.
// ============================================================================

import type {
  AlmaAfin,
  ClavePublicaPerfil,
  MensajeCifrado,
  PaginaCursor,
  ResumenRefugio,
  SobreCifrado,
} from '@/lib/crypto/tipos'

type Respuesta<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export class ErrorDeRed extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ErrorDeRed'
    this.code = code
  }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    // Nunca cacheado por un intermediario: una respuesta de refugio cacheada es
    // la conversación de una persona servida a otra.
    cache: 'no-store',
  })

  let cuerpo: Respuesta<T>
  try {
    cuerpo = (await respuesta.json()) as Respuesta<T>
  } catch {
    throw new ErrorDeRed('error_interno', 'No hemos podido conectar. Inténtalo otra vez.')
  }

  if (!cuerpo.ok) throw new ErrorDeRed(cuerpo.code, cuerpo.message)
  return cuerpo.data
}

// ── Bandeja e hilo ──────────────────────────────────────────────────────────

export function listarRefugios(cursor?: string | null): Promise<PaginaCursor<ResumenRefugio>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return pedir(`/api/refuges${query}`)
}

/**
 * Abre un refugio. Los sobres se preparan ANTES en el navegador
 * (`prepararSobresDeSalaNueva`): aquí ya viajan cifrados, y la clave del
 * refugio no aparece por ningún lado de esta petición.
 *
 * El `title` es el único texto en claro de todo el bloque, y por eso la ruta lo
 * limita a 60 caracteres: nunca se rellena con parte de un mensaje.
 */
export function crearRefugio(cuerpo: {
  kind: 'duo' | 'circulo'
  title?: string | null
  topic?: string | null
  miembros: readonly string[]
  sobres: ReadonlyArray<{
    recipientId: string
    wrappedKeyB64: string
    wrapNonceB64: string
    senderFingerprint: string
    keyVersion: number
  }>
}): Promise<{ refugeId: string }> {
  return pedir('/api/refuges', { method: 'POST', body: JSON.stringify(cuerpo) })
}

export function listarMensajes(
  refugeId: string,
  opciones: { cursor?: string | null; limite?: number } = {},
): Promise<PaginaCursor<MensajeCifrado>> {
  const params = new URLSearchParams()
  if (opciones.cursor) params.set('cursor', opciones.cursor)
  if (opciones.limite) params.set('limite', String(opciones.limite))
  const query = params.toString()
  return pedir(`/api/refuges/${refugeId}/mensajes${query ? `?${query}` : ''}`)
}

export function enviarMensaje(
  refugeId: string,
  cuerpo: { ciphertextB64: string; nonceB64: string; encVersion: number; kind: 'text' | 'system'; byteSize: number },
): Promise<{ mensaje: MensajeCifrado }> {
  return pedir(`/api/refuges/${refugeId}/mensajes`, { method: 'POST', body: JSON.stringify(cuerpo) })
}

export function marcarLeido(refugeId: string, hastaId: number): Promise<{ ok: boolean }> {
  return pedir(`/api/refuges/${refugeId}/leido`, { method: 'POST', body: JSON.stringify({ hastaId }) })
}

export function salirDeRefugio(refugeId: string): Promise<{ ok: boolean }> {
  return pedir(`/api/refuges/${refugeId}/salir`, { method: 'POST' })
}

// ── Claves y sobres ─────────────────────────────────────────────────────────

export function obtenerClaves(userIds: readonly string[]): Promise<ClavePublicaPerfil[]> {
  return pedir(`/api/refuges/keys?userIds=${userIds.map(encodeURIComponent).join(',')}`)
}

export function publicarClave(cuerpo: {
  publicJwk: { kty: string; crv: string; x: string; y: string }
  fingerprint: string
  keyVersion: number
}): Promise<{ fingerprint: string; keyVersion: number }> {
  return pedir('/api/refuges/keys', { method: 'POST', body: JSON.stringify(cuerpo) })
}

export function obtenerSobre(refugeId: string): Promise<SobreCifrado | null> {
  return pedir(`/api/refuges/${refugeId}/sobre`)
}

export function enviarSobre(
  refugeId: string,
  cuerpo: {
    recipientId: string
    wrappedKeyB64: string
    wrapNonceB64: string
    senderFingerprint: string
    keyVersion: number
  },
): Promise<{ ok: boolean }> {
  return pedir(`/api/refuges/${refugeId}/sobre`, { method: 'POST', body: JSON.stringify(cuerpo) })
}

// ── Almas afines y bloqueo ──────────────────────────────────────────────────

export function listarAlmasAfines(): Promise<AlmaAfin[]> {
  return pedir('/api/refuges/kindred')
}

export function guardarAlmaAfin(kindredId: string): Promise<{ ok: boolean }> {
  return pedir('/api/refuges/kindred', { method: 'POST', body: JSON.stringify({ kindredId }) })
}

export function olvidarAlmaAfin(kindredId: string): Promise<{ ok: boolean }> {
  return pedir(`/api/refuges/kindred/${kindredId}`, { method: 'DELETE' })
}

export function anotarAlmaAfin(kindredId: string, note: string | null): Promise<{ ok: boolean }> {
  return pedir(`/api/refuges/kindred/${kindredId}`, { method: 'PATCH', body: JSON.stringify({ note }) })
}

export function bloquear(userId: string, mode: 'block' | 'mute'): Promise<{ ok: boolean }> {
  return pedir('/api/refuges/bloquear', { method: 'POST', body: JSON.stringify({ userId, mode }) })
}

/**
 * Registra un evento de crisis.
 *
 * ⚠️ FÍJATE EN LO QUE **NO** RECIBE ESTA FUNCIÓN: el texto. `assessCrisisRisk()`
 * ya corrió aquí, en el navegador, sobre el mensaje en claro; lo único que
 * cruza la red es el nivel. El esquema del servidor es `.strict()` y devolvería
 * 422 si alguien añadiera un campo más, pero la primera barrera es esta firma.
 */
export function registrarCrisis(cuerpo: {
  refugeId: string
  risk: 'none' | 'low' | 'high' | 'critical'
  recursos: string[]
  countryCode?: string | null
}): Promise<{ ok: boolean }> {
  return pedir('/api/refuges/crisis', { method: 'POST', body: JSON.stringify(cuerpo) })
}
