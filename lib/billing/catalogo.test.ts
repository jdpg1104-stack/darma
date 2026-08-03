// ============================================================================
// Catálogo — el sitio donde se decide cuántos cristales vale una compra.
//
// El test que importa aquí no es el del camino feliz: es el nº 8 de la ficha,
// «body con `crystals: 999999` → ignorado; se acredita la cantidad del
// catálogo». Se prueba en el único punto donde una cadena de fuera se convierte
// en un número: `resolverPaquete()`.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { CATALOGO, COMISION_TIENDA, PAQUETES, esSkuCristales, resolverPaquete } from './catalogo.ts'

test('el catálogo tiene los cuatro paquetes y sus cantidades', () => {
  assert.equal(PAQUETES.length, 4)
  assert.equal(CATALOGO.crystals_100.crystals, 100)
  assert.equal(CATALOGO.crystals_550.crystals, 550)
  assert.equal(CATALOGO.crystals_1200.crystals, 1200)
  assert.equal(CATALOGO.crystals_3000.crystals, 3000)
})

test('los SKU de las dos tiendas son únicos: dos paquetes no pueden compartir productId', () => {
  const apple = new Set(PAQUETES.map((p) => p.skuApple))
  const google = new Set(PAQUETES.map((p) => p.skuGoogle))
  assert.equal(apple.size, PAQUETES.length)
  assert.equal(google.size, PAQUETES.length)
})

test('el catálogo NO guarda importes en dinero, solo una referencia marcada', () => {
  // El precio real lo localiza cada tienda a partir del tier. Cualquier campo
  // numérico en euros aquí sería un número equivocado en la mayoría de países.
  for (const paquete of PAQUETES) {
    assert.equal(typeof paquete.precioReferencia, 'string')
    assert.match(paquete.precioReferencia, /^~/, 'la referencia tiene que verse como una aproximación')
    assert.ok(!('precio' in paquete), 'ningún paquete puede llevar un importe cobrable')
  }
})

test('resolverPaquete acepta el sku interno y el productId de las dos tiendas', () => {
  assert.equal(resolverPaquete('crystals_550')?.crystals, 550)
  assert.equal(resolverPaquete('app.darma.crystals.550')?.crystals, 550)
  assert.equal(resolverPaquete('app_darma_crystals_550')?.crystals, 550)
})

test('FALLO · resolverPaquete devuelve null ante cualquier cosa desconocida (fail-closed)', () => {
  for (const entrada of [
    '',
    'crystals_999999',
    'CRYSTALS_550',
    'crystals_550 ',
    '../crystals_3000',
    'constructor',
    'toString',
    '__proto__',
    null,
    undefined,
  ]) {
    assert.equal(resolverPaquete(entrada as string), null, `«${String(entrada)}» no debería resolver`)
  }
})

test('FALLO · un cliente que manda una cantidad no consigue nada: la cantidad sale del catálogo', () => {
  // Simula el body hostil del caso nº 8 de la ficha. El servidor solo mira el
  // identificador de producto; `crystals` no participa en ninguna decisión.
  const cuerpoHostil = { sku: 'crystals_100', crystals: 999999, amount: 999999, price: 0 }
  const paquete = resolverPaquete(cuerpoHostil.sku)

  assert.ok(paquete)
  assert.equal(paquete.crystals, 100, 'se acredita la cantidad del catálogo, no la del body')
  assert.notEqual(paquete.crystals, cuerpoHostil.crystals)
})

test('esSkuCristales no se deja engañar por propiedades heredadas de Object', () => {
  // `'constructor' in CATALOGO` es true por la cadena de prototipos; usar `in`
  // en vez de `hasOwnProperty` convertiría eso en un SKU válido.
  assert.equal(esSkuCristales('constructor'), false)
  assert.equal(esSkuCristales('hasOwnProperty'), false)
  assert.equal(esSkuCristales('crystals_100'), true)
})

test('COMISION_TIENDA es documental y refleja el 30 % de las plataformas', () => {
  assert.equal(COMISION_TIENDA, 0.3)
})
