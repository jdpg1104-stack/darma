// ============================================================================
// B06 · Techo antifarmeo. Casos 3 y 4 de «Pruebas exigidas».
//
// El caso 4 es el importante y el que parece tonto: comprueba que
// LISTENS_DIA_MAX se DERIVA de lib/karma.ts en vez de estar tecleado. Falla si
// alguien sustituye la división por el literal 12, que es exactamente el
// «arreglito» que dejaría el ranking premiando lo que la economía ya no paga el
// día que cambie el tope diario.
// ============================================================================

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { DAILY_KARMA_CAP, KARMA_WEIGHTS } from '../karma.ts'
import { LISTENS_DIA_MAX, escuchasConTecho } from './techo.ts'

describe('LISTENS_DIA_MAX', () => {
  it('coincide con DAILY_KARMA_CAP / reputación del comentario validado', () => {
    assert.equal(
      LISTENS_DIA_MAX,
      Math.floor(DAILY_KARMA_CAP / KARMA_WEIGHTS.comment_validated.reputation),
    )
  })

  it('vale 12 con la economía de hoy (120 / 10)', () => {
    // Este caso NO sustituye al anterior: comprueba el valor actual para que un
    // cambio de la economía se vea aquí, mientras que el de arriba comprueba la
    // relación. Si algún día este falla y el otro no, la economía cambió a
    // propósito y hay que actualizar el número; si falla el otro, alguien
    // tecleó una constante.
    assert.equal(LISTENS_DIA_MAX, 12)
  })

  it('NO está tecleado: el fuente deriva el valor de lib/karma.ts', () => {
    const fuente = readFileSync(new URL('./techo.ts', import.meta.url), 'utf8')
    assert.match(fuente, /DAILY_KARMA_CAP\s*\/\s*KARMA_WEIGHTS\.comment_validated\.reputation/)
    // Y no hay ninguna asignación con el literal.
    assert.doesNotMatch(fuente, /LISTENS_DIA_MAX\s*(:\s*number\s*)?=\s*12\b/)
  })
})

describe('escuchasConTecho · CAMINO DE FALLO (el que importa)', () => {
  it('300 escuchas en UN día agregan al techo, no a 300', () => {
    // Sin el `least`, quien encuentre una forma de validar 300 comentarios en
    // una noche encabeza la tabla aunque su karma esté topado desde el número
    // 12, y el tope diario deja de significar nada.
    assert.equal(escuchasConTecho([300]), LISTENS_DIA_MAX)
    assert.equal(escuchasConTecho([300]), 12)
  })

  it('el techo es POR DÍA, no por periodo', () => {
    // Cinco días de farmeo siguen sumando: lo que se limita es el ritmo diario,
    // no la constancia. Premiar la constancia es justo lo que el ranking quiere.
    assert.equal(escuchasConTecho([300, 300, 300, 300, 300]), 5 * 12)
  })

  it('no toca los días por debajo del techo', () => {
    assert.equal(escuchasConTecho([3, 7, 12]), 22)
  })

  it('mezcla días topados y no topados sin recortar de más', () => {
    assert.equal(escuchasConTecho([50, 4, 12, 1]), 12 + 4 + 12 + 1)
  })

  it('una serie vacía es 0, no NaN', () => {
    assert.equal(escuchasConTecho([]), 0)
  })

  it('un negativo imposible se trata como 0, nunca resta', () => {
    // La base lo impide con `check (listens >= 0)`, pero un valor negativo que
    // llegara por otra vía no puede restarle escuchas a otro día.
    assert.equal(escuchasConTecho([-5, 8]), 8)
  })

  it('el techo es inyectable para poder razonar sobre otra economía', () => {
    assert.equal(escuchasConTecho([300, 2], 20), 22)
  })
})
