// ============================================================================
// Pruebas de lib/auth/identidad.ts
//
// Lo que se prueba aquí NO es "el hash funciona" (eso lo garantiza node:crypto)
// sino las dos decisiones que, si están mal, rompen algo que nadie nota hasta
// que es tarde:
//   · dónde SÍ debe colisionar la normalización (multicuenta detectada),
//   · dónde NO debe colisionar (dos personas distintas acusadas de lo mismo).
// ============================================================================

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { enmascararContacto, hashContacto, normalizarContacto } from './identidad.ts'

const PIMIENTA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PIMIENTA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

beforeEach(() => {
  process.env.IDENTITY_PEPPER = PIMIENTA_A
})

describe('normalizarContacto', () => {
  it('colapsa el +tag y los puntos en dominios de Google', () => {
    // Caso 1 de las pruebas exigidas: A.B+x@gmail.com ≡ ab@gmail.com.
    assert.equal(normalizarContacto('A.B+x@gmail.com'), 'ab@gmail.com')
    assert.equal(normalizarContacto('  Ana.Perez+darma@GMail.com '), 'anaperez@gmail.com')
    assert.equal(normalizarContacto('anaperez@gmail.com'), 'anaperez@gmail.com')
    assert.equal(
      normalizarContacto('A.B+x@gmail.com'),
      normalizarContacto('ab@gmail.com'),
    )
    // googlemail.com es el mismo buzón que gmail.com.
    assert.equal(normalizarContacto('a.b@googlemail.com'), 'ab@googlemail.com')
  })

  it('NO colapsa los puntos fuera de los dominios de Google', () => {
    // La otra mitad del caso 1, y la que más daño hace si se implementa mal:
    // a.b@empresa.com y ab@empresa.com son dos personas distintas.
    assert.equal(normalizarContacto('a.b@empresa.com'), 'a.b@empresa.com')
    assert.notEqual(
      normalizarContacto('a.b@empresa.com'),
      normalizarContacto('ab@empresa.com'),
    )
  })

  it('quita el +tag también fuera de Google, pero conserva el local', () => {
    assert.equal(normalizarContacto('ana+darma@empresa.com'), 'ana@empresa.com')
  })

  it('no vacía el local-part cuando el correo empieza por +', () => {
    // Si se recortara, "+a@x.com" y "+b@x.com" colapsarían al mismo hash y dos
    // cuentas sin relación aparecerían como multicuenta.
    assert.equal(normalizarContacto('+a@x.com'), '+a@x.com')
    assert.notEqual(normalizarContacto('+a@x.com'), normalizarContacto('+b@x.com'))
  })

  it('normaliza separadores en algo que no es un email', () => {
    assert.equal(normalizarContacto(' +34 600 11 22 33 '), '+34600112233')
  })
})

describe('hashContacto', () => {
  it('es estable y devuelve 64 hexadecimales', () => {
    const uno = hashContacto('ana@gmail.com')
    const dos = hashContacto('  ANA@gmail.com ')
    assert.equal(uno, dos)
    assert.match(uno, /^[0-9a-f]{64}$/)
  })

  it('cambia si cambia la pimienta', () => {
    const conA = hashContacto('ana@gmail.com')
    process.env.IDENTITY_PEPPER = PIMIENTA_B
    const conB = hashContacto('ana@gmail.com')
    assert.notEqual(conA, conB)
  })

  it('falla en voz alta si no hay pimienta', () => {
    // Fallar es lo correcto: seguir con una cadena vacía produciría un SHA-256
    // de un email, reversible con un diccionario de correos comunes.
    delete process.env.IDENTITY_PEPPER
    assert.throws(() => hashContacto('ana@gmail.com'), /IDENTITY_PEPPER/)
  })
})

describe('enmascararContacto', () => {
  it('deja ver la primera letra y el dominio, nada más', () => {
    assert.equal(enmascararContacto('anaperez@gmail.com'), 'a*******@gmail.com')
  })
})
