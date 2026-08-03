// ============================================================================
// B06 · Cursor keyset. Parte del caso 8 de «Pruebas exigidas»: un cursor
// corrupto tiene que ser un error explícito, nunca un 500 ni una página vacía
// silenciosa (ni, peor, la primera página repetida en bucle).
// ============================================================================

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { codificarCursor, decodificarCursor } from './cursor.ts'

const UUID = '6f1c7c4e-3a2b-4d5e-8f90-1a2b3c4d5e6f'

describe('cursor · ida y vuelta', () => {
  it('codificar y decodificar devuelve lo mismo', () => {
    const cursor = { rank: 42, userId: UUID }
    assert.deepEqual(decodificarCursor(codificarCursor(cursor)), cursor)
  })

  it('es opaco: no filtra el rank en claro en la URL', () => {
    const codificado = codificarCursor({ rank: 7, userId: UUID })
    assert.doesNotMatch(codificado, /^7:/)
    assert.match(codificado, /^[A-Za-z0-9_-]+$/) // base64url, seguro en query string
  })

  it('sin cursor es la primera página, no un error', () => {
    assert.equal(decodificarCursor(null), null)
    assert.equal(decodificarCursor(undefined), null)
    assert.equal(decodificarCursor(''), null)
  })
})

describe('cursor · CAMINO DE FALLO', () => {
  it('«no es base64» lanza', () => {
    // `Buffer.from(..., 'base64url')` no lanza con basura: ignora lo que no
    // pertenece al alfabeto y devuelve lo que puede. Por eso la validación de
    // verdad es la de la FORMA decodificada.
    assert.throws(() => decodificarCursor('esto no es un cursor'), RangeError)
    assert.throws(() => decodificarCursor('!!!!'), RangeError)
  })

  it('rank negativo o cero lanza', () => {
    assert.throws(() => decodificarCursor(codificarCursor({ rank: -1, userId: UUID })), RangeError)
    assert.throws(() => decodificarCursor(codificarCursor({ rank: 0, userId: UUID })), RangeError)
  })

  it('rank no entero lanza', () => {
    assert.throws(
      () => decodificarCursor(Buffer.from(`1.5:${UUID}`, 'utf8').toString('base64url')),
      RangeError,
    )
    assert.throws(
      () => decodificarCursor(Buffer.from(`abc:${UUID}`, 'utf8').toString('base64url')),
      RangeError,
    )
  })

  it('un uuid que no lo es lanza', () => {
    assert.throws(
      () => decodificarCursor(Buffer.from('3:no-soy-un-uuid', 'utf8').toString('base64url')),
      RangeError,
    )
    // Ni siquiera «casi»: un uuid con un carácter de más.
    assert.throws(
      () => decodificarCursor(Buffer.from(`3:${UUID}0`, 'utf8').toString('base64url')),
      RangeError,
    )
  })

  it('sin separador lanza', () => {
    assert.throws(() => decodificarCursor(Buffer.from('12', 'utf8').toString('base64url')), RangeError)
    assert.throws(
      () => decodificarCursor(Buffer.from(`:${UUID}`, 'utf8').toString('base64url')),
      RangeError,
    )
  })

  it('un cursor absurdamente largo lanza antes de decodificarlo', () => {
    assert.throws(() => decodificarCursor('A'.repeat(5000)), RangeError)
  })

  it('un rank enorme pero válido se acepta (el puesto 40 000 existe)', () => {
    assert.deepEqual(decodificarCursor(codificarCursor({ rank: 40_000, userId: UUID })), {
      rank: 40_000,
      userId: UUID,
    })
  })
})
