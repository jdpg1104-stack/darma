// ============================================================================
// Verificación de recibos — el camino de FALLO, que es el que importa
//
// El caso nº 7 de la ficha: «recibo inválido / firma incorrecta → cero filas en
// crystal_ledger, respuesta entrada_invalida SIN el motivo». Aquí se comprueba
// la mitad de TypeScript: que ninguna función lanza, que todas devuelven
// `valido: false` con un motivo destinado al log, y que sin configuración el
// resultado es «no verificado» y nunca «adelante».
//
// Estas pruebas corren SIN red, SIN clave `.p8` y SIN cuenta de servicio: todo
// lo que se comprueba son funciones puras y el camino de "no configurado".
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'

import { configApple, evaluarTransaccion, tokenApple, verificarRecibo as verificarApple } from './apple.ts'
import {
  configGoogle,
  evaluarCompra,
  extraerNotificacion,
  verificarRecibo as verificarGoogle,
  verificarTokenPubSub,
} from './google.ts'
import { cabeceraDe, firmarJwt, verificarJws, verificarJwsConCadena, vigente } from './jws.ts'

const ENTORNO_VACIO = {} as NodeJS.ProcessEnv

// ── Configuración ausente = fail-closed ─────────────────────────────────────

test('FALLO · sin configuración, Apple no verifica NADA (y no lanza)', async () => {
  assert.equal(configApple(ENTORNO_VACIO), null)

  const recibo = await verificarApple('2000000123456789', null)
  assert.equal(recibo.valido, false)
  assert.equal(recibo.externalId, null)
  assert.ok(recibo.motivo)
})

test('FALLO · sin configuración, Google no verifica NADA (y no lanza)', async () => {
  assert.equal(configGoogle(ENTORNO_VACIO), null)

  const recibo = await verificarGoogle('sku|token', null)
  assert.equal(recibo.valido, false)
  assert.equal(recibo.externalId, null)

  const pubsub = await verificarTokenPubSub('Bearer loquesea', null)
  assert.equal(pubsub.ok, false)
})

test('FALLO · configuración a medias también es "no configurado"', () => {
  // Tres de las cinco variables. Aceptar una configuración parcial es aceptar
  // que la verificación se salte la parte que falta.
  assert.equal(
    configApple({
      APPLE_IAP_ISSUER_ID: 'x',
      APPLE_IAP_KEY_ID: 'y',
      APPLE_IAP_PRIVATE_KEY: 'z',
    } as unknown as NodeJS.ProcessEnv),
    null,
  )
  assert.equal(
    configGoogle({ GOOGLE_PLAY_PACKAGE: 'app.darma', GOOGLE_PLAY_CLIENT_EMAIL: 'x@y' } as unknown as NodeJS.ProcessEnv),
    null,
  )
})

// ── Política sobre una transacción de Apple ─────────────────────────────────

const CONFIG_APPLE = { bundleId: 'app.darma', entorno: 'Production' } as const

test('una transacción correcta produce el external_id con prefijo de plataforma', () => {
  const recibo = evaluarTransaccion(
    {
      transactionId: '2000000123456789',
      bundleId: 'app.darma',
      productId: 'app.darma.crystals.550',
      environment: 'Production',
      type: 'Consumable',
    },
    CONFIG_APPLE,
  )

  assert.equal(recibo.valido, true)
  assert.equal(recibo.externalId, 'apple:2000000123456789')
  assert.equal(recibo.productId, 'app.darma.crystals.550')
  assert.equal(recibo.motivo, null)
})

test('FALLO · bundleId ajeno, entorno de sandbox, reembolso y tipo no vendible', () => {
  const base = {
    transactionId: '1',
    bundleId: 'app.darma',
    productId: 'app.darma.crystals.550',
    environment: 'Production' as const,
    type: 'Consumable',
  }

  const casos: Array<[string, Parameters<typeof evaluarTransaccion>[0]]> = [
    ['bundleId de otra app', { ...base, bundleId: 'com.otra.app' }],
    // Un recibo de sandbox acreditado en producción es dinero de mentira
    // convertido en cristales de verdad.
    ['recibo de sandbox en producción', { ...base, environment: 'Sandbox' }],
    ['transacción reembolsada', { ...base, revocationDate: 1_700_000_000_000 }],
    ['suscripción, que no vendemos', { ...base, type: 'Auto-Renewable Subscription' }],
    ['sin transactionId', { ...base, transactionId: undefined }],
    ['sin productId', { ...base, productId: undefined }],
  ]

  for (const [descripcion, transaccion] of casos) {
    const recibo = evaluarTransaccion(transaccion, CONFIG_APPLE)
    assert.equal(recibo.valido, false, descripcion)
    assert.equal(recibo.externalId, null, descripcion)
    assert.ok(recibo.motivo, `${descripcion}: el motivo va al log`)
  }
})

// ── Política sobre una compra de Google ─────────────────────────────────────

test('FALLO · purchaseState distinto de 0 no acredita', () => {
  // 1 = cancelado, 2 = pendiente. El pendiente volverá cuando se confirme;
  // acreditarlo ahora sería regalar cristales por un pago que puede no llegar.
  for (const estado of [1, 2, undefined]) {
    const recibo = evaluarCompra({ orderId: 'GPA.1', purchaseState: estado }, 'app_darma_crystals_100')
    assert.equal(recibo.valido, false, `purchaseState ${String(estado)}`)
  }

  const ok = evaluarCompra({ orderId: 'GPA.1', purchaseState: 0 }, 'app_darma_crystals_100')
  assert.equal(ok.valido, true)
  assert.equal(ok.externalId, 'google:GPA.1')
})

test('FALLO · una compra sin orderId no tiene idempotencia posible', () => {
  const recibo = evaluarCompra({ purchaseState: 0 }, 'app_darma_crystals_100')
  assert.equal(recibo.valido, false)
})

test('extraerNotificacion devuelve null ante cualquier sobre inesperado', () => {
  for (const malo of [null, undefined, {}, { message: {} }, { message: { data: 123 } }, { message: { data: 'no-json' } }]) {
    assert.equal(extraerNotificacion(malo), null)
  }

  const bueno = {
    message: {
      data: Buffer.from(JSON.stringify({ packageName: 'app.darma' })).toString('base64'),
    },
  }
  assert.equal(extraerNotificacion(bueno)?.packageName, 'app.darma')
})

// ── JWS ─────────────────────────────────────────────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

test('un JWS ES256 firmado por nosotros se verifica con nuestra clave', () => {
  const jwt = firmarJwt({}, { hola: 'mundo' }, PEM, 'ES256')
  assert.ok(jwt)

  const verificado = verificarJws<{ hola: string }>(jwt, publicKey, 'ES256')
  assert.equal(verificado.ok, true)
  assert.equal(verificado.payload?.hola, 'mundo')
})

test('FALLO · el `alg` del token NO decide el algoritmo (alg:none y confusión de algoritmo)', () => {
  const jwt = firmarJwt({}, { hola: 'mundo' }, PEM, 'ES256')!
  const [, cuerpo, firma] = jwt.split('.')

  // Cabecera reescrita a `alg: none`, el ataque clásico de JWT.
  const cabeceraNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const falsificado = `${cabeceraNone}.${cuerpo}.${firma}`

  const verificado = verificarJws(falsificado, publicKey, 'ES256')
  assert.equal(verificado.ok, false)
  assert.match(verificado.motivo ?? '', /alg inesperado/)

  // Y pedir RS256 sobre un token ES256 tampoco cuela.
  assert.equal(verificarJws(jwt, publicKey, 'RS256').ok, false)
})

test('FALLO · un cuerpo manipulado invalida la firma', () => {
  const jwt = firmarJwt({}, { crystals: 100 }, PEM, 'ES256')!
  const [cabecera, , firma] = jwt.split('.')
  const cuerpoInflado = Buffer.from(JSON.stringify({ crystals: 999999 })).toString('base64url')

  const verificado = verificarJws(`${cabecera}.${cuerpoInflado}.${firma}`, publicKey, 'ES256')
  assert.equal(verificado.ok, false)
  assert.match(verificado.motivo ?? '', /firma inválida/)
})

test('FALLO · sin raíz de confianza configurada, una cadena x5c NO se acepta', () => {
  // Es el fallo que convierte un webhook en una API pública para regalarse
  // cristales: cualquiera genera su propia cadena y firma lo que quiera.
  const jwt = firmarJwt({ x5c: ['aaa', 'bbb'] }, { hola: 'mundo' }, PEM, 'ES256')!

  const sinRaiz = verificarJwsConCadena(jwt, [])
  assert.equal(sinRaiz.ok, false)
  assert.match(sinRaiz.motivo ?? '', /raíz de confianza/)

  // Y con raíz configurada pero una cadena inventada, tampoco.
  const conRaiz = verificarJwsConCadena(jwt, ['00'.repeat(32)])
  assert.equal(conRaiz.ok, false)
})

test('FALLO · un JWS malformado no lanza; devuelve motivo', () => {
  for (const malo of ['', 'a', 'a.b', 'a.b.c.d', '....']) {
    const verificado = verificarJws(malo, publicKey, 'ES256')
    assert.equal(verificado.ok, false)
    assert.ok(verificado.motivo)
  }
  assert.equal(cabeceraDe('no-es-un-jws'), null)
})

test('vigente rechaza tokens caducados y del futuro, con margen de reloj', () => {
  const ahora = Math.floor(Date.now() / 1000)

  assert.equal(vigente({ exp: ahora + 300 }), true)
  assert.equal(vigente({ exp: ahora - 300 }), false)
  assert.equal(vigente({ iat: ahora + 300 }), false)
  // Dentro del margen de 60 s sí pasa: los relojes de dos máquinas no coinciden.
  assert.equal(vigente({ exp: ahora - 30 }), true)
})

test('el JWT de la App Store Server API lleva iss, aud, bid y caduca en 20 minutos', () => {
  const config = {
    issuerId: 'issuer-1',
    keyId: 'key-1',
    privateKeyPem: PEM,
    bundleId: 'app.darma',
    huellasRaiz: ['00'.repeat(32)],
    entorno: 'Production' as const,
  }

  const jwt = tokenApple(config, 1_800_000_000)
  assert.ok(jwt)

  const cuerpo = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
  assert.equal(cuerpo.iss, 'issuer-1')
  assert.equal(cuerpo.aud, 'appstoreconnect-v1')
  assert.equal(cuerpo.bid, 'app.darma')
  assert.equal(cuerpo.exp, 1_800_000_000 + 20 * 60)

  assert.equal(cabeceraDe(jwt)?.kid, 'key-1')
})

test('FALLO · firmar con una clave inservible devuelve null en vez de lanzar', () => {
  assert.equal(firmarJwt({}, {}, 'esto no es un PEM', 'ES256'), null)
})

test('FALLO · un token de Google con la forma equivocada se rechaza antes de la red', async () => {
  const config = {
    packageName: 'app.darma',
    clientEmail: 'x@y.iam.gserviceaccount.com',
    privateKeyPem: PEM,
    pubsubServiceAccount: 'push@y.iam.gserviceaccount.com',
    pubsubAudiencia: 'https://darma.app/api/billing/webhook/google',
  }

  for (const malo of ['', 'sin-separador', '|solo-token', 'solo-sku|']) {
    const recibo = await verificarGoogle(malo, config)
    assert.equal(recibo.valido, false, malo)
    assert.match(recibo.motivo ?? '', /token/)
  }
})
