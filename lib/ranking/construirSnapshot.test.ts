// ============================================================================
// B06 · El constructor, con un doble del cliente de Supabase.
//
// Lo que se prueba aquí es la parte que vive en Node: la resolución de cortes,
// el techo que se PASA (no se teclea), el presupuesto de tiempo y el encadenado
// de lotes. La clasificación y la idempotencia de la escritura viven en SQL y se
// verifican contra Postgres de verdad (ver el informe del bloque).
// ============================================================================

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import { construirSnapshot } from './construirSnapshot.ts'
import { LISTENS_DIA_MAX } from './techo.ts'

interface Llamada {
  fn: string
  args: Record<string, unknown>
}

/** Doble mínimo: registra las llamadas y devuelve las respuestas en cola. */
function clienteFalso(respuestas: Array<{ filas: number; ultimo_usuario: string | null; completado: boolean }>) {
  const llamadas: Llamada[] = []
  let indice = 0

  const cliente = {
    rpc(fn: string, args: Record<string, unknown>) {
      llamadas.push({ fn, args })
      const respuesta = respuestas[Math.min(indice++, respuestas.length - 1)]
      return Promise.resolve({ data: [respuesta], error: null })
    },
  } as unknown as SupabaseClient

  return { cliente, llamadas }
}

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

describe('construirSnapshot · cortes', () => {
  it('resuelve el corte de la semana con el reloj de negocio', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 3, ultimo_usuario: UUID_A, completado: true }])

    const resultado = await construirSnapshot(cliente, {
      periodo: 'semana',
      ahora: new Date('2026-08-05T09:00:00Z'), // miércoles
    })

    assert.equal(resultado.corte, '2026-08-03') // el lunes
    assert.equal(llamadas[0]!.args.p_corte, '2026-08-03')
    assert.equal(llamadas[0]!.args.p_corte_fin, '2026-08-10')
    assert.equal(llamadas[0]!.args.p_corte_anterior, '2026-07-27')
  })

  it('el corte anterior de un corte PASADO se calcula sobre ese corte, no sobre hoy', async () => {
    // Reconstruir a mano la semana del 2 de marzo tiene que comparar con la del
    // 23 de febrero. Con «el periodo anterior a ahora», la insignia de
    // movimiento mentiría en toda la tabla.
    const { cliente, llamadas } = clienteFalso([{ filas: 1, ultimo_usuario: UUID_A, completado: true }])

    await construirSnapshot(cliente, {
      periodo: 'semana',
      corte: '2026-03-02',
      ahora: new Date('2026-08-05T09:00:00Z'),
    })

    assert.equal(llamadas[0]!.args.p_corte_anterior, '2026-02-23')
    assert.equal(llamadas[0]!.args.p_corte_fin, '2026-03-09')
  })

  it('el histórico va con ventana abierta y sin corte anterior', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 9, ultimo_usuario: UUID_A, completado: true }])

    const resultado = await construirSnapshot(cliente, { periodo: 'historico' })

    assert.equal(resultado.corte, '1970-01-01')
    assert.equal(llamadas[0]!.args.p_corte_fin, null)
    assert.equal(llamadas[0]!.args.p_corte_anterior, null)
  })
})

describe('construirSnapshot · techo antifarmeo', () => {
  it('pasa a Postgres el techo DERIVADO de lib/karma.ts', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 1, ultimo_usuario: UUID_A, completado: true }])
    await construirSnapshot(cliente, { periodo: 'mes' })

    assert.equal(llamadas[0]!.args.p_listens_dia_max, LISTENS_DIA_MAX)
    assert.equal(llamadas[0]!.args.p_listens_dia_max, 12)
  })
})

describe('construirSnapshot · presupuesto y continuación', () => {
  it('encadena lotes hasta que el constructor dice que terminó', async () => {
    const { cliente, llamadas } = clienteFalso([
      { filas: 20_000, ultimo_usuario: UUID_A, completado: false },
      { filas: 20_000, ultimo_usuario: UUID_B, completado: false },
      { filas: 137, ultimo_usuario: UUID_B, completado: true },
    ])

    const resultado = await construirSnapshot(cliente, { periodo: 'semana' })

    assert.equal(llamadas.length, 3)
    assert.equal(resultado.filas, 40_137)
    assert.equal(resultado.completado, true)
    // Cada lote continúa donde acabó el anterior.
    assert.equal(llamadas[0]!.args.p_desde_usuario, null)
    assert.equal(llamadas[1]!.args.p_desde_usuario, UUID_A)
    assert.equal(llamadas[2]!.args.p_desde_usuario, UUID_B)
  })

  it('CAMINO DE FALLO · al agotarse el presupuesto devuelve completado:false y el cursor', async () => {
    const { cliente, llamadas } = clienteFalso([
      { filas: 20_000, ultimo_usuario: UUID_A, completado: false },
    ])

    // Reloj que salta 60 s en el primer tic tras el arranque.
    let tics = 0
    const reloj = () => (tics++ === 0 ? 0 : 60_000)

    const resultado = await construirSnapshot(cliente, {
      periodo: 'semana',
      presupuestoMs: 50_000,
      reloj,
    })

    assert.equal(llamadas.length, 1, 'no debe intentar un segundo lote sin presupuesto')
    assert.equal(resultado.completado, false)
    assert.equal(resultado.ultimoUsuario, UUID_A)
  })

  it('con el presupuesto YA agotado al entrar, hace un lote igualmente', async () => {
    // Si no, un disparo que llega tarde devolvería `completado:false` sin haber
    // escrito nada y el cron se quedaría dando vueltas sin avanzar nunca.
    const { cliente, llamadas } = clienteFalso([{ filas: 5, ultimo_usuario: UUID_A, completado: true }])

    const resultado = await construirSnapshot(cliente, {
      periodo: 'semana',
      presupuestoMs: 0,
      reloj: () => 0,
    })

    assert.equal(llamadas.length, 1)
    assert.equal(resultado.filas, 5)
  })

  it('reanuda desde `desdeUsuario` cuando se lo pasan', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 12, ultimo_usuario: UUID_B, completado: true }])
    await construirSnapshot(cliente, { periodo: 'semana', desdeUsuario: UUID_A })
    assert.equal(llamadas[0]!.args.p_desde_usuario, UUID_A)
  })
})

describe('construirSnapshot · CAMINO DE FALLO de entrada', () => {
  it('un periodo inventado lanza antes de tocar la base', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 0, ultimo_usuario: null, completado: true }])
    await assert.rejects(
      // @ts-expect-error probamos lo que el compilador ya impide
      () => construirSnapshot(cliente, { periodo: 'trimestre' }),
      RangeError,
    )
    assert.equal(llamadas.length, 0)
  })

  it('un corte que no es una fecha real lanza antes de tocar la base', async () => {
    const { cliente, llamadas } = clienteFalso([{ filas: 0, ultimo_usuario: null, completado: true }])
    await assert.rejects(
      () => construirSnapshot(cliente, { periodo: 'mes', corte: '2026-02-31' }),
      RangeError,
    )
    assert.equal(llamadas.length, 0)
  })

  it('un error de Postgres se propaga; NO se devuelve una foto a medias como si fuera buena', async () => {
    const cliente = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    } as unknown as SupabaseClient

    await assert.rejects(() => construirSnapshot(cliente, { periodo: 'semana' }), /fallo al construir/)
  })

  it('si el constructor no devuelve fila, es un error y no un cero silencioso', async () => {
    const cliente = {
      rpc: () => Promise.resolve({ data: [], error: null }),
    } as unknown as SupabaseClient

    await assert.rejects(() => construirSnapshot(cliente, { periodo: 'semana' }), /no devolvió resultado/)
  })
})
