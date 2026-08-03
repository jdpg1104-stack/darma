// ============================================================================
// Pruebas del umbral de revelación y del reparto de porcentajes.
//
// Son las pruebas de privacidad del bloque: cada una describe una forma
// concreta en la que un agregado puede delatar a quien votó.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { MIN_REVELACION_POR_DEFECTO } from './limites.ts'
import { aEncuestaFeed, esFilaEncuesta, repartirPorcentajes } from './resultados.ts'
import type { FilaEncuesta, FilaOpcion } from './tipos.ts'

function fila(parcial: Partial<FilaEncuesta> = {}): FilaEncuesta {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    question: '¿Ha pasado algo bueno hoy, aunque sea pequeño?',
    total_votes: 0,
    min_reveal: MIN_REVELACION_POR_DEFECTO,
    closes_at: null,
    origin: 'banco',
    mi_voto: null,
    options: opciones([null, null, null]),
    ...parcial,
  }
}

function opciones(recuentos: readonly (number | null)[]): FilaOpcion[] {
  return recuentos.map((vote_count, i) => ({
    id: `opt-${i}`,
    ordinal: i,
    label: `Opción ${i}`,
    vote_count,
  }))
}

// ── 5 · Por debajo del umbral no sale NADA ─────────────────────────────────

test('con total_votes < min_reveal: revelado false, votos y porcentaje null en TODAS', () => {
  const e = aEncuestaFeed(fila({ total_votes: 4, options: opciones([null, null, null]) }))

  assert.equal(e.revelado, false)
  assert.equal(e.totalVotos, 4, 'el total SÍ es público: ocultarlo sería mentir sobre algo comprobable')
  for (const o of e.opciones) {
    assert.equal(o.votos, null)
    assert.equal(o.porcentaje, null)
  }
})

test('aunque Postgres se equivocara y mandara recuentos, por debajo del umbral no se publican', () => {
  // La segunda llave: si alguien reescribe la función SQL y se le olvida el
  // `case`, el fallo tiene que notarse aquí y no en producción.
  const e = aEncuestaFeed(fila({ total_votes: 2, options: opciones([2, 0, 0]) }))
  assert.equal(e.revelado, false)
  assert.deepEqual(e.opciones.map((o) => o.votos), [null, null, null])
})

test('con un solo voto no se revela: el primero que vota vería 100 % y deduciría al segundo', () => {
  assert.equal(aEncuestaFeed(fila({ total_votes: 1, options: opciones([1, 0, 0]) })).revelado, false)
})

test('quien acaba de votar tampoco ve el agregado por debajo del umbral', () => {
  const e = aEncuestaFeed(fila({ total_votes: 3, mi_voto: 'opt-0', options: opciones([null, null, null]) }))
  assert.equal(e.revelado, false)
  assert.equal(e.miVoto, 'opt-0', 'su PROPIO voto sí lo ve: es suyo')
})

test('si falta el recuento de UNA opción, no se revela ninguna', () => {
  const e = aEncuestaFeed(fila({ total_votes: 9, options: opciones([4, null, 5]) }))
  assert.equal(e.revelado, false)
})

// ── 6 · Al superar el umbral, los porcentajes suman 100 ────────────────────

test('3 opciones y 7 votos (3/2/2) → 43/29/28, que suma 100', () => {
  const e = aEncuestaFeed(fila({ total_votes: 7, options: opciones([3, 2, 2]) }))

  assert.equal(e.revelado, true)
  assert.deepEqual(e.opciones.map((o) => o.porcentaje), [43, 29, 28])
  assert.deepEqual(e.opciones.map((o) => o.votos), [3, 2, 2])
  // Redondear cada uno por su cuenta daría 43/29/29 = 101. El resto sobrante se
  // reparte por resto mayor y el empate lo rompe el ordinal más bajo.
  assert.equal(e.opciones.reduce((a, o) => a + (o.porcentaje ?? 0), 0), 100)
})

test('justo en min_reveal ya se revela (el umbral es >=, no >)', () => {
  const e = aEncuestaFeed(fila({ total_votes: 5, min_reveal: 5, options: opciones([3, 1, 1]) }))
  assert.equal(e.revelado, true)
})

test('el reparto suma 100 en muchos casos con resto', () => {
  const casos: number[][] = [
    [1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [2, 3, 5, 7],
    [1, 2, 3, 4, 5],
    [10, 10, 10],
    [0, 1, 0],
    [999, 1, 1],
  ]
  for (const caso of casos) {
    const suma = repartirPorcentajes(caso).reduce((a, b) => a + b, 0)
    assert.equal(suma, 100, `no suma 100 con ${JSON.stringify(caso)}`)
  }
})

test('sin votos, todo a 0 y no 100/n (repartir lo que no existe es inventarlo)', () => {
  assert.deepEqual(repartirPorcentajes([0, 0, 0]), [0, 0, 0])
})

test('el reparto es determinista: el mismo recuento da siempre lo mismo', () => {
  const a = repartirPorcentajes([3, 2, 2])
  const b = repartirPorcentajes([3, 2, 2])
  assert.deepEqual(a, b)
})

test('el reparto no muta el array de entrada', () => {
  const entrada = [3, 2, 2]
  repartirPorcentajes(entrada)
  assert.deepEqual(entrada, [3, 2, 2])
})

// ── Proyección: lo que NO sale ─────────────────────────────────────────────

test('EncuestaFeed no expone min_reveal, autor, estado ni nada de poll_votes', () => {
  const e = aEncuestaFeed(fila({ total_votes: 7, options: opciones([3, 2, 2]) }))
  const claves = Object.keys(e).sort()

  assert.deepEqual(claves, [
    'cierraEn',
    'id',
    'miVoto',
    'opciones',
    'origen',
    'pregunta',
    'revelado',
    'totalVotos',
  ])

  for (const o of e.opciones) {
    assert.deepEqual(Object.keys(o).sort(), ['id', 'label', 'ordinal', 'porcentaje', 'votos'])
  }
})

test('las opciones salen ordenadas por ordinal aunque lleguen desordenadas', () => {
  const desordenadas: FilaOpcion[] = [
    { id: 'c', ordinal: 2, label: 'C', vote_count: 1 },
    { id: 'a', ordinal: 0, label: 'A', vote_count: 5 },
    { id: 'b', ordinal: 1, label: 'B', vote_count: 1 },
  ]
  const e = aEncuestaFeed(fila({ total_votes: 7, options: desordenadas }))
  assert.deepEqual(e.opciones.map((o) => o.label), ['A', 'B', 'C'])
})

// ── esFilaEncuesta ─────────────────────────────────────────────────────────

test('esFilaEncuesta rechaza null, undefined y una forma incompleta', () => {
  assert.equal(esFilaEncuesta(null), false)
  assert.equal(esFilaEncuesta(undefined), false)
  assert.equal(esFilaEncuesta({ id: 'x' }), false)
  assert.equal(esFilaEncuesta({ ...fila(), origin: 'otro' }), false)
  assert.equal(esFilaEncuesta(fila()), true)
})
