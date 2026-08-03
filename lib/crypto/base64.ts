// ============================================================================
// B10 · Conversiones de bytes. Isomorfo: vale en el navegador y en node --test.
//
// Se escribe a mano y no con Buffer porque este módulo lo importa código con
// 'use client': `Buffer` no existe en el navegador y arrastrarlo por polyfill
// añadiría kilobytes al bundle de la pantalla más sensible de la app.
//
// El otro converso —hex— existe porque `bytea` viaja por PostgREST en el
// formato `\x48656c6c6f` de Postgres, mientras que la API de B10 habla base64.
// La frontera entre los dos formatos está AQUÍ y en ningún otro sitio.
// ============================================================================

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Índice inverso del alfabeto, para no hacer indexOf por carácter. */
const INVERSO: Readonly<Record<string, number>> = Object.fromEntries(
  [...ALFABETO].map((c, i) => [c, i]),
)

export function bytesABase64(bytes: Uint8Array): string {
  let salida = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]

    salida += ALFABETO[b0 >> 2]
    salida += ALFABETO[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)]
    salida += b1 === undefined ? '=' : ALFABETO[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)]
    salida += b2 === undefined ? '=' : ALFABETO[b2 & 0b111111]
  }
  return salida
}

/**
 * base64 → bytes. LANZA ante cualquier carácter fuera del alfabeto.
 *
 * Es deliberado que no sea tolerante: los tres sitios donde se usa reciben
 * datos de la red, y «tolerar» aquí significa descifrar basura y culpar luego a
 * la criptografía de un fallo que era un parámetro mal formado.
 */
export function base64ABytes(texto: string): Uint8Array {
  const limpio = texto.replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(limpio)) {
    throw new Error('base64 inválido')
  }

  const bytes = new Uint8Array(Math.floor((limpio.length * 6) / 8))
  let acumulador = 0
  let bits = 0
  let escritos = 0

  for (const caracter of limpio) {
    acumulador = (acumulador << 6) | INVERSO[caracter]
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[escritos++] = (acumulador >> bits) & 0xff
    }
  }
  return bytes
}

/** `\x48656c6c6f` de Postgres → bytes. Acepta también el hex pelado. */
export function hexPostgresABytes(texto: string): Uint8Array {
  const hex = texto.startsWith('\\x') ? texto.slice(2) : texto
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hex inválido')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** bytes → `\x48656c6c6f`, que es lo que PostgREST espera para una `bytea`. */
export function bytesAHexPostgres(bytes: Uint8Array): string {
  let salida = '\\x'
  for (const b of bytes) salida += b.toString(16).padStart(2, '0')
  return salida
}

export function base64AHexPostgres(b64: string): string {
  return bytesAHexPostgres(base64ABytes(b64))
}

export function hexPostgresABase64(hex: string): string {
  return bytesABase64(hexPostgresABytes(hex))
}

const CODIFICADOR = new TextEncoder()
const DECODIFICADOR = new TextDecoder()

export function textoABytes(texto: string): Uint8Array {
  return CODIFICADOR.encode(texto)
}

export function bytesATexto(bytes: Uint8Array): string {
  return DECODIFICADOR.decode(bytes)
}

/**
 * Comparación en tiempo constante de dos cadenas hex.
 *
 * Se usa para comparar huellas. `===` sobre strings sale antes en el primer
 * carácter distinto, y aunque una huella sea pública, acostumbrarse a comparar
 * material criptográfico con `===` es cómo acaba comparándose un tag de
 * autenticación con `===` en otro archivo dentro de seis meses.
 */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferencia = 0
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diferencia === 0
}
