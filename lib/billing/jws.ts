// ============================================================================
// Firma y verificación de JWS/JWT con `node:crypto` — sin dependencias nuevas
//
// POR QUÉ A MANO Y NO CON UNA LIBRERÍA: `jose` o `google-auth-library` harían
// esto en cuatro líneas, pero ninguna de las dos está en package.json y este
// bloque no puede añadir dependencias (no es su archivo). Lo que sí puede es
// usar `node:crypto`, que trae X509 y ECDSA/RSA de serie. Cuando F4 instale
// `jose`, este archivo se sustituye por seis líneas y no cambia nada más:
// todo el resto del bloque consume `verificarJws()` y `firmarJwt()`.
//
// ── LA REGLA DE ESTE ARCHIVO ────────────────────────────────────────────────
// **Ninguna función lanza.** Devuelven `{ ok: false, motivo }`. Un webhook que
// lanza produce un 5xx, y un 5xx le dice a Apple y a Google que reintenten
// durante días. El motivo se registra; nunca sale al cliente.
//
// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
// Si falta configuración (clave, raíz de confianza, JWKS inalcanzable) la
// respuesta es "no verificado", nunca "adelante". El valor por defecto seguro
// de este bloque es no dar cristales.
// ============================================================================

import { createPublicKey, createSign, createVerify, X509Certificate, createHash } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

export interface Verificado<T> {
  ok: boolean
  /** Cuerpo del token. Solo mirar si `ok`. */
  payload: T | null
  /** Por qué no vale. Va al log, NUNCA al cliente. */
  motivo: string | null
}

function fallo<T>(motivo: string): Verificado<T> {
  return { ok: false, payload: null, motivo }
}

function decodificarSegmento(segmento: string): unknown {
  return JSON.parse(Buffer.from(segmento, 'base64url').toString('utf8'))
}

interface CabeceraJws {
  alg?: string
  kid?: string
  x5c?: string[]
}

/** Lee la cabecera sin verificar nada. Solo para elegir clave o certificado. */
export function cabeceraDe(jws: string): CabeceraJws | null {
  const partes = jws.split('.')
  if (partes.length !== 3) return null
  try {
    return decodificarSegmento(partes[0]!) as CabeceraJws
  } catch {
    return null
  }
}

/**
 * Verifica la firma de un JWS con una clave pública ya elegida.
 *
 * `alg` se comprueba contra el esperado y NO se lee del token para decidir el
 * algoritmo: aceptar el `alg` que venga dentro es el fallo `alg: none` y la
 * confusión HS256/RS256, dos de las vulnerabilidades más repetidas de JWT.
 */
export function verificarJws<T>(
  jws: string,
  clavePublica: KeyObject,
  algEsperado: 'ES256' | 'RS256',
): Verificado<T> {
  const partes = jws.split('.')
  if (partes.length !== 3) return fallo('jws malformado')

  const [cabeceraB64, cuerpoB64, firmaB64] = partes as [string, string, string]

  let cabecera: CabeceraJws
  try {
    cabecera = decodificarSegmento(cabeceraB64) as CabeceraJws
  } catch {
    return fallo('cabecera ilegible')
  }
  if (cabecera.alg !== algEsperado) return fallo(`alg inesperado: ${String(cabecera.alg)}`)

  const verificador = createVerify(algEsperado === 'ES256' ? 'sha256' : 'RSA-SHA256')
  verificador.update(`${cabeceraB64}.${cuerpoB64}`)
  verificador.end()

  const firma = Buffer.from(firmaB64, 'base64url')
  const valida =
    algEsperado === 'ES256'
      ? verificador.verify({ key: clavePublica, dsaEncoding: 'ieee-p1363' }, firma)
      : verificador.verify(clavePublica, firma)

  if (!valida) return fallo('firma inválida')

  try {
    return { ok: true, payload: decodificarSegmento(cuerpoB64) as T, motivo: null }
  } catch {
    return fallo('cuerpo ilegible')
  }
}

/**
 * Verifica un JWS firmado con una cadena de certificados X.509 en `x5c`
 * (formato de Apple V2) y comprueba que la cadena llega hasta una raíz de
 * confianza cuya huella SHA-256 conocemos.
 *
 * SIN la comprobación de la raíz esto no verifica NADA: cualquiera puede
 * generar su propia cadena, firmar el payload que quiera y ponerla en `x5c`.
 * Un webhook sin verificación de firma es una API pública para regalarse
 * cristales.
 */
export function verificarJwsConCadena<T>(
  jws: string,
  huellasRaizConfiada: readonly string[],
): Verificado<T> {
  if (huellasRaizConfiada.length === 0) {
    // Fail-closed: sin raíz configurada no hay nada en lo que confiar.
    return fallo('sin raíz de confianza configurada')
  }

  const cabecera = cabeceraDe(jws)
  if (!cabecera) return fallo('cabecera ilegible')
  if (!Array.isArray(cabecera.x5c) || cabecera.x5c.length < 2) return fallo('x5c ausente o demasiado corto')

  let certificados: X509Certificate[]
  try {
    certificados = cabecera.x5c.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')))
  } catch {
    return fallo('x5c no contiene certificados válidos')
  }

  const ahora = Date.now()
  for (const cert of certificados) {
    const desde = Date.parse(cert.validFrom)
    const hasta = Date.parse(cert.validTo)
    if (Number.isFinite(desde) && ahora < desde) return fallo('certificado aún no válido')
    if (Number.isFinite(hasta) && ahora > hasta) return fallo('certificado caducado')
  }

  // Cada certificado tiene que estar firmado por el siguiente de la lista.
  for (let i = 0; i < certificados.length - 1; i += 1) {
    if (!certificados[i]!.verify(certificados[i + 1]!.publicKey)) {
      return fallo(`cadena rota en la posición ${i}`)
    }
  }

  const raiz = certificados[certificados.length - 1]!
  const huella = createHash('sha256').update(raiz.raw).digest('hex').toLowerCase()
  if (!huellasRaizConfiada.map((h) => h.toLowerCase().replace(/[^0-9a-f]/g, '')).includes(huella)) {
    return fallo('la raíz de la cadena no es de confianza')
  }

  return verificarJws<T>(jws, certificados[0]!.publicKey, 'ES256')
}

/**
 * Firma un JWT. Lo usan las dos tiendas para autenticarnos ANTE ELLAS:
 *   · Apple: ES256 con la clave `.p8` de App Store Connect.
 *   · Google: RS256 con la clave de la cuenta de servicio, para pedir un token
 *     OAuth2 en el flujo `urn:ietf:params:oauth:grant-type:jwt-bearer`.
 *
 * Devuelve `null` en vez de lanzar si la clave no es utilizable: el camino de
 * llamada trata "no he podido firmar" igual que "no he podido verificar", que
 * es no acreditar nada.
 */
export function firmarJwt(
  cabecera: Record<string, unknown>,
  cuerpo: Record<string, unknown>,
  clavePrivadaPem: string,
  alg: 'ES256' | 'RS256',
): string | null {
  try {
    const cabeceraB64 = Buffer.from(JSON.stringify({ ...cabecera, alg, typ: 'JWT' })).toString('base64url')
    const cuerpoB64 = Buffer.from(JSON.stringify(cuerpo)).toString('base64url')

    const firmador = createSign(alg === 'ES256' ? 'sha256' : 'RSA-SHA256')
    firmador.update(`${cabeceraB64}.${cuerpoB64}`)
    firmador.end()

    const firma =
      alg === 'ES256'
        ? firmador.sign({ key: clavePrivadaPem, dsaEncoding: 'ieee-p1363' })
        : firmador.sign(clavePrivadaPem)

    return `${cabeceraB64}.${cuerpoB64}.${firma.toString('base64url')}`
  } catch {
    return null
  }
}

// ── JWKS (Google) ───────────────────────────────────────────────────────────

interface ClaveJwk {
  kid?: string
  kty?: string
  n?: string
  e?: string
  alg?: string
}

interface CacheJwks {
  claves: ClaveJwk[]
  expiraEn: number
}

let cacheJwks: CacheJwks | null = null

/** Vacía la caché de JWKS. Solo para tests. */
export function __resetCacheJwks(): void {
  cacheJwks = null
}

/**
 * Descarga (y cachea) el JWKS de Google. La caché es obligatoria, no una
 * optimización: sin ella, cada notificación de Pub/Sub —que llegan a ráfagas—
 * dispara una petición HTTPS y Google acaba limitando la nuestra.
 */
export async function obtenerJwks(url: string, ttlSegundos = 3600): Promise<ClaveJwk[] | null> {
  if (cacheJwks && cacheJwks.expiraEn > Date.now()) return cacheJwks.claves

  try {
    const respuesta = await fetch(url, { cache: 'no-store' })
    if (!respuesta.ok) return null
    const cuerpo = (await respuesta.json()) as { keys?: ClaveJwk[] }
    if (!Array.isArray(cuerpo.keys)) return null
    cacheJwks = { claves: cuerpo.keys, expiraEn: Date.now() + ttlSegundos * 1000 }
    return cacheJwks.claves
  } catch {
    return null
  }
}

/** Verifica un JWT RS256 contra un JWKS, eligiendo la clave por `kid`. */
export function verificarConJwks<T>(jwt: string, claves: readonly ClaveJwk[]): Verificado<T> {
  const cabecera = cabeceraDe(jwt)
  if (!cabecera?.kid) return fallo('sin kid')

  const jwk = claves.find((k) => k.kid === cabecera.kid)
  if (!jwk) return fallo('kid desconocido')

  try {
    const clave = createPublicKey({ key: jwk as never, format: 'jwk' })
    return verificarJws<T>(jwt, clave, 'RS256')
  } catch {
    return fallo('jwk no utilizable')
  }
}

/** `exp`/`iat` en segundos, con margen de reloj. No se fía del reloj ajeno. */
export function vigente(cuerpo: { exp?: number; iat?: number }, margenSegundos = 60): boolean {
  const ahora = Math.floor(Date.now() / 1000)
  if (typeof cuerpo.exp === 'number' && ahora > cuerpo.exp + margenSegundos) return false
  if (typeof cuerpo.iat === 'number' && ahora + margenSegundos < cuerpo.iat) return false
  return true
}
