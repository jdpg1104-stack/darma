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
// ── VERIFICAR NO ES ATRIBUIR ────────────────────────────────────────────────
// Una firma válida responde «esta compra existió y Apple la cobró». **No
// responde a quién acreditarla.** Durante un tiempo este archivo solo contestaba
// a la primera pregunta y `POST /api/billing/restore` daba la segunda por
// supuesta: acreditaba a la sesión CUALQUIER recibo que se le presentara.
//
// El `originalTransactionId` no es un secreto. Sale en capturas de pantalla que
// la gente pega en foros de soporte, en los correos de reembolso y en cualquier
// hilo de «no me han llegado los cristales». Quien tenga uno ajeno reclamaba esa
// compra EN SU CUENTA. Y el `unique(external_id)` del ledger NO tapa esto:
// impide cobrar dos veces, no impide atribuir mal. Peor todavía — en cuanto el
// atacante gana la carrera, esa misma idempotencia le cierra la puerta al dueño
// real, que ya no puede restaurar nada porque el apunte «ya existe».
//
// La respuesta a «de quién es» está en el propio recibo firmado:
// `appAccountToken`, el uuid que la app adjunta a la compra y que ponemos igual
// al `profiles.id`. Como viaja DENTRO del JWS firmado por Apple, no se puede
// falsificar sin la clave de Apple; y como se compara contra la sesión, tenerlo
// no basta: hay que ser esa persona. De ahí `comprobarTitular()` y
// `clasificarRestauracion()`, que son política pura y por eso viven aquí, junto
// a `evaluarTransaccion()`, y se prueban sin red ni clave.
//
// 🔴 Aquí no se otorga karma. Se resuelve un `productId` y punto.
// ============================================================================

import { createHash } from 'node:crypto'

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

/**
 * Un recibo de Apple **más a quién dice Apple que pertenece**.
 *
 * Se declara aparte y no como campo de `ReciboVerificado` porque `google.ts`
 * reutiliza esa interfaz y Google no tiene `appAccountToken` (su equivalente es
 * `obfuscatedExternalAccountId`, que hoy no se comprueba — ver el informe del
 * arreglo). Extenderla en vez de modificarla deja el otro camino intacto: un
 * `ReciboRestaurable` se puede usar donde se espere un `ReciboVerificado`.
 */
export interface ReciboRestaurable extends ReciboVerificado {
  /**
   * `appAccountToken` del recibo YA VERIFICADO, o `null` si el recibo no lo
   * trae. Viene de dentro del JWS firmado por Apple: no lo elige quien llama.
   */
  cuentaApp: string | null
}

/**
 * Resultado de comparar el titular de un recibo con la sesión.
 *
 *   · `coincide` — el recibo es de esta persona. Único caso que acredita.
 *   · `ajeno`    — el recibo declara OTRO titular. Es un intento de atribución
 *                  falsa: se rechaza la petición entera.
 *   · `ausente`  — el recibo no declara titular. Ni acusa ni autoriza.
 */
export type Titularidad = 'coincide' | 'ajeno' | 'ausente'

/**
 * ¿Es de quien lo presenta?
 *
 * ── EL CASO DIFÍCIL: `appAccountToken` AUSENTE ──────────────────────────────
 * Un recibo legítimo puede no traerlo: compras hechas antes de que la app
 * empezara a enviarlo, o un cliente que no lo puso. Las dos salidas obvias son
 * malas y conviene decirlo entero:
 *
 *   · Aceptar lo que no lo trae deja el agujero abierto tal cual estaba: basta
 *     con presentar un `originalTransactionId` ajeno lo bastante antiguo.
 *   · Rechazarlo con un 403 acusa de robo a quien probablemente solo compró
 *     hace tiempo, y encima le confirma que el identificador que ha pegado es
 *     real y de otra persona.
 *
 * Lo que se hace es una tercera cosa: **ausente no acredita y ausente no
 * acusa.** El recibo se descarta en silencio para el cliente (la respuesta es
 * un 200 con `acreditados: 0`, indistinguible de «no había nada que
 * restaurar») y se registra como evento propio para que soporte pueda contar
 * cuántas restauraciones legítimas estamos bloqueando y a quién hay que
 * atender a mano.
 *
 * QUÉ SE PIERDE, SIN ADORNOS: quien compró sin `appAccountToken` no puede
 * restaurar solo. Necesita a una persona al otro lado. Se elige ese coste —
 * que es recuperable, porque el dinero existe y el apunte se puede meter a
 * mano— frente al coste contrario, que no lo es: una compra acreditada a quien
 * no la hizo no se puede «desacreditar» sin quitarle cristales a alguien, y el
 * dueño real se queda sin ella para siempre porque la idempotencia del ledger
 * pasa a jugar en su contra.
 *
 * Y es un coste que se apaga solo: en cuanto la app fija el `appAccountToken`
 * (ya está pedido en `HANDOFF/PEDIDOS.md`), el conjunto de recibos sin titular
 * deja de crecer y solo queda el histórico.
 *
 * ── PRESENTE ⇒ TIENE QUE COINCIDIR ──────────────────────────────────────────
 * Un token presente pero con otra forma (no es un uuid, viene truncado, es
 * basura) NO se degrada a «ausente»: se compara igual y, como no puede ser
 * igual al `userId`, sale `ajeno`. Degradarlo abriría un camino en el que un
 * valor deforme cae en la rama indulgente, que es justo la que no queremos que
 * nadie sepa alcanzar.
 *
 * La comparación normaliza espacios y mayúsculas: Apple documenta un uuid y hay
 * clientes que lo envían en mayúsculas, mientras `profiles.id` es minúscula.
 */
export function comprobarTitular(cuentaApp: string | null | undefined, userId: string): Titularidad {
  const declarado = (cuentaApp ?? '').trim()
  if (declarado === '') return 'ausente'

  // Sin sesión utilizable no se acredita: 'ajeno' es la salida cerrada.
  const sesion = (userId ?? '').trim()
  if (sesion === '') return 'ajeno'

  return declarado.toLowerCase() === sesion.toLowerCase() ? 'coincide' : 'ajeno'
}

/**
 * Prefijo de dominio de la huella. No es un secreto y no pretende serlo: separa
 * este uso de cualquier otro sha256 del repositorio para que dos huellas de
 * sistemas distintos no se puedan cruzar.
 */
const DOMINIO_HUELLA = 'darma:billing:titular:'

/**
 * Huella corta y estable de un identificador de cuenta, PARA EL LOG.
 *
 * El `appAccountToken` de un recibo ajeno es el `profiles.id` de OTRA persona.
 * Volcarlo en un log lo ataría a la sesión de quien lo está probando, que es
 * exactamente el cruce de identidades que CONTRATOS §2 declara inexistente en
 * Darma. Con la huella se puede contar y correlacionar —«esta cuenta ha probado
 * siete titulares distintos esta semana»— sin que el log contenga el id.
 *
 * HONESTIDAD SOBRE LO QUE PROTEGE: no es irreversible frente a quien ya tenga
 * la tabla `profiles` y quiera cruzarla entera; esa persona no necesita el log
 * para nada. Protege del vistazo, del volcado y del proveedor externo donde
 * acaban los logs, que es el riesgo real.
 */
export function huellaTitular(valor: string): string {
  return createHash('sha256')
    .update(`${DOMINIO_HUELLA}${valor.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 16)
}

/** Veredicto sobre un historial completo antes de acreditar nada. */
export interface Restauracion {
  /** Recibos cuyo titular es la sesión. Los ÚNICOS acreditables. */
  restaurables: ReciboRestaurable[]
  /**
   * Huellas (no los ids) de los titulares ajenos encontrados, sin repetir. Si
   * trae algo, la petición entera se rechaza: `restaurables` viene vacío.
   */
  ajenas: string[]
  /** Cuántos recibos no declaraban titular. Ni se acreditan ni acusan. */
  sinTitular: number
}

/**
 * Clasifica un historial de Apple contra la sesión. **Pura: ni lanza ni
 * registra.** El código de error y el log son decisión de la ruta, que es quien
 * conoce el contrato de respuestas (CONTRATOS §4).
 *
 * ── POR QUÉ UN SOLO AJENO TUMBA LA PETICIÓN ENTERA ──────────────────────────
 * El historial de Apple se pide por `originalTransactionId`, y todas las
 * transacciones de ese hilo pertenecen a la MISMA cuenta de Apple. Si una
 * declara otro titular, no estamos ante un recibo raro dentro de una
 * restauración legítima: estamos ante una restauración que no es de quien la
 * pide. Acreditar «los que sí coinciden» y callar el resto convertiría un
 * intento de robo en un éxito parcial, y además dejaría el hecho sin respuesta
 * visible en la API.
 *
 * Contrapartida asumida: responder 403 en vez de un 200 vacío le confirma a
 * quien prueba que ese identificador es real y de otra persona. Se acepta —el
 * atacante ya lo sabía, lo sacó de una captura— a cambio de que el rechazo sea
 * inequívoco para quien lea el log y para quien depure el cliente. El freno
 * contra el barrido es el rate limit de esta ruta, que es el más bajo del
 * bloque, no el silencio de la respuesta.
 */
export function clasificarRestauracion(
  recibos: readonly ReciboRestaurable[],
  userId: string,
): Restauracion {
  const restaurables: ReciboRestaurable[] = []
  const ajenas: string[] = []
  let sinTitular = 0

  for (const recibo of recibos) {
    switch (comprobarTitular(recibo.cuentaApp, userId)) {
      case 'coincide':
        restaurables.push(recibo)
        break
      case 'ausente':
        sinTitular += 1
        break
      case 'ajeno': {
        const huella = huellaTitular(recibo.cuentaApp ?? '')
        if (!ajenas.includes(huella)) ajenas.push(huella)
        break
      }
    }
  }

  // Fail-closed: con un solo titular ajeno no se acredita NINGUNO.
  if (ajenas.length > 0) return { restaurables: [], ajenas, sinTitular }

  return { restaurables, ajenas, sinTitular }
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

/** Un recibo que no vale tampoco tiene titular que valga. */
function noRestaurable(motivo: string): ReciboRestaurable {
  return { ...noValido(motivo), cuentaApp: null }
}

/**
 * Titular declarado en una transacción, normalizado a `null` cuando no viene o
 * viene en blanco. Es el único sitio que lee el campo, para que «ausente» tenga
 * una sola definición en todo el bloque.
 */
export function titularDeTransaccion(transaccion: TransaccionApple): string | null {
  const declarado = (transaccion.appAccountToken ?? '').trim()
  return declarado === '' ? null : declarado
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
 * Devuelve `ReciboRestaurable`, que es un `ReciboVerificado` con el titular
 * añadido: quien ya la usaba (`/api/billing/verify`) sigue compilando igual, y
 * el día que esa ruta quiera comprobar la atribución tiene el dato aquí sin
 * tocar este archivo.
 *
 * @param token `transactionId` que manda la app tras completar la compra.
 */
export async function verificarRecibo(
  token: string,
  config: ConfigApple | null = configApple(),
): Promise<ReciboRestaurable> {
  if (!config) return noRestaurable('Apple IAP sin configurar')
  if (!token || !/^[0-9A-Za-z._-]{1,64}$/.test(token)) return noRestaurable('transactionId con forma inválida')

  const jwt = tokenApple(config)
  if (!jwt) return noRestaurable('no se ha podido firmar el JWT de la App Store Server API')

  const host = config.entorno === 'Sandbox' ? HOST_SANDBOX : HOST_PRODUCCION

  let cuerpo: { signedTransactionInfo?: string }
  try {
    const respuesta = await fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: 'no-store',
    })
    if (!respuesta.ok) return noRestaurable(`App Store Server API ${respuesta.status}`)
    cuerpo = (await respuesta.json()) as { signedTransactionInfo?: string }
  } catch (causa) {
    return noRestaurable(`fallo de red contra Apple: ${causa instanceof Error ? causa.message : 'desconocido'}`)
  }

  if (!cuerpo.signedTransactionInfo) return noRestaurable('respuesta sin signedTransactionInfo')

  const verificado = verificarJwsApple(cuerpo.signedTransactionInfo, config)
  if (!verificado.ok || !verificado.payload) return noRestaurable(verificado.motivo ?? 'JWS no verificado')

  return { ...evaluarTransaccion(verificado.payload, config), cuentaApp: titularDeTransaccion(verificado.payload) }
}

/**
 * Historial de transacciones de un usuario, para `POST /api/billing/restore`.
 *
 * Se apoya en el `originalTransactionId`, que es el único identificador estable
 * que sobrevive a una reinstalación. Sin restauración, quien reinstala pierde
 * lo que pagó y pide un reembolso con toda la razón.
 *
 * ⛔ Ese identificador **no es una credencial**: circula en capturas y en hilos
 * de soporte. Por eso cada recibo sale de aquí con su `cuentaApp`, y la ruta
 * está obligada a pasarlo por `clasificarRestauracion()` antes de acreditar.
 * Esta función responde «qué compras hay en ese hilo», nunca «son tuyas».
 */
export async function historialTransacciones(
  originalTransactionId: string,
  config: ConfigApple | null = configApple(),
): Promise<ReciboRestaurable[]> {
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
      .map((jws): ReciboRestaurable => {
        const verificado = verificarJwsApple(jws, config)
        if (!verificado.ok || !verificado.payload) return noRestaurable(verificado.motivo ?? 'JWS no verificado')
        return {
          ...evaluarTransaccion(verificado.payload, config),
          cuentaApp: titularDeTransaccion(verificado.payload),
        }
      })
      .filter((r) => r.valido)
  } catch {
    return []
  }
}
