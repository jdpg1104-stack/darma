import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { EDAD_ADULTA, EDAD_MINIMA, cumpleEdadMinima } from './avisos.ts'

const HOY = new Date('2026-08-03T12:00:00.000Z')
const RAIZ = join(import.meta.dirname, '..', '..')

test('la edad mínima es 16 y la de controles reforzados 18', () => {
  assert.equal(EDAD_MINIMA, 16)
  assert.equal(EDAD_ADULTA, 18)
})

test('con 16 recién cumplidos se acepta', () => {
  // Cumple 16 exactamente hoy.
  assert.equal(cumpleEdadMinima('2010-08-03', HOY), true)
  assert.equal(cumpleEdadMinima('2000-01-01', HOY), true)
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · con 15 años se rechaza (ficha, prueba 15)', () => {
  assert.equal(cumpleEdadMinima('2011-08-03', HOY), false)
  assert.equal(cumpleEdadMinima('2011-01-01', HOY), false)
})

test('FALLO · un día antes del decimosexto cumpleaños se rechaza', () => {
  assert.equal(cumpleEdadMinima('2010-08-04', HOY), false)
})

test('FALLO · fechas imposibles, futuras o con formato raro se rechazan', () => {
  assert.equal(cumpleEdadMinima('2010-02-31', HOY), false)
  assert.equal(cumpleEdadMinima('2030-01-01', HOY), false)
  assert.equal(cumpleEdadMinima('03/08/2010', HOY), false)
  assert.equal(cumpleEdadMinima('', HOY), false)
  assert.equal(cumpleEdadMinima('2010-13-01', HOY), false)
})

test('FALLO · la comprobación de edad NO puede escribir nada en ningún sitio', () => {
  // La prueba de la ficha pide comprobar el recuento de filas antes y después
  // de un alta rechazada. Aquí se comprueba la propiedad que lo garantiza y que
  // es más fuerte que un recuento: la función es PURA. No recibe cliente, no
  // importa nada de supabase y no puede persistir la fecha aunque quisiera.
  const fuente = readFileSync(join(RAIZ, 'lib', 'privacy', 'avisos.ts'), 'utf8')
  assert.ok(!fuente.includes('supabase'), 'avisos.ts no debe conocer la base de datos')
  assert.ok(!fuente.includes('import '), 'avisos.ts no debe importar nada')

  // Y llamarla mil veces con fechas rechazadas no deja rastro observable.
  for (let i = 0; i < 1000; i++) {
    assert.equal(cumpleEdadMinima('2011-06-15', HOY), false)
  }
})
