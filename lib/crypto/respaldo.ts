// ============================================================================
// B10 · La decisión difícil: qué pasa cuando alguien pierde el dispositivo
//
// ⚠️ ESTE ARCHIVO ES UNA DECISIÓN DE PRODUCTO ANTES QUE UNA DE CRIPTOGRAFÍA.
// Está escrito entero porque la alternativa —dejarla implícita— significa que
// alguien la resolverá dentro de seis meses con un «recuperar por email», y ese
// día el cifrado extremo a extremo de Darma pasará a ser decorativo.
//
// ── LA REGLA POR DEFECTO: PERDER EL MÓVIL ES PERDER EL HISTORIAL ───────────
// La clave de identidad vive SOLO en este dispositivo, como `CryptoKey` no
// extraíble en IndexedDB. Si el dispositivo se pierde, se rompe, se formatea o
// la persona borra los datos del navegador, esa clave no existe en ningún otro
// sitio del universo y las conversaciones anteriores quedan ilegibles.
//
// No hay recuperación por email, ni por soporte, ni por verificación de
// identidad, ni por «hemos comprobado que eres tú». Cualquiera de esas cosas
// exige que Darma tenga —o pueda obtener— la clave, y si Darma puede obtenerla:
//   · puede leer lo que la gente escribió en su peor noche;
//   · puede ser obligada a entregarlo;
//   · y un compromiso del servidor lo entrega todo de golpe.
// La promesa de la portada («aquí puedes contar lo que no has contado nunca»)
// no sobrevive a ninguna de las tres.
//
// ── LO QUE SÍ SE OFRECE: UNA COPIA, OPT-IN, CON FRASE ──────────────────────
// Desactivada por defecto. Quien la activa:
//   1. Recibe 12 palabras generadas EN SU DISPOSITIVO (`frase.ts`).
//   2. De esas palabras sale un KEK con PBKDF2-SHA256, ≥ 600 000 iteraciones y
//      sal aleatoria de 16 bytes.
//   3. Con ese KEK se envuelve la clave privada de identidad y el blob se sube
//      a `identity_backups`. Darma guarda el blob y la sal. La frase NO viaja
//      nunca, ni entera ni troceada, ni siquiera hasheada.
// En un dispositivo nuevo, la frase reconstruye el KEK, abre el blob y devuelve
// la identidad. Todo el historial vuelve a ser legible.
//
// ── EL PRECIO, DICHO EN VOZ ALTA EN LA PANTALLA ────────────────────────────
// Quien tenga la frase puede leer TODO el historial. Es la contrapartida exacta
// de que Darma no pueda: la frase ES la cuenta. Por eso la pantalla de
// activación (`components/refuge/DialogoFraseRecuperacion.tsx`) dice las tres
// cosas literalmente, sin eufemismos, ANTES de enseñar las palabras — y las
// dice igual de fuerte en inglés (`ADVERTENCIAS_RESPALDO`, al final de este
// archivo; las claves viven en `messages/es.json` y `messages/en.json`).
//
// ── POR QUÉ ACTIVARLA MÁS TARDE ROTA LA CLAVE ──────────────────────────────
// WebCrypto no puede volver extraíble una clave que se creó no extraíble — y
// eso es precisamente lo que la hace valiosa. Así que si la copia se activa
// después de haber usado la app, no hay forma de exportar la identidad que ya
// existe: hay que generar un par nuevo (con `key_version + 1`), respaldar ESE,
// y pedir a los miembros de cada refugio que reenvíen el sobre. Los mensajes
// nuevos se leen; los anteriores a la rotación, no.
//
// No es un fallo de implementación que convenga disimular: es la consecuencia
// honesta de no haber guardado nunca la clave donde se pudiera copiar. La UI lo
// dice antes de rotar, y por eso la copia se ofrece en el onboarding del primer
// refugio, cuando todavía no hay nada que perder.
// ============================================================================

import type { RespaldoIdentidad } from './tipos.ts'
import { base64ABytes, bytesABase64, textoABytes } from './base64.ts'
import { fraseABytes, normalizarFrase } from './frase.ts'
import { publicarIdentidad } from './index.ts'

/**
 * Suelo de iteraciones. El `check` de `identity_backups` en 0110_1 exige lo
 * mismo, así que un cliente viejo o manipulado no puede subir un backup débil:
 * la barrera está en el motor, no en esta constante.
 */
export const PBKDF2_ITERACIONES = 600_000

const SAL_BYTES = 16
const NONCE_BYTES = 12

/** KEK a partir de la frase. Lento a propósito: ese es todo el punto de PBKDF2. */
async function kekDesdeFrase(palabras: readonly string[], sal: Uint8Array, iteraciones: number): Promise<CryptoKey> {
  // Se derivan de los BYTES de la frase (12 bytes exactos), no del texto: así
  // el KEK no depende de si la persona separó las palabras con uno o dos
  // espacios, ni del formato en que se le presentaron.
  const semilla = fraseABytes(palabras)

  const material = await crypto.subtle.importKey('raw', semilla as BufferSource, 'PBKDF2', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Envuelve una identidad con la frase. La clave privada tiene que ser
 * EXTRAÍBLE, y ese es el único momento de su vida en que lo es.
 *
 * @param privadaExtraible clave privada ECDH creada con `extractable: true`.
 */
export async function crearRespaldo(
  privadaExtraible: CryptoKey,
  palabras: readonly string[],
): Promise<RespaldoIdentidad> {
  const sal = crypto.getRandomValues(new Uint8Array(SAL_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const kek = await kekDesdeFrase(palabras, sal, PBKDF2_ITERACIONES)

  const jwk = await crypto.subtle.exportKey('jwk', privadaExtraible)
  const envuelta = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    kek,
    textoABytes(JSON.stringify(jwk)) as BufferSource,
  )

  return {
    wrappedIdentityB64: bytesABase64(new Uint8Array(envuelta)),
    wrapNonceB64: bytesABase64(nonce),
    kdfSaltB64: bytesABase64(sal),
    kdfIterations: PBKDF2_ITERACIONES,
  }
}

/**
 * Recupera la identidad en un dispositivo nuevo.
 *
 * La clave privada se reimporta **no extraíble**: la copia de seguridad sigue
 * siendo la única forma de sacarla de un dispositivo, y para eso ya está la
 * frase que la persona guarda.
 *
 * LANZA UN ERROR GENÉRICO. Con una sola palabra cambiada falla y el mensaje no
 * dice cuál (prueba nº 6 de la ficha): decirlo convertiría la frase en doce
 * problemas de 256 opciones en vez de uno de 2^96.
 */
export async function abrirRespaldo(
  respaldo: RespaldoIdentidad,
  fraseEscrita: string,
): Promise<{ privada: CryptoKey; publicJwk: JsonWebKey; fingerprint: string }> {
  const palabras = normalizarFrase(fraseEscrita)

  let jwk: JsonWebKey
  try {
    const kek = await kekDesdeFrase(palabras, base64ABytes(respaldo.kdfSaltB64), respaldo.kdfIterations)
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ABytes(respaldo.wrapNonceB64) as BufferSource },
      kek,
      base64ABytes(respaldo.wrappedIdentityB64) as BufferSource,
    )
    jwk = JSON.parse(new TextDecoder().decode(claro)) as JsonWebKey
  } catch {
    // Un único mensaje para «la frase no está en la lista», «la frase es de
    // otra cuenta» y «el blob está corrupto». Distinguirlos ayudaría a quien
    // está probando frases, que no es la persona a la que queremos ayudar.
    throw new Error('No hemos podido abrir la copia con esa frase.')
  }

  const privada = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )

  // La pública se reconstruye desde la privada quitando `d`: así la huella que
  // se muestra al recuperar es la misma que veían los demás, y si no lo fuera
  // se notaría en el acto.
  const publicJwk: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
  const publica = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  const { fingerprint } = await publicarIdentidad({ privateKey: privada, publicKey: publica })

  return { privada, publicJwk, fingerprint }
}

/**
 * Las tres advertencias que la pantalla de activación DEBE mostrar antes de
 * enseñar la frase, por CLAVE de catálogo.
 *
 * Antes eran las cadenas en español escritas aquí. Ahora son claves porque la
 * app se sirve en dos idiomas, y una advertencia que solo existe en español no
 * es una advertencia para quien lee en inglés: es una pantalla de texto raro
 * justo antes de la decisión más cara de la app.
 *
 * Siguen viviendo aquí, y no dentro del componente, por el mismo motivo de
 * siempre: una prueba las vigila (`lib/crypto/frase.test.ts`). Lo que vigila
 * ahora es que las tres claves existan EN LOS DOS IDIOMAS y que ninguna de las
 * dos versiones se haya suavizado — decir «puede que se pierdan» donde pone
 * «borra tus conversaciones» convierte una advertencia en un matiz.
 *
 * El orden importa y es el de la ficha: primero el precio de tener la frase,
 * después que Darma no la puede recuperar, y por último lo que pasa sin copia.
 */
export const ADVERTENCIAS_RESPALDO: readonly string[] = [
  'refugios.respaldo.advertencias.historial',
  'refugios.respaldo.advertencias.irrecuperable',
  'refugios.respaldo.advertencias.sinCopia',
] as const
