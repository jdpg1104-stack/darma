// ============================================================================
// B10 · Pruebas del cifrado. Casos 1 a 5 de HANDOFF/B10.md §Pruebas exigidas.
//
// Corren con la WebCrypto REAL de Node (misma implementación de algoritmos que
// el navegador), no con un doble. Una prueba de criptografía contra un mock
// comprueba que el mock hace lo que se le dijo, que es exactamente nada.
//
// Cinco de los siete casos de aquí son CAMINOS DE FALLO: clave equivocada,
// ciphertext manipulado, sobre de un tercero, nonce repetido, versión de
// esquema desconocida. Es donde vive la seguridad de este bloque.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENC_VERSION,
  NONCE_BYTES,
  abrirSobre,
  base64ABytes,
  cifrar,
  crearClaveRefugio,
  descifrar,
  descifrarLote,
  envolverParaMiembro,
  generarIdentidad,
  generarParIdentidad,
  huella,
  numeroSeguridad,
  publicarIdentidad,
  bytesABase64,
} from './index.ts'
import type { MensajeCifrado, SobreCifrado } from './tipos.ts'

function mensaje(parcial: Partial<MensajeCifrado> & Pick<MensajeCifrado, 'ciphertextB64' | 'nonceB64'>): MensajeCifrado {
  return {
    id: 1,
    refugeId: '00000000-0000-0000-0000-000000000001',
    senderId: '00000000-0000-0000-0000-000000000002',
    encVersion: ENC_VERSION,
    kind: 'text',
    createdAt: '2026-08-03T00:00:00.000Z',
    ...parcial,
  }
}

// ── 1 · ida y vuelta, y el camino de fallo con otra clave ───────────────────

test('cifrar → descifrar con la misma clave devuelve el texto', async () => {
  const clave = await crearClaveRefugio()
  const texto = 'Hace tres años que no se lo cuento a nadie.'

  const { ciphertextB64, nonceB64 } = await cifrar(clave, texto)
  assert.notEqual(ciphertextB64, '')
  assert.equal(await descifrar(clave, ciphertextB64, nonceB64), texto)
})

test('FALLO · descifrar con otra clave lanza (GCM falla la autenticación)', async () => {
  const buena = await crearClaveRefugio()
  const otra = await crearClaveRefugio()
  const { ciphertextB64, nonceB64 } = await cifrar(buena, 'texto que nadie más debe leer')

  await assert.rejects(() => descifrar(otra, ciphertextB64, nonceB64))
})

test('FALLO · la UI no revienta: sin clave, ilegiblePorClave = true', async () => {
  const clave = await crearClaveRefugio()
  const { ciphertextB64, nonceB64 } = await cifrar(clave, 'hola')

  const [sinClave] = await descifrarLote(null, [mensaje({ ciphertextB64, nonceB64 })])
  assert.equal(sinClave.texto, null)
  assert.equal(sinClave.ilegiblePorClave, true)

  // Con clave equivocada NO es «no tengo la clave»: es un mensaje que no cuadra,
  // y la pantalla lo dice distinto.
  const otra = await crearClaveRefugio()
  const [conOtra] = await descifrarLote(otra, [mensaje({ ciphertextB64, nonceB64 })])
  assert.equal(conOtra.texto, null)
  assert.equal(conOtra.ilegiblePorClave, false)
})

test('un enc_version desconocido se marca ilegible en vez de descifrarse a ciegas', async () => {
  const clave = await crearClaveRefugio()
  const { ciphertextB64, nonceB64 } = await cifrar(clave, 'hola')

  const [m] = await descifrarLote(clave, [mensaje({ ciphertextB64, nonceB64, encVersion: 99 })])
  assert.equal(m.texto, null)
  assert.equal(m.ilegiblePorClave, true)
})

// ── 2 · un bit cambiado no descifra ─────────────────────────────────────────

test('FALLO · un ciphertext manipulado en un solo bit no descifra', async () => {
  const clave = await crearClaveRefugio()
  const { ciphertextB64, nonceB64 } = await cifrar(clave, 'un mensaje cualquiera, suficientemente largo')

  const bytes = base64ABytes(ciphertextB64)
  bytes[0] ^= 0b0000_0001 // un único bit
  await assert.rejects(() => descifrar(clave, bytesABase64(bytes), nonceB64))

  // Y lo mismo tocando el tag de autenticación, que son los 16 últimos bytes.
  const bytesTag = base64ABytes(ciphertextB64)
  bytesTag[bytesTag.length - 1] ^= 0b0000_0001
  await assert.rejects(() => descifrar(clave, bytesABase64(bytesTag), nonceB64))

  // Y tocando el nonce, que es público pero autenticado por el propio GCM.
  const bytesNonce = base64ABytes(nonceB64)
  bytesNonce[0] ^= 0b0000_0001
  await assert.rejects(() => descifrar(clave, ciphertextB64, bytesABase64(bytesNonce)))
})

// ── 3 · nonces siempre distintos ────────────────────────────────────────────

test('mil cifrados del mismo texto con la misma clave no repiten ningún nonce', async () => {
  const clave = await crearClaveRefugio()
  const vistos = new Set<string>()

  for (let i = 0; i < 1000; i++) {
    const { nonceB64, ciphertextB64 } = await cifrar(clave, 'siempre el mismo texto')
    assert.equal(base64ABytes(nonceB64).length, NONCE_BYTES)
    assert.equal(vistos.has(nonceB64), false, 'NONCE REPETIDO: esto rompe AES-GCM por completo')
    vistos.add(nonceB64)
    // Corolario: con nonce distinto, el mismo texto tampoco produce el mismo
    // ciphertext. Si lo produjera, el servidor podría ver qué mensajes son
    // iguales sin descifrar ninguno.
    assert.equal(vistos.has(ciphertextB64), false)
  }
  assert.equal(vistos.size, 1000)
})

// ── 4 · sobres entre pares ECDH ─────────────────────────────────────────────

test('envolverParaMiembro + abrirSobre recuperan la misma clave de refugio', async () => {
  const ana = await generarParIdentidad(false)
  const luis = await generarParIdentidad(false)
  const jwkLuis = (await publicarIdentidad(luis)).publicJwk
  const { publicJwk: jwkAna, fingerprint: huellaAna } = await publicarIdentidad(ana)

  const claveSala = await crearClaveRefugio()
  const { wrappedKeyB64, wrapNonceB64 } = await envolverParaMiembro(claveSala, jwkLuis, ana.privateKey)

  const sobre: SobreCifrado = {
    refugeId: '00000000-0000-0000-0000-000000000001',
    wrappedKeyB64,
    wrapNonceB64,
    senderFingerprint: huellaAna,
    keyVersion: 1,
  }

  const recuperada = await abrirSobre(sobre, jwkAna, luis.privateKey)

  // «La misma clave» se comprueba usándola, no exportándola: la clave que sale
  // de abrirSobre es no extraíble a propósito.
  const { ciphertextB64, nonceB64 } = await cifrar(claveSala, 'lo que se dijo en la sala')
  assert.equal(await descifrar(recuperada, ciphertextB64, nonceB64), 'lo que se dijo en la sala')
})

test('FALLO · un tercero no puede abrir el sobre, ni con la pública correcta', async () => {
  const ana = await generarParIdentidad(false)
  const luis = await generarParIdentidad(false)
  const intrusa = await generarParIdentidad(false)

  const jwkLuis = (await publicarIdentidad(luis)).publicJwk
  const { publicJwk: jwkAna, fingerprint: huellaAna } = await publicarIdentidad(ana)

  const claveSala = await crearClaveRefugio()
  const { wrappedKeyB64, wrapNonceB64 } = await envolverParaMiembro(claveSala, jwkLuis, ana.privateKey)
  const sobre: SobreCifrado = {
    refugeId: '00000000-0000-0000-0000-000000000001',
    wrappedKeyB64,
    wrapNonceB64,
    senderFingerprint: huellaAna,
    keyVersion: 1,
  }

  // Con su propia privada y la pública de Ana: el secreto ECDH es otro.
  await assert.rejects(() => abrirSobre(sobre, jwkAna, intrusa.privateKey))

  // Y con la privada de Luis pero diciendo que lo envolvió otra persona
  // (que es lo que pasaría si el servidor sirviera una clave falsa).
  const jwkIntrusa = (await publicarIdentidad(intrusa)).publicJwk
  await assert.rejects(() => abrirSobre(sobre, jwkIntrusa, luis.privateKey))
})

test('FALLO · un sobre con el nonce cambiado no abre', async () => {
  const ana = await generarParIdentidad(false)
  const luis = await generarParIdentidad(false)
  const jwkLuis = (await publicarIdentidad(luis)).publicJwk
  const { publicJwk: jwkAna, fingerprint } = await publicarIdentidad(ana)

  const claveSala = await crearClaveRefugio()
  const { wrappedKeyB64, wrapNonceB64 } = await envolverParaMiembro(claveSala, jwkLuis, ana.privateKey)

  const nonce = base64ABytes(wrapNonceB64)
  nonce[3] ^= 0xff
  await assert.rejects(() =>
    abrirSobre(
      {
        refugeId: '00000000-0000-0000-0000-000000000001',
        wrappedKeyB64,
        wrapNonceB64: bytesABase64(nonce),
        senderFingerprint: fingerprint,
        keyVersion: 1,
      },
      jwkAna,
      luis.privateKey,
    ),
  )
})

// ── 5 · la huella es estable y el número de seguridad se lee ────────────────

test('la huella no depende del orden de las propiedades de la JWK', async () => {
  const { publicJwk } = await generarIdentidad()

  const desordenada: JsonWebKey = { y: publicJwk.y, kty: publicJwk.kty, x: publicJwk.x, crv: publicJwk.crv }
  // Y con propiedades de más, que es lo que devuelve exportKey en la práctica.
  const conRuido: JsonWebKey = { ...publicJwk, ext: true, key_ops: [] }

  const base = await huella(publicJwk)
  assert.equal(await huella(desordenada), base)
  assert.equal(await huella(conRuido), base)
  assert.match(base, /^[0-9a-f]{64}$/)
})

test('la huella cambia si cambia x o y', async () => {
  const { publicJwk } = await generarIdentidad()
  const base = await huella(publicJwk)

  const otraX = { ...publicJwk, x: 'AAAA' + String(publicJwk.x).slice(4) }
  assert.notEqual(await huella(otraX), base)

  const otraY = { ...publicJwk, y: 'AAAA' + String(publicJwk.y).slice(4) }
  assert.notEqual(await huella(otraY), base)
})

test('FALLO · huella() se niega a hashear una JWK con la componente privada', async () => {
  const par = await generarParIdentidad(true)
  const privada = await crypto.subtle.exportKey('jwk', par.privateKey)
  await assert.rejects(() => huella(privada), /componente privada/)
})

test('numeroSeguridad son tres grupos de cinco dígitos y es determinista', async () => {
  const { fingerprint } = await generarIdentidad()
  const numero = numeroSeguridad(fingerprint)

  assert.match(numero, /^\d{5} \d{5} \d{5}$/)
  assert.equal(numeroSeguridad(fingerprint), numero)
  assert.throws(() => numeroSeguridad('no-es-una-huella'))
})

// ── Descifrado en lote ──────────────────────────────────────────────────────

test('descifrarLote conserva el orden y no pierde ningún mensaje', async () => {
  const clave = await crearClaveRefugio()
  const textos = Array.from({ length: 50 }, (_, i) => `mensaje ${i}`)

  const cifrados: MensajeCifrado[] = []
  for (const [i, t] of textos.entries()) {
    const { ciphertextB64, nonceB64 } = await cifrar(clave, t)
    cifrados.push(mensaje({ id: i + 1, ciphertextB64, nonceB64 }))
  }

  const claros = await descifrarLote(clave, cifrados)
  assert.equal(claros.length, 50)
  assert.deepEqual(claros.map((m) => m.texto), textos)
  assert.deepEqual(claros.map((m) => m.id), cifrados.map((m) => m.id))
})
