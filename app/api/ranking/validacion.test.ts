// ============================================================================
// B06 · Caso 8 de «Pruebas exigidas», entero:
//   · `?limite=500` → 422 `entrada_invalida` (RECHAZO, no recorte silencioso)
//   · cursor corrupto → 422, nunca un 500 ni una página vacía sin avisar
//
// Un recorte silencioso convierte un cliente roto en un bug que nadie ve:
// alguien pide 500, recibe 20 y concluye que el tablero solo tiene 20 personas.
// ============================================================================

import assert from 'node:assert/strict'
import test, { describe, it } from 'node:test'

import { esErrorApi } from '../../../lib/auth/errores.ts'
import { codificarCursor } from '../../../lib/ranking/cursor.ts'
import {
  parsearCuerpoSnapshot,
  parsearParametrosTablero,
  parsearPeriodo,
} from './validacion.ts'

const UUID = '6f1c7c4e-3a2b-4d5e-8f90-1a2b3c4d5e6f'

function params(entrada: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(entrada)
}

/** Ejecuta y devuelve el código del ErrorApi lanzado, o `null` si no lanzó. */
function codigoDelFallo(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (causa) {
    assert.ok(esErrorApi(causa), `esperaba un ErrorApi, llegó ${String(causa)}`)
    return causa.code
  }
}

describe('parsearParametrosTablero · camino feliz', () => {
  it('sin parámetros: semana, 20, sin cursor', () => {
    assert.deepEqual(parsearParametrosTablero(params()), {
      periodo: 'semana',
      limite: 20,
      cursor: null,
    })
  })

  it('acepta los tres periodos', () => {
    for (const periodo of ['semana', 'mes', 'historico']) {
      assert.equal(parsearParametrosTablero(params({ periodo })).periodo, periodo)
    }
  })

  it('acepta el límite máximo exacto', () => {
    assert.equal(parsearParametrosTablero(params({ limite: '50' })).limite, 50)
  })

  it('decodifica un cursor válido', () => {
    const cursor = codificarCursor({ rank: 21, userId: UUID })
    assert.deepEqual(parsearParametrosTablero(params({ cursor })).cursor, { rank: 21, userId: UUID })
  })
})

describe('parsearParametrosTablero · CAMINO DE FALLO', () => {
  it('limite=500 → entrada_invalida, NO se recorta a 50', () => {
    assert.equal(codigoDelFallo(() => parsearParametrosTablero(params({ limite: '500' }))), 'entrada_invalida')
  })

  it('limite=51 (uno de más) también falla', () => {
    assert.equal(codigoDelFallo(() => parsearParametrosTablero(params({ limite: '51' }))), 'entrada_invalida')
  })

  it('limite=0, negativo o no entero falla', () => {
    for (const limite of ['0', '-3', '2.5', 'muchos', '1e9']) {
      assert.equal(
        codigoDelFallo(() => parsearParametrosTablero(params({ limite }))),
        'entrada_invalida',
        `aceptó limite=${limite}`,
      )
    }
  })

  it('un periodo inventado falla en la API (en la PÁGINA se cae a semana, que es otra cosa)', () => {
    assert.equal(
      codigoDelFallo(() => parsearParametrosTablero(params({ periodo: 'trimestre' }))),
      'entrada_invalida',
    )
  })

  it('cursor «no es base64» → entrada_invalida, nunca un 500', () => {
    assert.equal(
      codigoDelFallo(() => parsearParametrosTablero(params({ cursor: 'esto no es un cursor' }))),
      'entrada_invalida',
    )
  })

  it('cursor con rank negativo → entrada_invalida', () => {
    const cursor = codificarCursor({ rank: -5, userId: UUID })
    assert.equal(codigoDelFallo(() => parsearParametrosTablero(params({ cursor }))), 'entrada_invalida')
  })

  it('cursor con un uuid falso → entrada_invalida', () => {
    const cursor = Buffer.from('3:no-soy-un-uuid', 'utf8').toString('base64url')
    assert.equal(codigoDelFallo(() => parsearParametrosTablero(params({ cursor }))), 'entrada_invalida')
  })

  it('un cursor gigante se rechaza antes de decodificarlo', () => {
    assert.equal(
      codigoDelFallo(() => parsearParametrosTablero(params({ cursor: 'A'.repeat(5000) }))),
      'entrada_invalida',
    )
  })
})

describe('parsearPeriodo', () => {
  it('por defecto, semana', () => {
    assert.equal(parsearPeriodo(params()), 'semana')
  })

  it('un periodo inventado → entrada_invalida', () => {
    assert.equal(codigoDelFallo(() => parsearPeriodo(params({ periodo: 'ayer' }))), 'entrada_invalida')
  })
})

describe('parsearCuerpoSnapshot', () => {
  it('sin cuerpo es válido: el cron dispara sin body', () => {
    assert.deepEqual(parsearCuerpoSnapshot(null), {})
    assert.deepEqual(parsearCuerpoSnapshot(undefined), {})
    assert.deepEqual(parsearCuerpoSnapshot({}), {})
  })

  it('acepta periodo y corte para reconstruir un corte pasado', () => {
    assert.deepEqual(parsearCuerpoSnapshot({ periodo: 'mes', corte: '2026-02-01' }), {
      periodo: 'mes',
      corte: '2026-02-01',
    })
  })

  it('CAMINO DE FALLO · una fecha que no existe se rechaza', () => {
    // 2026-02-31 pasa cualquier expresión regular de forma y produciría una foto
    // vacía sin que nada lo señalara.
    assert.equal(
      codigoDelFallo(() => parsearCuerpoSnapshot({ corte: '2026-02-31' })),
      'entrada_invalida',
    )
  })

  it('CAMINO DE FALLO · un campo desconocido se rechaza (esquema estricto)', () => {
    // `p_max_filas` o `p_listens_dia_max` colados por el body serían una vía
    // para desactivar el techo antifarmeo desde fuera.
    assert.equal(
      codigoDelFallo(() => parsearCuerpoSnapshot({ periodo: 'semana', listensDiaMax: 9999 })),
      'entrada_invalida',
    )
  })

  it('CAMINO DE FALLO · un periodo inventado se rechaza', () => {
    assert.equal(codigoDelFallo(() => parsearCuerpoSnapshot({ periodo: 'siempre' })), 'entrada_invalida')
  })
})

test('el tope de página está en zod Y en el SQL: son dos barreras, no una', async () => {
  // Documenta la intención para quien venga a «simplificar» quitando una de las
  // dos. zod da el error claro; el `least(...)` de ranking_tablero() garantiza
  // que un cliente que hable con PostgREST directamente tampoco pida 5 000.
  assert.equal(codigoDelFallo(() => parsearParametrosTablero(params({ limite: '5000' }))), 'entrada_invalida')
})
