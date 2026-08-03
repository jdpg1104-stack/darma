// ============================================================================
// B10 · Ciclo de vida de la identidad en ESTE dispositivo
//
// Las tres situaciones que hay que distinguir, porque en pantalla son tres
// cosas muy distintas:
//
//  1. DISPOSITIVO CONOCIDO — hay identidad en IndexedDB y la clave pública que
//     el servidor tiene coincide. Todo normal.
//  2. DISPOSITIVO NUEVO — no hay identidad local. Se genera una, se publica con
//     `key_version + 1` y los refugios se abren con el HISTORIAL ILEGIBLE y un
//     aviso claro. NO una pantalla vacía que parezca un bug: quien acaba de
//     cambiar de móvil tiene que entender qué ha pasado y por qué, no pensar
//     que la app perdió sus conversaciones por un error.
//  3. DISPOSITIVO NUEVO CON COPIA — hay `identity_backups` y la persona
//     recuerda su frase. Se recupera la identidad original y el historial
//     vuelve entero.
//
// La decisión de fondo (perder el dispositivo es perder el historial) está
// razonada en `lib/crypto/respaldo.ts`. Aquí solo se implementa.
// ============================================================================

import {
  crearClaveRefugio,
  abrirSobre,
  envolverParaMiembro,
  generarIdentidad,
  type SobreCifrado,
} from '@/lib/crypto'
import { guardarClaveRefugio, guardarIdentidad, obtenerClaveRefugio, obtenerIdentidad } from '@/lib/crypto/almacen'
import { obtenerClaves, obtenerSobre, publicarClave } from './api'

export type EstadoIdentidad = 'conocido' | 'nuevo'

export interface Identidad {
  privada: CryptoKey
  publicJwk: JsonWebKey
  fingerprint: string
  keyVersion: number
  estado: EstadoIdentidad
}

/**
 * Devuelve la identidad de este dispositivo, creándola si hace falta.
 *
 * Cuando genera una nueva sube `key_version + 1` sobre la que hubiera: así los
 * demás ven que la huella cambió y la conversación muestra el aviso de cambio
 * de dispositivo, en vez de que los mensajes «dejen de descifrarse» sin
 * explicación.
 */
export async function asegurarIdentidad(userId: string): Promise<Identidad> {
  const guardada = await obtenerIdentidad(userId)
  if (guardada) {
    return { ...guardada, estado: 'conocido' }
  }

  // ¿Había ya una clave publicada por otro dispositivo? Entonces esto es una
  // rotación, no un alta, y la versión tiene que subir.
  const previas = await obtenerClaves([userId]).catch(() => [])
  const versionAnterior = previas[0]?.keyVersion ?? 0

  const { publicJwk, fingerprint, par } = await generarIdentidad()
  const keyVersion = versionAnterior + 1

  await publicarClave({
    publicJwk: publicJwk as { kty: string; crv: string; x: string; y: string },
    fingerprint,
    keyVersion,
  })

  const identidad = { privada: par.privateKey, publicJwk, fingerprint, keyVersion }
  await guardarIdentidad(userId, identidad)

  return { ...identidad, estado: 'nuevo' }
}

/**
 * Consigue la clave de un refugio: primero de IndexedDB, y si no, abriendo el
 * sobre que alguien dejó para ti.
 *
 * Devuelve `null` cuando no hay sobre o cuando el que hay no se puede abrir
 * (porque se envolvió contra una clave anterior a la rotación). `null` NO es un
 * error: es «este dispositivo todavía no tiene la llave de esta sala», y la UI
 * lo dice con esas palabras y ofrece pedirla.
 */
export async function obtenerClaveDeRefugio(
  userId: string,
  refugeId: string,
  identidad: Identidad,
): Promise<{ clave: CryptoKey | null; huellaEmisor: string | null }> {
  const local = await obtenerClaveRefugio(userId, refugeId)
  if (local) return { clave: local, huellaEmisor: null }

  const sobre = await obtenerSobre(refugeId).catch(() => null)
  if (!sobre) return { clave: null, huellaEmisor: null }

  const clave = await abrirConSobre(refugeId, sobre, identidad, userId)
  return { clave, huellaEmisor: sobre.senderFingerprint }
}

/**
 * Abre un sobre probando contra las claves públicas de los miembros.
 *
 * Se prueba contra la pública de cada miembro y no contra un `sender_id`
 * guardado en el propio sobre porque el sobre trae la HUELLA del emisor en el
 * momento de envolver: si esa persona rotó, su pública de hoy ya no sirve y hay
 * que saberlo, no fallar en silencio.
 */
async function abrirConSobre(
  refugeId: string,
  sobre: SobreCifrado,
  identidad: Identidad,
  userId: string,
): Promise<CryptoKey | null> {
  const { obtenerMiembros } = await import('./miembros')
  const miembros = await obtenerMiembros(refugeId).catch(() => [] as string[])
  if (miembros.length === 0) return null

  const claves = await obtenerClaves(miembros).catch(() => [])

  for (const candidata of claves) {
    // Solo se intenta con quien tenía ESA huella cuando envolvió. Probar con
    // todas a ciegas escondería que el emisor rotó.
    if (candidata.fingerprint !== sobre.senderFingerprint) continue
    try {
      const clave = await abrirSobre(sobre, candidata.publicJwk, identidad.privada)
      await guardarClaveRefugio(userId, refugeId, clave)
      return clave
    } catch {
      // Sigue probando: puede haber dos miembros y solo uno ser el emisor.
    }
  }
  return null
}

/**
 * Crea la clave de una sala nueva y prepara un sobre por invitado.
 *
 * La clave se genera aquí, en el navegador de quien crea el refugio, y NUNCA
 * sale en claro: lo único que viaja son los sobres, cada uno cifrado con el
 * secreto ECDH entre quien invita y quien recibe.
 */
export async function prepararSobresDeSalaNueva(
  identidad: Identidad,
  invitados: readonly string[],
): Promise<{ clave: CryptoKey; sobres: Array<{ recipientId: string; wrappedKeyB64: string; wrapNonceB64: string; senderFingerprint: string; keyVersion: number }> }> {
  const clave = await crearClaveRefugio()
  const claves = await obtenerClaves(invitados)

  const sobres = []
  for (const destino of claves) {
    const { wrappedKeyB64, wrapNonceB64 } = await envolverParaMiembro(clave, destino.publicJwk, identidad.privada)
    sobres.push({
      recipientId: destino.userId,
      wrappedKeyB64,
      wrapNonceB64,
      senderFingerprint: identidad.fingerprint,
      keyVersion: identidad.keyVersion,
    })
  }

  // Quien no tenga clave publicada todavía se queda sin sobre. Es intencionado:
  // no se puede cifrar para alguien cuya clave no existe, y fabricar una en su
  // nombre sería exactamente lo que el número de seguridad existe para detectar.
  return { clave, sobres }
}
