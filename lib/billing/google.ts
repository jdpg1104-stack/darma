// ============================================================================
// Verificación de compras de Google Play — SIEMPRE en el servidor
//
// ── EL FLUJO REAL ───────────────────────────────────────────────────────────
//  1. Se firma un JWT RS256 con la clave de la cuenta de servicio y se cambia
//     por un access token OAuth2 (`urn:ietf:params:oauth:grant-type:jwt-bearer`),
//     con el scope `androidpublisher`.
//  2. `purchases.products.get(packageName, productId, purchaseToken)`.
//  3. Se exige `purchaseState === 0` (comprado). `1` es cancelado y `2`
//     pendiente: ninguno de los dos se acredita.
//  4. **`purchases.products.acknowledge` TRAS acreditar.** Sin acknowledge en
//     3 días, Google revierte el cobro automáticamente y la persona se queda
//     los cristales gratis. Es la trampa específica de Google y por eso el
//     acknowledge no es opcional ni "para luego".
//
// ── EL ORDEN IMPORTA ────────────────────────────────────────────────────────
// Se acredita PRIMERO y se hace acknowledge DESPUÉS. Al revés, un fallo entre
// el acknowledge y la acreditación deja a la persona pagando sin recibir nada y
// sin reembolso automático. En el orden correcto, el peor caso es un
// acknowledge que no llega: Google reembolsa, y el `refund` entra por el ledger
// como un apunte inverso. Se prefiere perder dinero nosotros a perderlo la
// persona.
//
// ── FAIL-CLOSED, Y NUNCA LANZA ──────────────────────────────────────────────
// Igual que `apple.ts`: `{ valido: false, motivo }`, motivo al log y nunca al
// cliente.
//
// ── VERIFICAR NO ES ATRIBUIR ────────────────────────────────────────────────
// `purchaseState === 0` dice «esta compra existió y se pagó». No dice de quién
// es. Quien tenga un `purchaseToken` ajeno podía reclamarlo en su cuenta, igual
// que pasaba con Apple. Por eso la compra sale de aquí con su `cuentaApp`
// (`obfuscatedExternalAccountId`) y las rutas la pasan por `comprobarTitular()`.
//
// La POLÍTICA ante un titular AUSENTE es distinta de la de Apple, y a propósito:
// allí «ausente» no acredita en `restore`; aquí sí. El motivo está escrito en
// `restore/route.ts`, porque es una decisión de ruta y no de este módulo — en
// resumen: el webhook de Google se NIEGA a acreditar sin ese id y manda a la
// persona a `restore`, así que cerrar ahí también dejaría su dinero sin destino.
// ============================================================================

import { firmarJwt, obtenerJwks, verificarConJwks, vigente } from './jws.ts'
import type { ReciboRestaurable, ReciboVerificado } from './apple.ts'

export type { ReciboVerificado }

export interface ConfigGoogle {
  packageName: string
  clientEmail: string
  privateKeyPem: string
  /** Cuenta de servicio autorizada a publicar en el topic de Pub/Sub. */
  pubsubServiceAccount: string
  /** Audiencia OIDC configurada en la suscripción push de Pub/Sub. */
  pubsubAudiencia: string
}

const URL_TOKEN = 'https://oauth2.googleapis.com/token'
const URL_ANDROIDPUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const URL_JWKS_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

function noValido(motivo: string): ReciboRestaurable {
  return { valido: false, externalId: null, productId: null, motivo, cuentaApp: null }
}

export function configGoogle(env: NodeJS.ProcessEnv = process.env): ConfigGoogle | null {
  const packageName = env.GOOGLE_PLAY_PACKAGE
  const clientEmail = env.GOOGLE_PLAY_CLIENT_EMAIL
  const privateKeyPem = env.GOOGLE_PLAY_PRIVATE_KEY
  const pubsubServiceAccount = env.GOOGLE_PUBSUB_SERVICE_ACCOUNT
  const pubsubAudiencia = env.GOOGLE_PUBSUB_AUDIENCE

  if (!packageName || !clientEmail || !privateKeyPem || !pubsubServiceAccount || !pubsubAudiencia) {
    return null
  }

  return {
    packageName,
    clientEmail,
    privateKeyPem: privateKeyPem.replace(/\\n/g, '\n'),
    pubsubServiceAccount,
    pubsubAudiencia,
  }
}

// ── Access token OAuth2, cacheado ───────────────────────────────────────────
// La caché no es una optimización: cada verificación pediría un token nuevo y
// Google limita ese endpoint mucho antes que el de compras.
interface CacheToken {
  token: string
  expiraEn: number
}
let cacheToken: CacheToken | null = null

/** Vacía la caché del access token. Solo para tests. */
export function __resetCacheToken(): void {
  cacheToken = null
}

export async function accessToken(config: ConfigGoogle): Promise<string | null> {
  if (cacheToken && cacheToken.expiraEn > Date.now()) return cacheToken.token

  const ahora = Math.floor(Date.now() / 1000)
  const aserto = firmarJwt(
    {},
    { iss: config.clientEmail, scope: SCOPE, aud: URL_TOKEN, iat: ahora, exp: ahora + 3600 },
    config.privateKeyPem,
    'RS256',
  )
  if (!aserto) return null

  try {
    const respuesta = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: aserto,
      }),
      cache: 'no-store',
    })
    if (!respuesta.ok) return null

    const cuerpo = (await respuesta.json()) as { access_token?: string; expires_in?: number }
    if (!cuerpo.access_token) return null

    // 60 s de margen para no usar un token que caduca en vuelo.
    cacheToken = {
      token: cuerpo.access_token,
      expiraEn: Date.now() + Math.max(60, (cuerpo.expires_in ?? 3600) - 60) * 1000,
    }
    return cacheToken.token
  } catch {
    return null
  }
}

/** Respuesta de `purchases.products.get` — solo lo que nos importa. */
export interface CompraGoogle {
  orderId?: string
  purchaseState?: number
  consumptionState?: number
  acknowledgementState?: number
  purchaseTimeMillis?: string
  /**
   * A quién dice Google que pertenece la compra. Lo fija la app al lanzar el
   * flujo de pago (`setObfuscatedAccountId`) con el `profiles.id`, y Google lo
   * devuelve tal cual: es el equivalente del `appAccountToken` de Apple.
   */
  obfuscatedExternalAccountId?: string
}

/**
 * Política sobre una compra ya obtenida. Función PURA, probable sin red.
 *
 * `purchaseState`: 0 comprado · 1 cancelado · 2 pendiente. Solo el 0 acredita;
 * el 2 llegará otra vez cuando se confirme, y acreditarlo ahora sería regalar
 * cristales por un pago que puede no completarse nunca.
 */
export function evaluarCompra(compra: CompraGoogle, productId: string): ReciboRestaurable {
  if (compra.purchaseState !== 0) return noValido(`purchaseState ${String(compra.purchaseState)}`)
  if (!compra.orderId) return noValido('compra sin orderId')

  return {
    valido: true,
    externalId: `google:${compra.orderId}`,
    productId,
    motivo: null,
    // Sale de la MISMA respuesta que ya se está leyendo. Antes se descartaba
    // aquí, y el webhook tenía que pedir la compra a Google POR SEGUNDA VEZ solo
    // para recuperarlo; peor aún, ni `verify` ni `restore` lo pedían nunca, así
    // que el camino de Google acreditaba sin comprobar de quién era la compra.
    cuentaApp: compra.obfuscatedExternalAccountId ?? null,
  }
}

/**
 * Verificación completa. **No lanza nunca.**
 *
 * @param token `<productId>|<purchaseToken>` — la app manda las dos cosas,
 *              porque la API de Google las exige juntas. El `productId` se
 *              resuelve DESPUÉS contra el catálogo: si no está, no se acredita.
 */
export async function verificarRecibo(
  token: string,
  config: ConfigGoogle | null = configGoogle(),
): Promise<ReciboRestaurable> {
  if (!config) return noValido('Google Play sin configurar')

  const separador = token.indexOf('|')
  if (separador <= 0) return noValido('token sin la forma productId|purchaseToken')

  const productId = token.slice(0, separador)
  const purchaseToken = token.slice(separador + 1)
  if (!productId || !purchaseToken) return noValido('token incompleto')

  const acceso = await accessToken(config)
  if (!acceso) return noValido('no se ha podido obtener el access token de Google')

  try {
    const url =
      `${URL_ANDROIDPUBLISHER}/${encodeURIComponent(config.packageName)}` +
      `/purchases/products/${encodeURIComponent(productId)}` +
      `/tokens/${encodeURIComponent(purchaseToken)}`

    const respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${acceso}` },
      cache: 'no-store',
    })
    if (!respuesta.ok) return noValido(`androidpublisher ${respuesta.status}`)

    return evaluarCompra((await respuesta.json()) as CompraGoogle, productId)
  } catch (causa) {
    return noValido(`fallo de red contra Google: ${causa instanceof Error ? causa.message : 'desconocido'}`)
  }
}

/**
 * `purchases.products.acknowledge`. **Se llama SIEMPRE tras acreditar.**
 *
 * Devuelve `true`/`false` y no lanza: el fallo se registra y se reintenta, pero
 * nunca revierte una acreditación ya hecha. Ver "EL ORDEN IMPORTA" arriba.
 */
export async function confirmarCompra(
  productId: string,
  purchaseToken: string,
  config: ConfigGoogle | null = configGoogle(),
): Promise<boolean> {
  if (!config) return false

  const acceso = await accessToken(config)
  if (!acceso) return false

  try {
    const url =
      `${URL_ANDROIDPUBLISHER}/${encodeURIComponent(config.packageName)}` +
      `/purchases/products/${encodeURIComponent(productId)}` +
      `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`

    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    return respuesta.ok
  } catch {
    return false
  }
}

// ── Pub/Sub: verificación de la firma del webhook ───────────────────────────

export interface TokenPubSub {
  iss?: string
  aud?: string
  email?: string
  email_verified?: boolean
  exp?: number
  iat?: number
}

/**
 * Verifica el token OIDC que Pub/Sub pone en `Authorization: Bearer`.
 *
 * Sin esto, `/api/billing/webhook/google` es una API pública para regalarse
 * cristales: cualquiera puede POSTear un mensaje con la forma de Pub/Sub. Se
 * comprueban las cuatro cosas que importan: firma contra el JWKS de Google,
 * emisor, audiencia (la que configuramos en la suscripción push) y que el
 * correo sea EXACTAMENTE la cuenta de servicio autorizada.
 */
export async function verificarTokenPubSub(
  bearer: string | null | undefined,
  config: ConfigGoogle | null = configGoogle(),
): Promise<{ ok: boolean; motivo: string | null }> {
  if (!config) return { ok: false, motivo: 'Google Pub/Sub sin configurar' }
  if (!bearer) return { ok: false, motivo: 'sin cabecera Authorization' }

  const jwt = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : bearer.trim()
  if (!jwt) return { ok: false, motivo: 'Authorization vacío' }

  const claves = await obtenerJwks(URL_JWKS_GOOGLE)
  if (!claves) return { ok: false, motivo: 'JWKS de Google inalcanzable' }

  const verificado = verificarConJwks<TokenPubSub>(jwt, claves)
  if (!verificado.ok || !verificado.payload) {
    return { ok: false, motivo: verificado.motivo ?? 'firma no verificada' }
  }

  const cuerpo = verificado.payload
  if (!vigente(cuerpo)) return { ok: false, motivo: 'token caducado o del futuro' }
  if (cuerpo.iss !== 'https://accounts.google.com') return { ok: false, motivo: `iss inesperado: ${String(cuerpo.iss)}` }
  if (cuerpo.aud !== config.pubsubAudiencia) return { ok: false, motivo: 'audiencia inesperada' }
  if (cuerpo.email !== config.pubsubServiceAccount) return { ok: false, motivo: 'cuenta de servicio ajena' }
  if (cuerpo.email_verified !== true) return { ok: false, motivo: 'correo no verificado' }

  return { ok: true, motivo: null }
}

/** Sobre de Pub/Sub: el mensaje real va en base64 dentro de `message.data`. */
export interface NotificacionPlay {
  version?: string
  packageName?: string
  eventTimeMillis?: string
  oneTimeProductNotification?: {
    version?: string
    notificationType?: number
    purchaseToken?: string
    sku?: string
  }
  voidedPurchaseNotification?: {
    purchaseToken?: string
    orderId?: string
    productType?: number
    refundType?: number
  }
}

/** Extrae la notificación del sobre. `null` ante cualquier forma inesperada. */
export function extraerNotificacion(cuerpo: unknown): NotificacionPlay | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const mensaje = (cuerpo as { message?: { data?: unknown } }).message
  if (!mensaje || typeof mensaje.data !== 'string') return null
  try {
    return JSON.parse(Buffer.from(mensaje.data, 'base64').toString('utf8')) as NotificacionPlay
  } catch {
    return null
  }
}
