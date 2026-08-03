// ============================================================================
// Verificación de recibos de Apple — SIEMPRE en el servidor
//
// ── POR QUÉ NUNCA SE CREE AL CLIENTE ────────────────────────────────────────
// El cliente manda un `transactionId`. Nada más. La cantidad de cristales la
// resuelve el servidor contra `catalogo.ts` a partir del `productId` que
// devuelve APPLE, no del que diga la app: un cliente parcheado manda el
// `transactionId` de un paquete de 1,09 € y el `productId` del de 24,99 €.
//
// ── EL FLUJO REAL ───────────────────────────────────────────────────────────
//  1. Se firma un JWT ES256 con la clave `.p8` de App Store Connect (`kid` en
//     la cabecera, `iss` = issuer id, `aud` = 'appstoreconnect-v1', `bid` =
//     bundle id). Caduca en 20 minutos: Apple rechaza los de más de 60.
//  2. `GET /inApps/v1/transactions/{transactionId}` en
//     api.storekit.itunes.apple.com (o el host de sandbox).
//  3. La respuesta trae `signedTransactionInfo`: un JWS firmado por Apple con
//     la cadena de certificados en `x5c`. Se verifica hasta la raíz **Apple
//     Root CA - G3**, cuya huella SHA-256 va en el entorno.
//  4. Se valida `bundleId`, `environment`, y que la transacción no esté
//     revocada (`revocationDate`) ni sea de un tipo que no vendemos.
//
// ── FAIL-CLOSED, Y NUNCA LANZA ──────────────────────────────────────────────
// Si algo falta, falla o es ambiguo → `valido: false` con un `motivo` que va al
// log y **jamás al cliente**. El cliente recibe `entrada_invalida` sin decirle
// por qué: el motivo describe nuestra validación, y eso es información sobre el
// sistema.
//
// 🔴 Aquí no se otorga karma. Se resuelve un `productId` y punto.
// ============================================================================

import { firmarJwt, verificarJwsConCadena, type Verificado } from './jws.ts'

export interface ReciboVerificado {
  valido: boolean
  /** `apple:<transactionId>`. Es la clave de idempotencia del ledger. */
  externalId: string | null
  /** `productId` de Apple. Se resuelve contra el catálogo, no se cree. */
  productId: string | null
  /** Por qué no es válido. NUNCA se envía al cliente. */
  motivo: string | null
}

/** Campos de `signedTransactionInfo` que nos importan. */
export interface TransaccionApple {
  transactionId?: string
  originalTransactionId?: string
  bundleId?: string
  productId?: string
  type?: string
  environment?: 'Sandbox' | 'Production'
  revocationDate?: number
  revocationReason?: number
  purchaseDate?: number
  /**
   * uuid que la app adjunta a la compra y que nosotros ponemos igual al
   * `profiles.id`. Es la ÚNICA forma de saber a quién acreditar en un webhook,
   * que llega sin sesión desde una máquina de Apple.
   */
  appAccountToken?: string
}

export interface ConfigApple {
  issuerId: string
  keyId: string
  /** Contenido del `.p8`. NUNCA con prefijo NEXT_PUBLIC_. */
  privateKeyPem: string
  bundleId: string
  /** Huellas SHA-256 de las raíces de confianza (Apple Root CA - G3). */
  huellasRaiz: readonly string[]
  entorno: 'Sandbox' | 'Production'
}

const HOST_PRODUCCION = 'https://api.storekit.itunes.apple.com'
const HOST_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com'

function noValido(motivo: string): ReciboVerificado {
  return { valido: false, externalId: null, productId: null, motivo }
}

/**
 * Lee la configuración del entorno. Devuelve `null` si falta algo, y eso
 * significa "no verificar nada" (fail-closed), no "aceptar todo".
 *
 * Las cuatro variables son secretas y ninguna lleva `NEXT_PUBLIC_`: ese prefijo
 * es exactamente lo que haría que Next las inlineara en el bundle de cliente.
 */
export function configApple(env: NodeJS.ProcessEnv = process.env): ConfigApple | null {
  const issuerId = env.APPLE_IAP_ISSUER_ID
  const keyId = env.APPLE_IAP_KEY_ID
  const privateKeyPem = env.APPLE_IAP_PRIVATE_KEY
  const bundleId = env.APPLE_BUNDLE_ID
  const huellas = (env.APPLE_ROOT_CA_SHA256 ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)

  if (!issuerId || !keyId || !privateKeyPem || !bundleId || huellas.length === 0) return null

  return {
    issuerId,
    keyId,
    // En un `.env` los saltos de línea de un PEM viajan escapados.
    privateKeyPem: privateKeyPem.replace(/\\n/g, '\n'),
    bundleId,
    huellasRaiz: huellas,
    entorno: env.APPLE_IAP_ENTORNO === 'Sandbox' ? 'Sandbox' : 'Production',
  }
}

/** JWT de autenticación ante la App Store Server API. 20 min de vida. */
export function tokenApple(config: ConfigApple, ahoraSegundos = Math.floor(Date.now() / 1000)): string | null {
  return firmarJwt(
    { kid: config.keyId },
    {
      iss: config.issuerId,
      iat: ahoraSegundos,
      exp: ahoraSegundos + 20 * 60,
      aud: 'appstoreconnect-v1',
      bid: config.bundleId,
    },
    config.privateKeyPem,
    'ES256',
  )
}

/**
 * Comprueba una transacción ya decodificada. Función PURA: es donde vive la
 * política y por eso se puede probar sin red ni clave.
 */
export function evaluarTransaccion(
  transaccion: TransaccionApple,
  config: Pick<ConfigApple, 'bundleId' | 'entorno'>,
): ReciboVerificado {
  if (!transaccion.transactionId) return noValido('transacción sin transactionId')
  if (transaccion.bundleId !== config.bundleId) return noValido('bundleId ajeno')
  if (transaccion.environment !== config.entorno) {
    // Un recibo de sandbox acreditado en producción es dinero de mentira
    // convertido en cristales de verdad.
    return noValido(`entorno inesperado: ${String(transaccion.environment)}`)
  }
  if (transaccion.revocationDate != null) return noValido('transacción reembolsada')
  if (transaccion.type != null && transaccion.type !== 'Consumable') {
    return noValido(`tipo no vendible: ${transaccion.type}`)
  }
  if (!transaccion.productId) return noValido('transacción sin productId')

  return {
    valido: true,
    externalId: `apple:${transaccion.transactionId}`,
    productId: transaccion.productId,
    motivo: null,
  }
}

/**
 * Verifica el JWS que manda Apple (respuesta de la API o `signedPayload` del
 * webhook V2) contra la cadena de certificados y la raíz de confianza.
 */
export function verificarJwsApple(jws: string, config: ConfigApple): Verificado<TransaccionApple> {
  return verificarJwsConCadena<TransaccionApple>(jws, config.huellasRaiz)
}

/**
 * Verificación completa de un `transactionId`. **No lanza nunca.**
 *
 * @param token `transactionId` que manda la app tras completar la compra.
 */
export async function verificarRecibo(
  token: string,
  config: ConfigApple | null = configApple(),
): Promise<ReciboVerificado> {
  if (!config) return noValido('Apple IAP sin configurar')
  if (!token || !/^[0-9A-Za-z._-]{1,64}$/.test(token)) return noValido('transactionId con forma inválida')

  const jwt = tokenApple(config)
  if (!jwt) return noValido('no se ha podido firmar el JWT de la App Store Server API')

  const host = config.entorno === 'Sandbox' ? HOST_SANDBOX : HOST_PRODUCCION

  let cuerpo: { signedTransactionInfo?: string }
  try {
    const respuesta = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    })
    if (!respuesta.ok) return noValido(`App Store Server API ${respuesta.status}`)
    cuerpo = (await respuesta.json()) as { signedTransactionInfo?: string }
  } catch (causa) {
    return noValido(`fallo de red contra Apple: ${causa instanceof Error ? causa.message : 'desconocido'}`)
  }

  if (!cuerpo.signedTransactionInfo) return noValido('respuesta sin signedTransactionInfo')

  const verificado = verificarJwsApple(cuerpo.signedTransactionInfo, config)
  if (!verificado.ok || !verificado.payload) return noValido(verificado.motivo ?? 'JWS no verificado')

  return evaluarTransaccion(verificado.payload, config)
}

/**
 * Historial de transacciones de un usuario, para `POST /api/billing/restore`.
 *
 * Se apoya en el `originalTransactionId`, que es el único identificador estable
 * que sobrevive a una reinstalación. Sin restauración, quien reinstala pierde
 * lo que pagó y pide un reembolso con toda la razón.
 */
export async function historialTransacciones(
  originalTransactionId: string,
  config: ConfigApple | null = configApple(),
): Promise<ReciboVerificado[]> {
  if (!config) return []

  const jwt = tokenApple(config)
  if (!jwt) return []

  const host = config.entorno === 'Sandbox' ? HOST_SANDBOX : HOST_PRODUCCION

  try {
    const respuesta = await fetch(
      `${host}/inApps/v1/history/${encodeURIComponent(originalTransactionId)}?productType=CONSUMABLE`,
      { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' },
    )
    if (!respuesta.ok) return []

    const cuerpo = (await respuesta.json()) as { signedTransactions?: string[] }
    const firmadas = Array.isArray(cuerpo.signedTransactions) ? cuerpo.signedTransactions : []

    return firmadas
      .map((jws) => {
        const verificado = verificarJwsApple(jws, config)
        if (!verificado.ok || !verificado.payload) return noValido(verificado.motivo ?? 'JWS no verificado')
        return evaluarTransaccion(verificado.payload, config)
      })
      .filter((r) => r.valido)
  } catch {
    return []
  }
}
