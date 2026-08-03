// ============================================================================
// TOTP (RFC 6238) a mano, con node:crypto
//
// ⛔ SOLO SERVIDOR. Lee `TOTP_ENC_KEY`. Guarda de runtime abajo.
//
// ── POR QUÉ A MANO Y NO CON UNA LIBRERÍA ───────────────────────────────────
// TOTP son cuarenta líneas: un HMAC-SHA1 sobre un contador de 8 bytes y una
// truncación dinámica. Una dependencia nueva en el camino de autenticación
// añade superficie de suministro (cada actualización es código de terceros que
// se ejecuta junto a la clave de cifrado) a cambio de ahorrar un archivo que
// no va a cambiar nunca, porque el RFC es de 2011 y está cerrado.
//
// ── PARÁMETROS, Y POR QUÉ ESTOS ────────────────────────────────────────────
// SHA-1, 6 dígitos, ventana de 30 s. SHA-1 no es una elección de seguridad
// sino de interoperabilidad: Google Authenticator, Authy, 1Password y el
// gestor del sistema asumen SHA-1 cuando el URI no dice otra cosa, y un
// segundo factor que la mitad de la gente no consigue configurar protege menos
// que uno que sí. El uso de SHA-1 aquí es como HMAC —resistente a colisiones
// no requerido—, que es exactamente el caso donde sigue siendo seguro.
//
// Tolerancia de ±1 paso (30 s antes, 30 s después) y NO más: cada paso extra
// multiplica por dos la ventana en la que un código robado sigue valiendo. Con
// ±1 el margen es de 90 segundos, suficiente para el desfase de reloj de un
// móvil y para que a alguien le dé tiempo a teclear.
//
// ── PARA QUIÉN ES ──────────────────────────────────────────────────────────
// Solo se ofrece a `profiles.level = 'mentor'`. Un mentor ve contenido en
// crisis de otras personas: su cuenta vale más que las demás y perderla no es
// solo su problema.
// ============================================================================

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

function guardaDeServidor(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[darma][SEGURIDAD] lib/auth/totp.ts se ha cargado en el NAVEGADOR. ' +
      'Este módulo lee TOTP_ENC_KEY y genera secretos de segundo factor.',
    )
  }
}

// ── Base32 (RFC 4648, sin relleno) ──────────────────────────────────────────
// Es el alfabeto que entienden las apps de autenticación. Sin `=` final porque
// varias implementaciones populares se atragantan con el relleno al escanear.

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function codificarBase32(bytes: Uint8Array): string {
  let bits = 0
  let valor = 0
  let salida = ''

  for (const byte of bytes) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31]

  return salida
}

export function decodificarBase32(texto: string): Buffer {
  // Se tolera minúscula, espacios y guiones porque la gente teclea el secreto a
  // mano cuando no puede escanear el QR.
  const limpio = texto.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')

  let bits = 0
  let valor = 0
  const bytes: number[] = []

  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter)
    if (indice < 0) throw new Error('secreto TOTP con un carácter fuera de base32')
    valor = (valor << 5) | indice
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

// ── El algoritmo ────────────────────────────────────────────────────────────

/** Duración de un paso, en segundos. RFC 6238 §5.2 recomienda 30. */
export const PASO_SEGUNDOS = 30
/** Dígitos del código. */
export const DIGITOS = 6
/** Pasos de tolerancia a cada lado. Ver cabecera: 1, y no más. */
export const TOLERANCIA_PASOS = 1

/**
 * Secreto nuevo: 20 bytes (160 bits, el tamaño del bloque de SHA-1, que es lo
 * que recomienda RFC 4226 §4) codificados en base32 → 32 caracteres.
 */
export function generarSecretoTotp(): string {
  guardaDeServidor()
  return codificarBase32(randomBytes(20))
}

function contadorPara(en: Date): Buffer {
  const pasos = Math.floor(en.getTime() / 1000 / PASO_SEGUNDOS)
  const buffer = Buffer.alloc(8)
  // BigInt para los 8 bytes: un contador de 32 bits se desbordaría en 2038 con
  // pasos de 1 s y, aunque con 30 s queda lejos, escribirlo bien cuesta lo mismo.
  buffer.writeBigUInt64BE(BigInt(pasos))
  return buffer
}

function codigoEnPaso(secreto: string, pasoOffset: number, en: Date): string {
  const contador = contadorPara(new Date(en.getTime() + pasoOffset * PASO_SEGUNDOS * 1000))
  const hmac = createHmac('sha1', decodificarBase32(secreto)).update(contador).digest()

  // Truncación dinámica (RFC 4226 §5.3): el nibble bajo del último byte dice
  // dónde empiezan los 4 bytes que se convierten en el código.
  const desplazamiento = hmac[hmac.length - 1]! & 0x0f
  const binario =
    ((hmac[desplazamiento]! & 0x7f) << 24) |
    ((hmac[desplazamiento + 1]! & 0xff) << 16) |
    ((hmac[desplazamiento + 2]! & 0xff) << 8) |
    (hmac[desplazamiento + 3]! & 0xff)

  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

/** Código válido en el instante `en` (por defecto, ahora). */
export function codigoTotp(secreto: string, en: Date = new Date()): string {
  return codigoEnPaso(secreto, 0, en)
}

/**
 * ¿Es `codigo` válido para `secreto` en el instante `en`?
 *
 * Comparación en tiempo constante: comparar con `===` filtra por temporización
 * cuántos dígitos iniciales acertó quien prueba, y eso convierte un espacio de
 * un millón en seis espacios de diez.
 */
export function verificarTotp(secreto: string, codigo: string, en: Date = new Date()): boolean {
  const candidato = codigo.trim().replace(/\s/g, '')
  if (!/^\d+$/.test(candidato) || candidato.length !== DIGITOS) return false

  const esperadoBuffer = Buffer.from(candidato, 'utf8')
  let valido = false

  // Se recorren TODOS los pasos aunque ya haya coincidencia: salir antes
  // reintroduce por la puerta de atrás la fuga por temporización que la
  // comparación constante acaba de cerrar.
  for (let offset = -TOLERANCIA_PASOS; offset <= TOLERANCIA_PASOS; offset++) {
    const esperado = Buffer.from(codigoEnPaso(secreto, offset, en), 'utf8')
    if (esperado.length === esperadoBuffer.length && timingSafeEqual(esperado, esperadoBuffer)) {
      valido = true
    }
  }

  return valido
}

/**
 * URI `otpauth://` para el QR.
 *
 * ⚠️ La etiqueta lleva el ALIAS, nunca el email: el QR se pinta en pantalla y
 * acaba en capturas y en gestores de contraseñas. Meter ahí el correo
 * reintroduciría el identificador que toda la app se esfuerza en no tener.
 */
export function uriOtpauth(alias: string, secreto: string): string {
  const etiqueta = encodeURIComponent(`Darma:${alias}`)
  const parametros = new URLSearchParams({
    secret: secreto,
    issuer: 'Darma',
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  })
  return `otpauth://totp/${etiqueta}?${parametros.toString()}`
}

// ── Cifrado en reposo del secreto ───────────────────────────────────────────
// El secreto TOTP es equivalente a la contraseña del segundo factor: quien lea
// la tabla puede generar códigos válidos indefinidamente. Por eso `auth_totp`
// no tiene ninguna política RLS (solo service_role la ve) Y ADEMÁS el secreto
// va cifrado: son dos barreras independientes, y la segunda sigue en pie si un
// día se filtra un dump.
//
// Formato del blob: iv(12) ‖ tag(16) ‖ ciphertext. Se guarda todo junto en una
// sola columna `bytea` porque separar iv y tag en columnas distintas invita a
// que alguien recupere una y olvide la otra.

const LONGITUD_IV = 12
const LONGITUD_TAG = 16

function claveDeCifrado(): Buffer {
  const hex = process.env.TOTP_ENC_KEY
  if (!hex) {
    throw new Error(
      '[darma] Falta TOTP_ENC_KEY (32 bytes en hex, `openssl rand -hex 32`). ' +
      'Sin ella el segundo factor no se puede guardar cifrado.',
    )
  }
  const clave = Buffer.from(hex.trim(), 'hex')
  if (clave.length !== 32) {
    throw new Error('[darma] TOTP_ENC_KEY debe ser exactamente 32 bytes en hexadecimal (64 caracteres).')
  }
  return clave
}

export function cifrarSecretoTotp(secreto: string): Buffer {
  guardaDeServidor()
  const iv = randomBytes(LONGITUD_IV)
  const cifrador = createCipheriv('aes-256-gcm', claveDeCifrado(), iv)
  const cifrado = Buffer.concat([cifrador.update(secreto, 'utf8'), cifrador.final()])
  return Buffer.concat([iv, cifrador.getAuthTag(), cifrado])
}

export function descifrarSecretoTotp(blob: Buffer | Uint8Array): string {
  guardaDeServidor()
  const datos = Buffer.from(blob)
  if (datos.length <= LONGITUD_IV + LONGITUD_TAG) {
    throw new Error('blob de secreto TOTP truncado')
  }

  const iv = datos.subarray(0, LONGITUD_IV)
  const tag = datos.subarray(LONGITUD_IV, LONGITUD_IV + LONGITUD_TAG)
  const cifrado = datos.subarray(LONGITUD_IV + LONGITUD_TAG)

  const descifrador = createDecipheriv('aes-256-gcm', claveDeCifrado(), iv)
  descifrador.setAuthTag(tag)
  // Si el blob fue manipulado, `final()` lanza: AES-GCM autentica además de
  // cifrar, así que aquí no hace falta una comprobación de integridad aparte.
  return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8')
}

// ── Códigos de recuperación ─────────────────────────────────────────────────
// Diez códigos de un solo uso. Son la salida cuando alguien pierde el móvil, y
// en Darma esa salida importa más que en otras apps: perder la cuenta es perder
// el único sitio donde esa persona ha contado ciertas cosas.
//
// Se guardan HASHEADOS con scrypt (nunca en claro, ni cifrados: cifrado es
// reversible con la clave, y para verificar un código no hace falta poder
// recuperarlo). scrypt y no HMAC porque el espacio de un código es pequeño
// —40 bits— y un hash rápido lo recorre entero; el coste de memoria de scrypt
// es lo que hace inviable el barrido si un día se filtra la tabla.

export const NUMERO_CODIGOS_RECUPERACION = 10
/** Alfabeto sin caracteres que se confundan al leerlos en papel (0/O, 1/I/L). */
const ALFABETO_RECUPERACION = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LONGITUD_CODIGO = 8

/** Normaliza lo que teclea la persona: mayúsculas y sin separadores. */
export function normalizarCodigoRecuperacion(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Diez códigos nuevos, en claro. Se enseñan UNA vez y no se vuelven a mostrar. */
export function generarCodigosRecuperacion(): string[] {
  guardaDeServidor()
  const codigos: string[] = []

  for (let i = 0; i < NUMERO_CODIGOS_RECUPERACION; i++) {
    let codigo = ''
    // randomInt (CSPRNG) y no Math.random: un código de recuperación predecible
    // es una puerta trasera con aspecto de función de conveniencia.
    for (let j = 0; j < LONGITUD_CODIGO; j++) {
      codigo += ALFABETO_RECUPERACION[randomInt(ALFABETO_RECUPERACION.length)]
    }
    // Se presenta partido en dos para que se pueda copiar a mano sin perderse.
    codigos.push(`${codigo.slice(0, 4)}-${codigo.slice(4)}`)
  }

  return codigos
}

const SCRYPT_LONGITUD = 32

/** Hash almacenable de un código: `scrypt$<sal hex>$<hash hex>`. */
export function hashCodigoRecuperacion(codigo: string, salHex?: string): string {
  guardaDeServidor()
  const sal = salHex ?? randomBytes(16).toString('hex')
  const hash = scryptSync(normalizarCodigoRecuperacion(codigo), sal, SCRYPT_LONGITUD).toString('hex')
  return `scrypt$${sal}$${hash}`
}

export interface ResultadoRecuperacion {
  ok: boolean
  /** Los hashes que quedan. El código consumido YA NO ESTÁ: es lo que hace que
   *  un código usado no valga la segunda vez. */
  restantes: string[]
}

/**
 * Consume un código de recuperación.
 *
 * Devuelve la lista sin el código usado en vez de mutar la recibida: la lista
 * que se persiste es el valor devuelto, así que quien llama no puede
 * "verificar y olvidarse de guardar", que es como se convierte un código de un
 * solo uso en un código eterno.
 */
export function consumirCodigoRecuperacion(hashes: readonly string[], codigo: string): ResultadoRecuperacion {
  guardaDeServidor()
  const candidato = normalizarCodigoRecuperacion(codigo)
  if (candidato.length === 0) return { ok: false, restantes: [...hashes] }

  let indiceUsado = -1

  for (let i = 0; i < hashes.length; i++) {
    const partes = hashes[i]!.split('$')
    if (partes.length !== 3 || partes[0] !== 'scrypt') continue

    const recalculado = Buffer.from(scryptSync(candidato, partes[1]!, SCRYPT_LONGITUD))
    const guardado = Buffer.from(partes[2]!, 'hex')
    if (recalculado.length === guardado.length && timingSafeEqual(recalculado, guardado)) {
      indiceUsado = i
    }
  }

  if (indiceUsado < 0) return { ok: false, restantes: [...hashes] }

  return { ok: true, restantes: hashes.filter((_, i) => i !== indiceUsado) }
}
