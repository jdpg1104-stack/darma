// ============================================================================
// Pruebas de lib/auth/totp.ts
//
// El caso que importa es el de FALLO: un código viejo que sigue valiendo, o un
// código de recuperación que se puede usar dos veces, son puertas abiertas que
// no dan ningún síntoma hasta que alguien las usa.
// ============================================================================

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  PASO_SEGUNDOS,
  cifrarSecretoTotp,
  codificarBase32,
  codigoTotp,
  consumirCodigoRecuperacion,
  decodificarBase32,
  descifrarSecretoTotp,
  generarCodigosRecuperacion,
  generarSecretoTotp,
  hashCodigoRecuperacion,
  uriOtpauth,
  verificarTotp,
} from './totp.ts'

const CLAVE = '0'.repeat(64)

beforeEach(() => {
  process.env.TOTP_ENC_KEY = CLAVE
})

describe('base32', () => {
  it('va y vuelve sin perder bytes', () => {
    const original = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x9c, 0x01])
    assert.deepEqual(decodificarBase32(codificarBase32(original)), original)
  })

  it('tolera minúsculas, espacios y relleno al decodificar', () => {
    const secreto = codificarBase32(Buffer.from('darma-2fa'))
    const maltratado = `${secreto.toLowerCase().slice(0, 4)} ${secreto.toLowerCase().slice(4)}==`
    assert.deepEqual(decodificarBase32(maltratado), decodificarBase32(secreto))
  })
})

describe('verificarTotp', () => {
  const secreto = 'JBSWY3DPEHPK3PXP' // vector de ejemplo, formato base32
  const ahora = new Date('2026-08-03T10:00:00.000Z')

  it('acepta el código de la ventana actual', () => {
    assert.equal(verificarTotp(secreto, codigoTotp(secreto, ahora), ahora), true)
  })

  it('acepta ±1 ventana (desfase de reloj y tiempo de tecleo)', () => {
    const anterior = new Date(ahora.getTime() - PASO_SEGUNDOS * 1000)
    const siguiente = new Date(ahora.getTime() + PASO_SEGUNDOS * 1000)
    assert.equal(verificarTotp(secreto, codigoTotp(secreto, anterior), ahora), true)
    assert.equal(verificarTotp(secreto, codigoTotp(secreto, siguiente), ahora), true)
  })

  it('RECHAZA el código de hace 3 ventanas', () => {
    // Es el caso que convierte una captura de pantalla vieja en un acceso.
    const viejo = new Date(ahora.getTime() - 3 * PASO_SEGUNDOS * 1000)
    assert.equal(verificarTotp(secreto, codigoTotp(secreto, viejo), ahora), false)
  })

  it('rechaza lo que no son 6 dígitos, sin lanzar', () => {
    assert.equal(verificarTotp(secreto, '', ahora), false)
    assert.equal(verificarTotp(secreto, '12345', ahora), false)
    assert.equal(verificarTotp(secreto, '1234567', ahora), false)
    assert.equal(verificarTotp(secreto, 'abcdef', ahora), false)
    assert.equal(verificarTotp(secreto, "1' or '1", ahora), false)
  })

  it('genera secretos válidos y un URI sin datos personales', () => {
    const nuevo = generarSecretoTotp()
    assert.match(nuevo, /^[A-Z2-7]{32}$/)
    const uri = uriOtpauth('Faro Sereno 1234', nuevo)
    assert.match(uri, /^otpauth:\/\/totp\/Darma%3A/)
    assert.equal(uri.includes('@'), false)
  })
})

describe('cifrado del secreto', () => {
  it('va y vuelve, y falla si el blob se manipula', () => {
    const secreto = generarSecretoTotp()
    const blob = cifrarSecretoTotp(secreto)
    assert.equal(descifrarSecretoTotp(blob), secreto)

    // AES-GCM autentica además de cifrar: un byte cambiado no descifra "otra
    // cosa", lanza. Es lo que impide que alguien con acceso de escritura a la
    // tabla sustituya el secreto por uno suyo sin la clave.
    const manipulado = Buffer.from(blob)
    manipulado[manipulado.length - 1] ^= 0xff
    assert.throws(() => descifrarSecretoTotp(manipulado))
  })

  it('no acepta una clave que no sean 32 bytes', () => {
    process.env.TOTP_ENC_KEY = 'abcd'
    assert.throws(() => cifrarSecretoTotp('JBSWY3DPEHPK3PXP'), /32 bytes/)
  })
})

describe('códigos de recuperación', () => {
  it('emite 10, todos distintos y legibles en papel', () => {
    const codigos = generarCodigosRecuperacion()
    assert.equal(codigos.length, 10)
    assert.equal(new Set(codigos).size, 10)
    for (const codigo of codigos) {
      assert.match(codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      // Sin caracteres que se confundan al copiarlos a mano.
      assert.equal(/[01ILO]/.test(codigo), false)
    }
  })

  it('un código usado NO vale la segunda vez', () => {
    const codigos = generarCodigosRecuperacion()
    const hashes = codigos.map((codigo) => hashCodigoRecuperacion(codigo))

    const primero = consumirCodigoRecuperacion(hashes, codigos[0]!)
    assert.equal(primero.ok, true)
    assert.equal(primero.restantes.length, 9)

    // Se reintenta contra la lista QUE QUEDA, que es lo que la ruta persiste.
    const segundo = consumirCodigoRecuperacion(primero.restantes, codigos[0]!)
    assert.equal(segundo.ok, false)
    assert.equal(segundo.restantes.length, 9)
  })

  it('tolera espacios y minúsculas al teclear el código', () => {
    const codigos = generarCodigosRecuperacion()
    const hashes = codigos.map((codigo) => hashCodigoRecuperacion(codigo))
    const tecleado = codigos[3]!.toLowerCase().replace('-', ' ')
    assert.equal(consumirCodigoRecuperacion(hashes, tecleado).ok, true)
  })

  it('rechaza un código inventado sin tocar la lista', () => {
    const codigos = generarCodigosRecuperacion()
    const hashes = codigos.map((codigo) => hashCodigoRecuperacion(codigo))
    const resultado = consumirCodigoRecuperacion(hashes, 'ZZZZ-ZZZZ')
    assert.equal(resultado.ok, false)
    assert.equal(resultado.restantes.length, 10)
  })

  it('no guarda el código en claro', () => {
    const hash = hashCodigoRecuperacion('ABCD-2345')
    assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    assert.equal(hash.includes('ABCD'), false)
  })
})
