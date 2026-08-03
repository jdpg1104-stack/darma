import test from 'node:test'
import assert from 'node:assert/strict'

import { compararCatalogos, aplanar, type Catalogo } from './validacion.ts'
import { firmaIcu, formatearIcu, parsearIcu, ErrorIcu } from './icu.ts'
import { CODIGOS_DE_ERROR, MENSAJES, RAICES_DE_DOMINIO } from './index.ts'

/**
 * El catálogo tal y como lo ve la app. Se lee de `MENSAJES` y no de los dos JSON
 * directamente para que el guard mire exactamente lo que la aplicación resuelve:
 * si algún día vuelve a haber una capa intermedia —hubo una de parches durante
 * la migración— este test la cubre sin que nadie tenga que acordarse.
 */
const CATALOGOS = { es: MENSAJES.es as Catalogo, en: MENSAJES.en as Catalogo }

// ── Paridad real ────────────────────────────────────────────────────────────

test('es.json y en.json tienen exactamente las mismas claves', () => {
  const problemas = compararCatalogos(CATALOGOS).filter((p) => p.tipo === 'falta')
  assert.deepEqual(
    problemas.map((p) => p.detalle),
    [],
    'una clave que existe en un idioma y falta en el otro deja media app sin traducir',
  )
})

test('ninguna cadena traducida está vacía ni deja de ser texto', () => {
  const problemas = compararCatalogos(CATALOGOS).filter(
    (p) => p.tipo === 'vacia' || p.tipo === 'no_es_texto',
  )
  assert.deepEqual(problemas.map((p) => p.detalle), [])
})

test('los placeholders ICU coinciden entre idiomas', () => {
  const problemas = compararCatalogos(CATALOGOS).filter(
    (p) => p.tipo === 'icu_distinto' || p.tipo === 'icu_invalido',
  )
  assert.deepEqual(
    problemas.map((p) => p.detalle),
    [],
    '{n} en es y {count} en en es un fallo que solo se ve en producción',
  )
})

test('el catálogo no tiene NINGÚN problema', () => {
  assert.deepEqual(compararCatalogos(CATALOGOS).map((p) => p.detalle), [])
})

// ── Estructura por dominio ──────────────────────────────────────────────────

test('las 15 raíces de dominio existen en los dos idiomas', () => {
  for (const [idioma, catalogo] of Object.entries(CATALOGOS)) {
    for (const raiz of RAICES_DE_DOMINIO) {
      assert.ok(Object.hasOwn(catalogo, raiz), `falta la raíz "${raiz}" en ${idioma}.json`)
    }
    // Y nada fuera de las raíces declaradas: el catálogo se organiza por
    // dominio, no por pantalla, y una raíz suelta rompe el `pick` del provider.
    for (const raiz of Object.keys(catalogo)) {
      assert.ok(
        (RAICES_DE_DOMINIO as readonly string[]).includes(raiz),
        `raíz no declarada "${raiz}" en ${idioma}.json`,
      )
    }
  }
})

test('cada ErrorCode de CONTRATOS §4 tiene su clave en los dos idiomas', () => {
  for (const [idioma, catalogo] of Object.entries(CATALOGOS)) {
    const plano = aplanar(catalogo)
    for (const codigo of CODIGOS_DE_ERROR) {
      assert.ok(plano.has(`errores.${codigo}`), `falta errores.${codigo} en ${idioma}.json`)
    }
    // Y ninguna clave de más bajo `errores.`: si aparece una, o sobra o el
    // contrato cambió y nadie lo dijo.
    const enCatalogo = [...plano.keys()].filter((k) => k.startsWith('errores.'))
    assert.equal(enCatalogo.length, CODIGOS_DE_ERROR.length, `errores.* descuadra en ${idioma}.json`)
  }
})

// ── El guard falla cuando debe fallar ───────────────────────────────────────

test('CLAVE QUE FALTA: el guard falla y NOMBRA la clave concreta', () => {
  const problemas = compararCatalogos({
    es: { comun: { hola: 'Hola', adios: 'Adiós' } },
    en: { comun: { hola: 'Hi' } },
  })

  assert.equal(problemas.length, 1)
  assert.equal(problemas[0].tipo, 'falta')
  assert.equal(problemas[0].clave, 'comun.adios')
  assert.match(problemas[0].detalle, /comun\.adios/)
  assert.match(problemas[0].detalle, /"en"/)
  // Y no se queja de la que sí está.
  assert.doesNotMatch(problemas[0].detalle, /comun\.hola/)
})

test('PLACEHOLDER DISTINTO: el guard falla y enseña las dos firmas', () => {
  const problemas = compararCatalogos({
    es: { feed: { saludo: 'Hola {n}' } },
    en: { feed: { saludo: 'Hi {count}' } },
  })

  assert.equal(problemas.length, 1)
  assert.equal(problemas[0].tipo, 'icu_distinto')
  assert.match(problemas[0].detalle, /feed\.saludo/)
  assert.match(problemas[0].detalle, /n:simple/)
  assert.match(problemas[0].detalle, /count:simple/)
})

test('CADENA VACÍA y valor que no es texto: también fallan', () => {
  const problemas = compararCatalogos({
    es: { comun: { vacia: '   ', numero: 3 } },
    en: { comun: { vacia: 'Something', numero: 'three' } },
  })

  const tipos = problemas.map((p) => `${p.clave}:${p.tipo}`)
  assert.ok(tipos.includes('comun.vacia:vacia'), tipos.join(', '))
  assert.ok(tipos.includes('comun.numero:no_es_texto'), tipos.join(', '))
})

test('ICU ROTO: el guard lo caza en vez de esperar a producción', () => {
  const problemas = compararCatalogos({
    es: { comun: { roto: 'Te quedan {n, plural, one {una}' } },
    en: { comun: { roto: 'You have {n, plural, one {one} other {#}}' } },
  })
  assert.ok(problemas.some((p) => p.tipo === 'icu_invalido' && p.clave === 'comun.roto'))
})

test('un plural sin rama "other" es ICU inválido', () => {
  assert.throws(() => parsearIcu('{n, plural, one {uno}}'), ErrorIcu)
})

// ── El intérprete ICU ───────────────────────────────────────────────────────

test('firmaIcu no confunde una rama de plural con un argumento', () => {
  // "other {vacío}" es una RAMA, no un placeholder llamado "vacío". Una regex
  // ingenua se traga esto y el guard empieza a mentir.
  assert.deepEqual(firmaIcu('{n, plural, one {uno} other {vacio}}'), ['n:plural(one,other)'])
  assert.deepEqual(firmaIcu('Sin nada que interpolar'), [])
  assert.deepEqual(firmaIcu('{a} y {b}'), ['a:simple', 'b:simple'])
})

test('formatearIcu: plural con #, select y claves exactas =0', () => {
  assert.equal(formatearIcu('{n, plural, =0 {nadie} one {una} other {#}}', { n: 0 }), 'nadie')
  assert.equal(formatearIcu('{n, plural, =0 {nadie} one {una} other {#}}', { n: 1 }), 'una')
  assert.equal(formatearIcu('{n, plural, =0 {nadie} one {una} other {#}}', { n: 7 }), '7')
  assert.equal(formatearIcu('{x, select, a {A} other {O}}', { x: 'a' }), 'A')
  assert.equal(formatearIcu('{x, select, a {A} other {O}}', { x: 'z' }), 'O')
})

test('formatearIcu: un parámetro que falta se ve, no se convierte en "undefined"', () => {
  assert.equal(formatearIcu('Hola {alias}'), 'Hola {alias}')
})

test('formatearIcu: las comillas simples escapan las llaves de ICU', () => {
  assert.equal(formatearIcu("Esto es una llave: '{' literal"), 'Esto es una llave: { literal')
})
