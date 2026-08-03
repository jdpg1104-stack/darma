// ============================================================================
// B06 · Periodos de calendario. Casos 1, 2 y 6 de «Pruebas exigidas».
//
// Todo lo de aquí es puro: `ahora` se inyecta, así que probar el cambio de mes
// y los dos cambios de hora del año es trivial en vez de imposible.
// ============================================================================

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  INICIO_HISTORICO,
  corteAnteriorDe,
  esFechaIso,
  fechaCivil,
  finPeriodo,
  inicioPeriodo,
  inicioPeriodoAnterior,
} from './periodos.ts'

/** Día de la semana ISO (1 = lunes) de una fecha `YYYY-MM-DD`. */
function diaSemanaIso(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

describe('inicioPeriodo · semana', () => {
  it('cae siempre en lunes', () => {
    // Una semana entera de instantes, hora a hora.
    for (let h = 0; h < 24 * 7; h++) {
      const ahora = new Date(Date.UTC(2026, 6, 1, h))
      assert.equal(diaSemanaIso(inicioPeriodo('semana', ahora)), 1, `falló en ${ahora.toISOString()}`)
    }
  })

  it('el domingo a las 23:59 de Madrid sigue en la semana que empezó el lunes anterior', () => {
    // 2026-08-02 es domingo. 23:59 en Madrid (CEST, UTC+2) = 21:59Z.
    const domingoTarde = new Date('2026-08-02T21:59:00Z')
    assert.equal(fechaCivil(domingoTarde).diaSemana, 7)
    assert.equal(inicioPeriodo('semana', domingoTarde), '2026-07-27')

    // Un minuto después ya es lunes en Madrid, y la semana se reinicia.
    const lunesCero = new Date('2026-08-02T22:00:00Z')
    assert.equal(fechaCivil(lunesCero).diaSemana, 1)
    assert.equal(inicioPeriodo('semana', lunesCero), '2026-08-03')
  })

  it('el reloj es el de MADRID, no el del servidor (que en Vercel es UTC)', () => {
    // 2026-08-02T22:30Z: en UTC todavía es domingo; en Madrid ya es lunes.
    // Si alguien usara getUTCDay() en vez de la zona de negocio, este caso da
    // el lunes ANTERIOR y toda la semana contaría mal.
    const instante = new Date('2026-08-02T22:30:00Z')
    assert.equal(instante.getUTCDay(), 0, 'en UTC es domingo')
    assert.equal(inicioPeriodo('semana', instante), '2026-08-03')
  })

  it('sobrevive al cambio de horario de verano de MARZO (el día de 23 horas)', () => {
    // En 2026 el adelanto es el domingo 29 de marzo a las 02:00 CET → 03:00 CEST.
    // 01:30 CET = 00:30Z: sigue siendo domingo 29 → semana del lunes 23.
    assert.equal(inicioPeriodo('semana', new Date('2026-03-29T00:30:00Z')), '2026-03-23')
    // 04:00 CEST = 02:00Z: sigue siendo domingo 29, ya con el reloj adelantado.
    assert.equal(inicioPeriodo('semana', new Date('2026-03-29T02:00:00Z')), '2026-03-23')
    // 00:30 CEST del lunes 30 = 22:30Z del domingo 29 → semana nueva.
    assert.equal(inicioPeriodo('semana', new Date('2026-03-29T22:30:00Z')), '2026-03-30')
  })

  it('sobrevive al cambio de horario de OCTUBRE (el día de 25 horas)', () => {
    // En 2026 el retraso es el domingo 25 de octubre a las 03:00 CEST → 02:00 CET.
    // 02:30 CEST = 00:30Z y 02:30 CET = 01:30Z son el MISMO reloj civil vivido
    // dos veces; los dos siguen siendo domingo 25 → semana del lunes 19.
    assert.equal(inicioPeriodo('semana', new Date('2026-10-25T00:30:00Z')), '2026-10-19')
    assert.equal(inicioPeriodo('semana', new Date('2026-10-25T01:30:00Z')), '2026-10-19')
    // 00:30 CET del lunes 26 = 23:30Z del domingo 25.
    assert.equal(inicioPeriodo('semana', new Date('2026-10-25T23:30:00Z')), '2026-10-26')
  })
})

describe('inicioPeriodo · mes e histórico', () => {
  it('el mes empieza el día 1', () => {
    assert.equal(inicioPeriodo('mes', new Date('2026-08-17T09:00:00Z')), '2026-08-01')
    // 2026-01-31T22:00Z = 23:00 en Madrid (CET): todavía enero.
    assert.equal(inicioPeriodo('mes', new Date('2026-01-31T22:00:00Z')), '2026-01-01')
    // Una hora más y en Madrid ya es 1 de febrero, aunque en UTC siga siendo 31.
    assert.equal(inicioPeriodo('mes', new Date('2026-01-31T23:00:00Z')), '2026-02-01')
  })

  it('el mes también usa el reloj de Madrid en el cambio de mes', () => {
    // 2026-07-31T22:30Z = 2026-08-01T00:30 en Madrid: ya es agosto.
    assert.equal(inicioPeriodo('mes', new Date('2026-07-31T22:30:00Z')), '2026-08-01')
  })

  it('el histórico devuelve la centinela y no depende del reloj', () => {
    assert.equal(inicioPeriodo('historico', new Date('2026-08-17T09:00:00Z')), INICIO_HISTORICO)
    assert.equal(inicioPeriodo('historico', new Date('2019-01-01T00:00:00Z')), INICIO_HISTORICO)
  })
})

describe('inicioPeriodoAnterior', () => {
  it('el 1 de marzo devuelve el 1 de FEBRERO, no «hace 30 días»', () => {
    // Es el caso que rompe cualquier implementación por restar milisegundos:
    // febrero de 2026 tiene 28 días, así que «hace 30 días» daría el 30 de
    // enero y el movimiento se compararía contra un corte que no existe.
    assert.equal(inicioPeriodoAnterior('mes', new Date('2026-03-15T12:00:00Z')), '2026-02-01')
    assert.equal(inicioPeriodoAnterior('mes', new Date('2026-03-01T12:00:00Z')), '2026-02-01')
  })

  it('en enero cruza el año', () => {
    assert.equal(inicioPeriodoAnterior('mes', new Date('2026-01-10T12:00:00Z')), '2025-12-01')
  })

  it('la semana anterior son siete días de calendario exactos', () => {
    assert.equal(inicioPeriodoAnterior('semana', new Date('2026-08-05T12:00:00Z')), '2026-07-27')
  })

  it('la semana anterior también cuadra cruzando el cambio de hora', () => {
    // Semana del lunes 30 de marzo → la anterior es la del 23, aunque entre
    // medias haya un día de 23 horas.
    assert.equal(inicioPeriodoAnterior('semana', new Date('2026-03-31T12:00:00Z')), '2026-03-23')
  })

  it('el histórico NUNCA tiene periodo anterior — de ahí que su movimiento sea null', () => {
    assert.equal(inicioPeriodoAnterior('historico', new Date('2026-08-05T12:00:00Z')), null)
  })
})

describe('finPeriodo y corteAnteriorDe', () => {
  it('la ventana de la semana es [corte, corte+7)', () => {
    assert.equal(finPeriodo('semana', '2026-07-27'), '2026-08-03')
  })

  it('la ventana del mes acaba el día 1 del siguiente, y cruza el año', () => {
    assert.equal(finPeriodo('mes', '2026-08-01'), '2026-09-01')
    assert.equal(finPeriodo('mes', '2026-12-01'), '2027-01-01')
  })

  it('el histórico tiene ventana ABIERTA', () => {
    assert.equal(finPeriodo('historico', INICIO_HISTORICO), null)
  })

  it('corteAnteriorDe se calcula sobre el CORTE, no sobre hoy', () => {
    // Reconstruir a mano la semana del 2 de marzo tiene que comparar con la del
    // 23 de febrero, no con la semana pasada.
    assert.equal(corteAnteriorDe('semana', '2026-03-02'), '2026-02-23')
    assert.equal(corteAnteriorDe('mes', '2026-01-01'), '2025-12-01')
    assert.equal(corteAnteriorDe('historico', INICIO_HISTORICO), null)
  })
})

describe('esFechaIso · camino de fallo', () => {
  it('acepta una fecha real', () => {
    assert.equal(esFechaIso('2026-02-28'), true)
    assert.equal(esFechaIso('2028-02-29'), true) // bisiesto
  })

  it('rechaza una fecha que pasa la expresión regular pero NO existe', () => {
    // Sin el roundtrip, un 2026-02-31 produciría una foto vacía sin que nada
    // lo señalara.
    assert.equal(esFechaIso('2026-02-31'), false)
    assert.equal(esFechaIso('2026-13-01'), false)
    assert.equal(esFechaIso('2027-02-29'), false)
  })

  it('rechaza cualquier cosa que no sea YYYY-MM-DD', () => {
    for (const malo of ['', '2026-8-1', '2026/08/01', '2026-08-01T00:00:00Z', 20260801, null, {}]) {
      assert.equal(esFechaIso(malo), false, `aceptó ${JSON.stringify(malo)}`)
    }
  })
})

describe('camino de fallo · periodo desconocido', () => {
  it('lanza en vez de devolver un corte inventado', () => {
    // @ts-expect-error probamos a propósito lo que el compilador ya impide
    assert.throws(() => inicioPeriodo('trimestre'), RangeError)
    // @ts-expect-error idem
    assert.throws(() => inicioPeriodoAnterior('trimestre'), RangeError)
  })

  it('lanza con un instante inválido en vez de producir NaN-NaN-NaN', () => {
    assert.throws(() => inicioPeriodo('semana', new Date('no soy una fecha')), RangeError)
  })
})
