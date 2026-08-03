// ============================================================================
// B06 · Movimiento y traducción de fila. Caso 6 de «Pruebas exigidas», más la
// barrera de anonimato de `aFilaRanking`.
// ============================================================================

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { aFilaRanking, calcularMovimiento } from './movimiento.ts'
import type { FilaTableroSql } from './tipos.ts'

function filaSql(extra: Partial<FilaTableroSql> = {}): FilaTableroSql {
  return {
    rank: 5,
    listens: 30,
    prev_rank: 8,
    built_at: '2026-08-03T10:07:00.000Z',
    user_id: '6f1c7c4e-3a2b-4d5e-8f90-1a2b3c4d5e6f',
    alias: 'lunaquieta',
    avatar_seed: 'a1b2c3d4',
    level: 'brote',
    ...extra,
  }
}

describe('calcularMovimiento', () => {
  it('positivo cuando sube', () => {
    assert.equal(calcularMovimiento('semana', 5, 8), 3)
  })

  it('negativo cuando baja', () => {
    assert.equal(calcularMovimiento('semana', 12, 4), -8)
  })

  it('cero cuando se mantiene', () => {
    assert.equal(calcularMovimiento('mes', 3, 3), 0)
  })

  it('null cuando no había corte anterior — es «entra nuevo», no «bajó a cero»', () => {
    assert.equal(calcularMovimiento('semana', 5, null), null)
    assert.equal(calcularMovimiento('mes', 5, undefined), null)
  })

  it('SIEMPRE null en histórico, aunque haya prev_rank', () => {
    // Es la regla que más fácil se rompe: la foto del histórico SÍ tiene
    // `prev_rank` si alguien reconstruyó un corte anterior, así que sin este
    // corte el delta saldría y mediría el ruido de la última hora disfrazado de
    // progreso del periodo.
    assert.equal(calcularMovimiento('historico', 5, 8), null)
    assert.equal(calcularMovimiento('historico', 5, 1), null)
    assert.equal(calcularMovimiento('historico', 1, 1), null)
  })
})

describe('aFilaRanking', () => {
  it('traduce la fila cruda al contrato', () => {
    assert.deepEqual(aFilaRanking(filaSql(), 'semana'), {
      posicion: 5,
      perfil: {
        id: '6f1c7c4e-3a2b-4d5e-8f90-1a2b3c4d5e6f',
        alias: 'lunaquieta',
        avatarSeed: 'a1b2c3d4',
        nivel: 'brote',
      },
      escuchas: 30,
      movimiento: 3,
    })
  })

  it('el perfil expone EXACTAMENTE cuatro campos, y son los públicos', () => {
    const fila = aFilaRanking(filaSql(), 'semana')
    assert.deepEqual(Object.keys(fila.perfil).sort(), ['alias', 'avatarSeed', 'id', 'nivel'])
  })

  it('CAMINO DE FALLO · una columna nueva en el SQL no se cuela en la respuesta', () => {
    // El día que alguien añada `country` o `karma_spendable` al `returns table`
    // de la función, un `...fila` lo publicaría en silencio. Aquí se enumeran
    // los campos, así que se ignora.
    const contaminada = {
      ...filaSql(),
      karma_spendable: 999,
      crystals: 42,
      listens_given: 7,
      shadow_banned: true,
      email: 'nadie@example.com',
    } as unknown as FilaTableroSql

    const fila = aFilaRanking(contaminada, 'semana')
    const serializada = JSON.stringify(fila)

    for (const prohibido of ['karma_spendable', 'crystals', 'listens_given', 'shadow_banned', 'email']) {
      assert.equal(serializada.includes(prohibido), false, `se filtró ${prohibido}`)
    }
  })

  it('en histórico el movimiento se anula al traducir, no solo al pintar', () => {
    assert.equal(aFilaRanking(filaSql({ prev_rank: 90 }), 'historico').movimiento, null)
  })
})
