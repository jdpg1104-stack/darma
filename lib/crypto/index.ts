// ============================================================================
// B10 · El cifrado de los refugios. TODO esto corre SOLO en el navegador.
//
// ⚠️ Antes de tocar una línea de este archivo, lee HANDOFF/B10.md §2. Las
// decisiones ya están tomadas; aquí está el porqué de cada una, no un menú.
//
// ── EL ESQUEMA ─────────────────────────────────────────────────────────────
// · Mensaje:      AES-256-GCM, nonce de 12 bytes ALEATORIOS. `enc_version = 1`.
// · Clave de sala: AES-256 aleatoria, una por refugio.
// · Intercambio:  ECDH P-256 → HKDF-SHA256 → KEK AES-256 → envuelve la clave de
//                 sala, un sobre por miembro.
// · Identidad:    par ECDH P-256 con la privada NO EXTRAÍBLE en IndexedDB.
//
// ── POR QUÉ AES-GCM Y NO XChaCha20-Poly1305 ────────────────────────────────
// XChaCha sería mejor: su nonce de 24 bytes se puede sortear al azar sin pensar
// en colisiones. Pero WebCrypto NO lo implementa, y traerlo significa meter una
// librería de criptografía de terceros en el bundle del camino más sensible de
// la app —el sitio donde una dependencia comprometida lo lee todo—. AES-GCM
// viene con el navegador, auditado, y con 12 bytes de nonce aleatorio la
// probabilidad de colisión sigue siendo despreciable a la escala de una
// conversación (ver la nota sobre el cumpleaños más abajo).
//
// ── POR QUÉ P-256 Y NO X25519 ──────────────────────────────────────────────
// X25519 es mejor curva y aún no está en todos los navegadores que Darma tiene
// que soportar. P-256 lleva años en WebCrypto en todos ellos. Una curva
// excelente que falla en el móvil de alguien no cifra nada.
//
// ── EL ÚNICO FALLO QUE ROMPE ESTO POR COMPLETO ─────────────────────────────
// Reutilizar un nonce con la misma clave en GCM revela el XOR de los dos textos
// y permite FALSIFICAR mensajes. Por eso el nonce es siempre
// `crypto.getRandomValues(new Uint8Array(12))` y NUNCA un contador, ni el id del
// mensaje, ni nada derivado. En un PR eso parece una optimización inocente
// («ahorramos 12 bytes por fila»); es el fin del cifrado.
//
// Sobre la colisión de nonces: con 96 bits aleatorios y la misma clave, la
// probabilidad de repetir uno se acerca a 2^-32 alrededor de los 2^32 mensajes.
// Un refugio de 8 personas no llega a cuatro mil millones de mensajes, y si
// alguna vez se acercara, la salida es rotar la clave de sala, no alargar el
// nonce (que el esquema no permite en AES-GCM).
// ============================================================================

import type { MensajeCifrado, MensajeDescifrado, SobreCifrado } from './tipos.ts'
import { base64ABytes, bytesABase64, bytesATexto, textoABytes } from './base64.ts'
import { huella } from './huella.ts'

export { canonicalizarJwk, huella, numeroSeguridad } from './huella.ts'
export {
  crearFraseRecuperacion,
  crearFraseRecuperacionSincrona,
  fraseABytes,
  normalizarFrase,
  PALABRAS,
} from './frase.ts'
export * from './tipos.ts'
export { bytesABase64, base64ABytes, igualesEnTiempoConstante } from './base64.ts'

/** Versión del esquema de cifrado que escribe este cliente. Sube si algún día
 *  cambia el algoritmo; los mensajes viejos conservan la suya y se siguen
 *  leyendo. */
export const ENC_VERSION = 1

/** 12 bytes. Es lo que fija AES-GCM y lo que acepta el `check` de 0002. */
export const NONCE_BYTES = 12

/**
 * Etiqueta de contexto de HKDF. Ata la clave derivada a ESTE uso: si mañana se
 * derivara otra cosa del mismo secreto ECDH (una clave de firma, por ejemplo),
 * un `info` distinto garantiza que las dos claves no coinciden nunca.
 */
const INFO_KEK = textoABytes('darma:refuge-kek:v1')

function nonceAleatorio(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
}

// ── Identidad ───────────────────────────────────────────────────────────────

/**
 * Par ECDH P-256.
 *
 * `extraible` es `false` salvo en el instante único de crear la copia de
 * seguridad opt-in (`respaldo.ts`). Una `CryptoKey` no extraíble NO se puede
 * exfiltrar ni ejecutando JavaScript en la página: un XSS puede *usarla*
 * mientras la pestaña está abierta, pero no llevársela. Guardar la clave en
 * `localStorage`, que es texto plano, la regala con el primer XSS y para
 * siempre.
 */
export async function generarParIdentidad(extraible = false): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    extraible,
    ['deriveBits'],
  )
}

/** JWK pública + huella de un par. La privada no sale de aquí. */
export async function publicarIdentidad(par: CryptoKeyPair): Promise<{ publicJwk: JsonWebKey; fingerprint: string }> {
  const publicJwk = await crypto.subtle.exportKey('jwk', par.publicKey)
  // WebCrypto añade `ext` y `key_ops` al exportar. No forman parte de la
  // identidad de la clave y `canonicalizarJwk` los ignora, pero se quitan aquí
  // para que lo que se sube a `user_keys` sea exactamente lo que se hashea.
  const limpia: JsonWebKey = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }
  return { publicJwk: limpia, fingerprint: await huella(limpia) }
}

/**
 * Genera la identidad de este dispositivo y la deja lista para publicar.
 *
 * NO persiste nada: quien llama decide dónde va la privada (en la app, en
 * IndexedDB vía `almacen.ts`). Separarlo es lo que permite probar la
 * criptografía con `node --test`, donde IndexedDB no existe.
 */
export async function generarIdentidad(): Promise<{ publicJwk: JsonWebKey; fingerprint: string; par: CryptoKeyPair }> {
  const par = await generarParIdentidad(false)
  const { publicJwk, fingerprint } = await publicarIdentidad(par)
  return { publicJwk, fingerprint, par }
}

/** Importa la JWK pública de otra persona para derivar con ella. */
export async function importarClavePublica(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
}

// ── Clave del refugio ───────────────────────────────────────────────────────

/**
 * Clave simétrica de una sala. `extractable: true` porque hay que exportarla
 * para envolverla en un sobre por miembro, que es la única forma de que la
 * conversación sea legible para más de una persona sin que el servidor la vea.
 *
 * Solo la clave de IDENTIDAD es no extraíble, y esa es la que importa: quien
 * roba una clave de sala roba esa sala; quien roba la identidad roba todas y
 * puede suplantar a la persona en las futuras.
 */
export async function crearClaveRefugio(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

/**
 * ECDH + HKDF → KEK AES-256.
 *
 * La SAL de HKDF es el propio `nonce` del sobre. No es un truco: la sal de HKDF
 * no tiene que ser secreta, solo distinta, y usar el nonce hace que cada sobre
 * tenga un KEK propio aunque el par de personas sea el mismo. El efecto es que
 * ni siquiera una reutilización accidental de nonce entre dos sobres del mismo
 * par sería explotable — la clave también sería otra.
 */
async function derivarKek(
  privada: CryptoKey,
  jwkOtro: JsonWebKey,
  sal: Uint8Array,
): Promise<CryptoKey> {
  const publica = await importarClavePublica(jwkOtro)
  const compartido = await crypto.subtle.deriveBits({ name: 'ECDH', public: publica }, privada, 256)
  const material = await crypto.subtle.importKey('raw', compartido, 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: sal as BufferSource, info: INFO_KEK as BufferSource },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Envuelve la clave del refugio para una persona concreta. */
export async function envolverParaMiembro(
  claveRefugio: CryptoKey,
  jwkDestino: JsonWebKey,
  privadaEmisor: CryptoKey,
): Promise<{ wrappedKeyB64: string; wrapNonceB64: string }> {
  const nonce = nonceAleatorio()
  const kek = await derivarKek(privadaEmisor, jwkDestino, nonce)

  const bruta = await crypto.subtle.exportKey('raw', claveRefugio)
  const envuelta = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, kek, bruta)

  return {
    wrappedKeyB64: bytesABase64(new Uint8Array(envuelta)),
    wrapNonceB64: bytesABase64(nonce),
  }
}

/**
 * Abre un sobre y devuelve la clave del refugio.
 *
 * LANZA si el sobre no es para ti, si lo envolvió otra persona o si está
 * manipulado: el tag de GCM no cuadra y `decrypt` rechaza. No hay ningún camino
 * en el que devuelva una clave equivocada en silencio, y esa es la propiedad
 * que hace que la prueba nº 4 de la ficha valga de algo.
 *
 * @param extraible `true` SOLO cuando hay que reenvolver la clave para invitar
 *        a alguien más. En el camino de lectura del hilo se queda en `false`.
 */
export async function abrirSobre(
  sobre: SobreCifrado,
  jwkEmisor: JsonWebKey,
  privadaReceptor: CryptoKey,
  opciones: { extraible?: boolean } = {},
): Promise<CryptoKey> {
  const nonce = base64ABytes(sobre.wrapNonceB64)
  const kek = await derivarKek(privadaReceptor, jwkEmisor, nonce)

  const bruta = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    kek,
    base64ABytes(sobre.wrappedKeyB64) as BufferSource,
  )

  return crypto.subtle.importKey(
    'raw',
    bruta,
    { name: 'AES-GCM', length: 256 },
    opciones.extraible === true,
    ['encrypt', 'decrypt'],
  )
}

// ── Mensajes ────────────────────────────────────────────────────────────────

/**
 * Cifra un mensaje. Nonce nuevo y aleatorio SIEMPRE.
 *
 * El `ciphertext` que sale ya lleva dentro el tag de autenticación de 16 bytes:
 * por eso una manipulación de un solo bit hace fallar el descifrado en vez de
 * producir texto distinto.
 */
export async function cifrar(
  clave: CryptoKey,
  texto: string,
): Promise<{ ciphertextB64: string; nonceB64: string }> {
  const nonce = nonceAleatorio()
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    clave,
    textoABytes(texto) as BufferSource,
  )
  return { ciphertextB64: bytesABase64(new Uint8Array(cifrado)), nonceB64: bytesABase64(nonce) }
}

/** Descifra. Lanza si la clave no es la correcta o si el mensaje está tocado. */
export async function descifrar(
  clave: CryptoKey,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string> {
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ABytes(nonceB64) as BufferSource },
    clave,
    base64ABytes(ciphertextB64) as BufferSource,
  )
  return bytesATexto(new Uint8Array(claro))
}

/**
 * Descifra una página entera en paralelo.
 *
 * `Promise.all` y no un `await` dentro del render: cincuenta descifrados en
 * serie dentro de un componente son cincuenta re-renders y una pantalla que
 * aparece a trozos. Aquí se resuelven todos y la lista se pinta una vez.
 *
 * Con `clave === null` (todavía no hay sobre, o es un dispositivo nuevo) NO
 * falla: devuelve los mensajes con `texto: null` e `ilegiblePorClave: true`,
 * que es lo que la UI necesita para explicar la situación en vez de enseñar una
 * pantalla vacía que parece un error.
 */
export async function descifrarLote(
  clave: CryptoKey | null,
  mensajes: readonly MensajeCifrado[],
): Promise<MensajeDescifrado[]> {
  return Promise.all(
    mensajes.map(async (m): Promise<MensajeDescifrado> => {
      const base = {
        id: m.id,
        refugeId: m.refugeId,
        senderId: m.senderId,
        encVersion: m.encVersion,
        kind: m.kind,
        createdAt: m.createdAt,
      }

      if (clave === null) {
        return { ...base, texto: null, ilegiblePorClave: true }
      }
      // Un mensaje escrito con una versión de esquema que este cliente no
      // conoce se marca como ilegible en vez de intentar descifrarlo con las
      // reglas equivocadas.
      if (m.encVersion !== ENC_VERSION) {
        return { ...base, texto: null, ilegiblePorClave: true }
      }

      try {
        return { ...base, texto: await descifrar(clave, m.ciphertextB64, m.nonceB64), ilegiblePorClave: false }
      } catch {
        // Hay clave y aun así falla: el mensaje está corrupto o lo cifró otra
        // clave (alguien rotó). No es lo mismo que «no tengo la clave» y la UI
        // lo dice distinto.
        return { ...base, texto: null, ilegiblePorClave: false }
      }
    }),
  )
}
