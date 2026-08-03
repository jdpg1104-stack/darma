// ============================================================================
// Reparto de regalos — la aritmética entera y su borde
//
// El caso nº 4 de la ficha pide `cost = fee + net` para TODOS los precios del
// catálogo, «incluidos los que no dividen exacto». Aquí se recorre el catálogo
// entero y además un barrido de precios, porque el borde de este cálculo no
// está en el catálogo: está en los números pequeños (trampa conocida nº 3).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { LOCALES, obtenerTraductor } from '../../i18n/index.ts'
import { esErrorApi } from '../auth/errores.ts'
import {
  CATALOGO_REGALOS,
  COMISION_REGALO,
  PRECIO_MINIMO_REGALO,
  REGALOS,
  errorDeRegalo,
  esTipoRegalo,
  repartir,
} from './regalos.ts'

test('el reparto cierra para todos los precios del catálogo', () => {
  for (const regalo of REGALOS) {
    const { coste, comision, neto } = repartir(regalo.costeCristales)
    assert.equal(coste, regalo.costeCristales)
    assert.equal(comision + neto, coste, `${regalo.kind} no cierra`)
    assert.ok(neto > 0, `${regalo.kind} deja al receptor sin nada`)
  }
})

test('el reparto cierra también para los precios que NO dividen exacto', () => {
  // 13 · 0,30 = 3,9 → floor 3, neto 10. 101 · 0,30 = 30,3 → floor 30, neto 71.
  for (const coste of [11, 13, 17, 23, 37, 41, 99, 101, 137, 999, 1001]) {
    const { comision, neto } = repartir(coste)
    assert.equal(comision + neto, coste, `${coste} no cierra`)
    assert.equal(comision, Math.floor(coste * COMISION_REGALO))
  }
})

test('el redondeo cae del lado de QUIEN RECIBE, nunca del nuestro', () => {
  // 13 · 0,30 = 3,9. Redondear al alza daría comisión 4 y neto 9: un cristal
  // que sale del regalo y entra en nuestra parte por un decimal.
  const { comision, neto } = repartir(13)
  assert.equal(comision, 3)
  assert.equal(neto, 10)
})

test('FALLO · el borde donde la aritmética entera se degrada queda FUERA del catálogo', () => {
  // Con 1 cristal, `floor(0,3) = 0`: el "regalo con comisión" no tendría
  // comisión. Con 3, tampoco. El precio mínimo se fija por encima de ahí, y
  // este test es el que impide que alguien meta un regalo de 2 cristales.
  assert.equal(repartir(1).comision, 0)
  assert.equal(repartir(3).comision, 0)
  assert.ok(repartir(PRECIO_MINIMO_REGALO).comision > 0)

  for (const regalo of REGALOS) {
    assert.ok(
      regalo.costeCristales >= PRECIO_MINIMO_REGALO,
      `${regalo.kind} cuesta ${regalo.costeCristales}, por debajo del mínimo donde la comisión existe`,
    )
  }
})

test('FALLO · repartir rechaza costes no enteros, negativos o cero', () => {
  for (const malo of [0, -10, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => repartir(malo), (error: unknown) => esErrorApi(error))
  }
})

test('esTipoRegalo no acepta propiedades heredadas ni tipos inventados', () => {
  assert.equal(esTipoRegalo('vela'), true)
  assert.equal(esTipoRegalo('constructor'), false)
  assert.equal(esTipoRegalo('diamante'), false)
  assert.equal(esTipoRegalo(42), false)
})

test('FALLO · los SQLSTATE propios se traducen a códigos públicos, sin filtrar el mensaje de Postgres', () => {
  const sinSaldo = errorDeRegalo({ code: 'DA001', message: 'saldo insuficiente' })
  assert.equal(sinSaldo.code, 'saldo_insuficiente')
  assert.equal(sinSaldo.status, 409)

  const aUnoMismo = errorDeRegalo({ code: 'DA003', message: 'regalo a uno mismo' })
  assert.equal(aUnoMismo.code, 'entrada_invalida')
  assert.equal(aUnoMismo.status, 422)

  // Lo desconocido es 500 genérico: NUNCA "lo que dijera Postgres".
  const raro = errorDeRegalo({ code: '42P01', message: 'relation "gifts" does not exist' })
  assert.equal(raro.code, 'error_interno')
  assert.ok(!raro.message.includes('gifts'), 'el mensaje público no puede llevar el nombre de una tabla')
})

test('🔴 ningún regalo del catálogo promete karma en su etiqueta, EN NINGÚN IDIOMA', () => {
  // El catálogo guarda la CLAVE, así que mirar `claveEtiqueta` no serviría de
  // nada: todas empiezan por `karma.economia.` y la comprobación pasaría
  // siempre. Lo que hay que mirar es el TEXTO que sale de cada idioma — un
  // regalo llamado «Karma boost» solo en `en.json` sería invisible si esto
  // comprobara el español o la clave.
  for (const regalo of REGALOS) {
    for (const locale of LOCALES) {
      const etiqueta = obtenerTraductor(locale)(regalo.claveEtiqueta)
      assert.notEqual(
        etiqueta,
        regalo.claveEtiqueta,
        `${regalo.kind} no tiene texto en ${locale}: la pantalla pintaría la clave`,
      )

      const texto = `${regalo.kind} ${etiqueta}`.toLowerCase()
      for (const palabra of ['karma', 'nivel', 'level', 'rank', 'badge', 'insignia']) {
        assert.ok(
          !texto.includes(palabra),
          `«${etiqueta}» (${locale}) sugiere que el regalo da karma o rango`,
        )
      }
    }
  }
  assert.equal(Object.keys(CATALOGO_REGALOS).length, REGALOS.length)
})
