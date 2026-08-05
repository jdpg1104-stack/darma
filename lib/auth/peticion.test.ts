// ============================================================================
// Pruebas de lib/auth/peticion.ts — de qué cabecera sale la IP y cómo se
// normaliza.
//
// Lo que se prueba aquí NO es «lee una cabecera» sino las dos decisiones que,
// si están mal, dejan la puerta de creación de cuentas abierta sin que nada
// falle de forma visible:
//   · de QUÉ cabecera se hace caso cuando llegan varias y se contradicen,
//   · qué valores distintos tienen que caer en el MISMO cubo de contador
//     (formas equivalentes de la misma máquina, y el /64 en IPv6).
//
// Sin red: se construyen `Request` en memoria.
// ============================================================================

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ipDePeticion, origenDePeticion, sirveParaAutorizar } from './peticion.ts'

function peticion(cabeceras: Record<string, string>): Request {
  return new Request('https://darma.app/api/auth/anonimo', {
    method: 'POST',
    headers: cabeceras,
  })
}

// ── Orden de confianza entre cabeceras ──────────────────────────────────────

describe('origenDePeticion · qué cabecera gana', () => {
  it('prefiere x-vercel-forwarded-for aunque llegue una cadena falsificada', () => {
    const origen = origenDePeticion(
      peticion({
        // Lo que escribe el atacante.
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-real-ip': '9.9.9.9',
        // Lo que pone el borde, en su propio espacio de nombres.
        'x-vercel-forwarded-for': '203.0.113.7',
      }),
    )

    assert.equal(origen.ip, '203.0.113.7')
    assert.equal(origen.cabecera, 'x-vercel-forwarded-for')
    assert.equal(origen.fiabilidad, 'borde')
    assert.equal(sirveParaAutorizar(origen), true)
  })

  it('sin la del borde usa x-real-ip antes que x-forwarded-for, y se declara menos fiable', () => {
    const origen = origenDePeticion(
      peticion({
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '198.51.100.22',
      }),
    )

    assert.equal(origen.ip, '198.51.100.22')
    assert.equal(origen.cabecera, 'x-real-ip')
    assert.equal(origen.fiabilidad, 'reenviada')
    // No sirve para autorizar: la puede poner cualquiera fuera de Vercel.
    assert.equal(sirveParaAutorizar(origen), false)
  })

  it('de x-forwarded-for toma el ÚLTIMO elemento, que es el que apendó el salto más cercano', () => {
    const origen = origenDePeticion(
      peticion({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 198.51.100.22' }),
    )
    assert.equal(origen.ip, '198.51.100.22')
    assert.equal(origen.fiabilidad, 'reenviada')
  })

  it('una cabecera con basura no gana: se sigue bajando por la lista', () => {
    const origen = origenDePeticion(
      peticion({
        'x-vercel-forwarded-for': 'no-soy-una-ip',
        'x-real-ip': '198.51.100.22',
      }),
    )
    // La basura no se acepta ni siquiera viniendo del espacio del borde: si se
    // aceptara, quien pudiera escribirla se fabricaría un cubo por petición.
    assert.equal(origen.ip, '198.51.100.22')
    assert.equal(origen.cabecera, 'x-real-ip')
  })

  it('sin ninguna cabecera devuelve null y lo dice (next dev)', () => {
    const origen = origenDePeticion(peticion({}))
    assert.deepEqual(origen, { ip: null, cabecera: null, fiabilidad: 'ninguna' })
    assert.equal(sirveParaAutorizar(origen), false)
    assert.equal(ipDePeticion(peticion({})), null)
  })
})

// ── Normalización: qué tiene que caer en el mismo cubo ──────────────────────

describe('origenDePeticion · normalización', () => {
  it('los ceros a la izquierda no fabrican un cubo nuevo', () => {
    // Sin canonizar, "01.002.3.4" y "1.2.3.4" serían dos contadores distintos
    // para la misma máquina: un bypass que se escribe con el teclado.
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '01.002.3.4' })), '1.2.3.4')
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '1.2.3.4' })), '1.2.3.4')
  })

  it('el puerto y los corchetes no cuentan', () => {
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '203.0.113.7:54321' })), '203.0.113.7')
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '[2001:db8::1]:443' })), '2001:db8:0:0::')
  })

  it('la IPv4 disfrazada de IPv6 cae en el cubo de la IPv4', () => {
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '::ffff:203.0.113.7' })), '203.0.113.7')
  })

  it('IPv6 se agrega al /64: rotar los 64 bits bajos no da cubos nuevos', () => {
    // A un abonado doméstico se le entrega un /64 entero. Contar por dirección
    // completa convierte el límite en ninguno para cualquiera con IPv6.
    const primera = ipDePeticion(peticion({ 'x-real-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }))
    const segunda = ipDePeticion(peticion({ 'x-real-ip': '2001:db8:1:2:1111:2222:3333:4444' }))
    const comprimida = ipDePeticion(peticion({ 'x-real-ip': '2001:0db8:0001:0002::9' }))

    assert.equal(primera, '2001:db8:1:2::')
    assert.equal(segunda, primera)
    assert.equal(comprimida, primera)

    // Un /64 distinto sí es otro cubo.
    assert.notEqual(ipDePeticion(peticion({ 'x-real-ip': '2001:db8:1:3::9' })), primera)
  })

  it('rechaza lo que no es una IP, incluida una cabecera absurdamente larga', () => {
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '999.1.1.1' })), null)
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '1.2.3' })), null)
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': 'localhost' })), null)
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '  ' })), null)
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': '2001:db8::1::2' })), null)
    assert.equal(ipDePeticion(peticion({ 'x-real-ip': 'a'.repeat(500) })), null)
  })
})
