// ============================================================================
// /panel/activacion · Pruebas de la lógica pura del embudo y del pilar 1
//
// Corren con `node --test --experimental-strip-types` sin red, sin base y sin
// una sola variable de entorno: `leerEmbudoDiario` recibe el cliente por
// parámetro y aquí se le pasa un doble.
//
// Lo que NO se puede probar aquí y queda para la verificación contra Postgres:
// que `admin_rollup_embudo_dia()` cuente lo mismo que estas sumas, que sus
// consultas usen índice (EXPLAIN ANALYZE, CONTRATOS §11) y que
// `admin_embudo_ventana()` esté revocada a anon/authenticated. Un doble de
// cliente nunca puede demostrar un permiso de Postgres.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { type FilaRollup, type MetricasDia } from '../../_lib/dashboard.ts'
import {
  CLAVE_ESCALON,
  DIAS_VENTANA_EMBUDO,
  VENTANAS_COMPARADAS,
  embudoDeVentana,
  escalonesDeVentana,
  filtrarUltimosDias,
  leerEmbudoDiario,
  resumenPilar1,
  type FilaEmbudo,
  type MetricasEmbudoDia,
} from './logica.ts'

// ── Utilidades ──────────────────────────────────────────────────────────────

function filaRollup(dia: string, metricas: MetricasDia): FilaRollup {
  return { dia, metricas, calculadoEn: `${dia}T23:59:00.000Z` }
}

function filaEmbudo(dia: string, metricas: MetricasEmbudoDia): FilaEmbudo {
  return { dia, metricas, calculadoEn: `${dia}T23:59:00.000Z` }
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · filtrarUltimosDias — la ventana es inclusiva y corta por UTC
// ════════════════════════════════════════════════════════════════════════════

test('filtrarUltimosDias devuelve exactamente los N últimos días, inclusive', () => {
  const filas = [
    filaEmbudo('2026-07-29', {}),
    filaEmbudo('2026-07-30', {}),
    filaEmbudo('2026-08-04', {}),
    filaEmbudo('2026-08-05', {}),
  ]
  const ultimos7 = filtrarUltimosDias(filas, 7, '2026-08-05')
  // La ventana de 7 días que termina el 05 empieza el 30: el 29 queda fuera.
  assert.deepEqual(
    ultimos7.map((f) => f.dia),
    ['2026-07-30', '2026-08-04', '2026-08-05'],
  )
})

test('filtrarUltimosDias cruza el cambio de mes sin aritmética de cadenas', () => {
  const filas = [filaEmbudo('2026-07-31', {}), filaEmbudo('2026-08-01', {})]
  const ultimos2 = filtrarUltimosDias(filas, 2, '2026-08-01')
  assert.deepEqual(
    ultimos2.map((f) => f.dia),
    ['2026-07-31', '2026-08-01'],
  )
})

test('filtrarUltimosDias descarta días FUTUROS: una fila mal escrita no entra', () => {
  const filas = [filaEmbudo('2026-08-05', {}), filaEmbudo('2026-09-01', {})]
  assert.deepEqual(
    filtrarUltimosDias(filas, 7, '2026-08-05').map((f) => f.dia),
    ['2026-08-05'],
  )
})

test('filtrarUltimosDias con entradas inválidas devuelve vacío, no revienta', () => {
  const filas = [filaEmbudo('2026-08-05', {})]
  assert.deepEqual(filtrarUltimosDias(filas, 0, '2026-08-05'), [])
  assert.deepEqual(filtrarUltimosDias(filas, -3, '2026-08-05'), [])
  assert.deepEqual(filtrarUltimosDias(filas, 2.5, '2026-08-05'), [])
  assert.deepEqual(filtrarUltimosDias(filas, 7, 'no es una fecha'), [])
})

// ════════════════════════════════════════════════════════════════════════════
// 2 · embudoDeVentana — suma las DOS fuentes sin mezclarlas
// ════════════════════════════════════════════════════════════════════════════

test('embudoDeVentana suma cada escalón de su fuente', () => {
  const rollup = [
    filaRollup('2026-08-04', {
      act_registrados: 30,
      act_onboarding: 25,
      act_primera_lectura: 20,
      act_primer_comentario_validado: 10,
      act_primera_publicacion: 5,
    }),
    filaRollup('2026-08-05', {
      act_registrados: 10,
      act_onboarding: 8,
      act_primera_lectura: 6,
      act_primer_comentario_validado: 3,
      act_primera_publicacion: 1,
    }),
  ]
  const embudo = [
    filaEmbudo('2026-08-04', { act_vuelta_d1_actividad: 7, act_vuelta_d1_cota: 12 }),
    filaEmbudo('2026-08-05', { act_vuelta_d1_actividad: 2, act_vuelta_d1_cota: 4 }),
  ]

  const v = embudoDeVentana(7, rollup, embudo)
  assert.equal(v.dias, 7)
  assert.equal(v.registrados, 40)
  assert.equal(v.onboardingCompleto, 33)
  assert.equal(v.primeraLectura, 26)
  assert.equal(v.primeraEscuchaValidada, 13)
  assert.equal(v.primeraPublicacion, 6)
  assert.equal(v.vueltaD1Actividad, 9)
  assert.equal(v.vueltaD1Cota, 16)
})

test('embudoDeVentana: el denominador sale del rollup de 0191, no del de 0218', () => {
  // Si solo ha corrido el rollup del embudo (0218) pero no el de 0191, los
  // registrados son 0: la tabla no debe inventarse un denominador mezclando
  // fuentes que se calcularon en momentos distintos.
  const v = embudoDeVentana(7, [], [filaEmbudo('2026-08-05', { act_registrados: 50, act_vuelta_d1_cota: 9 })])
  assert.equal(v.registrados, 0)
  assert.equal(v.vueltaD1Cota, 9)
})

test('embudoDeVentana con todo vacío da ceros y CERO NaN', () => {
  const v = embudoDeVentana(30, [], [])
  for (const n of Object.values(v)) {
    assert.ok(Number.isFinite(n), `valor no finito: ${n}`)
  }
  assert.equal(v.registrados, 0)
  assert.equal(v.vueltaD1Actividad, 0)
})

test('una fila con claves basura no revienta el embudo', () => {
  const v = embudoDeVentana(
    7,
    [filaRollup('2026-08-05', { act_registrados: 'hola' } as unknown as MetricasDia)],
    [filaEmbudo('2026-08-05', { act_vuelta_d1_actividad: 'x' } as unknown as MetricasEmbudoDia)],
  )
  assert.equal(v.registrados, 0)
  assert.equal(v.vueltaD1Actividad, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 3 · escalonesDeVentana — las tasas, sobre números REALES
// ════════════════════════════════════════════════════════════════════════════

test('las tasas se calculan sobre el registro y salen 0..1', () => {
  const escalones = escalonesDeVentana({
    dias: 7,
    registrados: 40,
    onboardingCompleto: 30,
    primeraLectura: 20,
    primeraEscuchaValidada: 10,
    primeraPublicacion: 4,
    vueltaD1Actividad: 8,
    vueltaD1Cota: 14,
  })

  assert.equal(escalones.length, 6)
  assert.equal(escalones[0].personas, 40)
  assert.equal(escalones[0].sobreRegistro, 1)
  assert.equal(escalones[1].sobreRegistro, 0.75)
  assert.equal(escalones[2].sobreRegistro, 0.5)
  assert.equal(escalones[3].sobreRegistro, 0.25)
  assert.equal(escalones[4].sobreRegistro, 0.1)
  // La fila de vuelta D1 pinta la cifra CONSERVADORA (actividad), no la cota.
  assert.equal(escalones[5].personas, 8)
  assert.equal(escalones[5].sobreRegistro, 0.2)
  for (const e of escalones) {
    assert.ok(e.sobreRegistro >= 0 && e.sobreRegistro <= 1)
  }
})

test('sin registrados, todas las tasas son 0 — nunca NaN ni Infinity', () => {
  const escalones = escalonesDeVentana({
    dias: 7,
    registrados: 0,
    onboardingCompleto: 0,
    primeraLectura: 0,
    primeraEscuchaValidada: 0,
    primeraPublicacion: 0,
    vueltaD1Actividad: 0,
    vueltaD1Cota: 0,
  })
  for (const e of escalones) {
    assert.equal(e.sobreRegistro, 0)
    assert.ok(Number.isFinite(e.sobreRegistro))
  }
})

test('el orden de los escalones es el del embudo del encargo', () => {
  const etiquetas = escalonesDeVentana({
    dias: 7,
    registrados: 1,
    onboardingCompleto: 1,
    primeraLectura: 1,
    primeraEscuchaValidada: 1,
    primeraPublicacion: 1,
    vueltaD1Actividad: 1,
    vueltaD1Cota: 1,
  }).map((e) => e.etiquetaKey)

  // Se comprueban las CLAVES, no el texto: lo que este módulo decide es el
  // orden del embudo, y el orden no cambia porque cambie el idioma.
  assert.deepEqual(etiquetas, [
    CLAVE_ESCALON.registro,
    CLAVE_ESCALON.onboarding,
    CLAVE_ESCALON.lectura,
    CLAVE_ESCALON.escucha,
    CLAVE_ESCALON.publicacion,
    CLAVE_ESCALON.vueltaD1,
  ])
})

// ════════════════════════════════════════════════════════════════════════════
// 4 · Pilar 1 — vídeos completados y la cota superior de personas
// ════════════════════════════════════════════════════════════════════════════

test('resumenPilar1 suma vídeos y personas por día y conserva la serie', () => {
  const r = resumenPilar1(7, [
    filaEmbudo('2026-08-04', { videos_completados: 120, personas_completaron: 45 }),
    filaEmbudo('2026-08-05', { videos_completados: 80, personas_completaron: 30 }),
  ])
  assert.equal(r.dias, 7)
  assert.equal(r.videosCompletados, 200)
  // 45 + 30 = 75 aunque fueran las MISMAS 45 personas los dos días: es una
  // cota superior consciente y el nombre del campo lo dice.
  assert.equal(r.personasCompletaronCota, 75)
  assert.deepEqual(r.serie, [
    { dia: '2026-08-04', videos: 120, personas: 45 },
    { dia: '2026-08-05', videos: 80, personas: 30 },
  ])
})

test('resumenPilar1 con ventana vacía da ceros y serie vacía, sin NaN', () => {
  const r = resumenPilar1(30, [])
  assert.equal(r.videosCompletados, 0)
  assert.equal(r.personasCompletaronCota, 0)
  assert.deepEqual(r.serie, [])
})

test('resumenPilar1 trata las claves basura como 0', () => {
  const r = resumenPilar1(7, [
    filaEmbudo('2026-08-05', { videos_completados: 'muchos' } as unknown as MetricasEmbudoDia),
  ])
  assert.equal(r.videosCompletados, 0)
  assert.equal(r.serie[0].videos, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 5 · leerEmbudoDiario — el mapeo y el error opaco, con un doble de cliente
// ════════════════════════════════════════════════════════════════════════════

interface RespuestaRpc {
  data: unknown
  error: { code?: string } | null
}

function dobleCliente(respuesta: RespuestaRpc, capturas?: Array<{ fn: string; args: unknown }>) {
  return {
    rpc: (fn: string, args: unknown): Promise<RespuestaRpc> => {
      capturas?.push({ fn, args })
      return Promise.resolve(respuesta)
    },
  } as unknown as SupabaseClient
}

test('leerEmbudoDiario llama a admin_embudo_ventana con los días en UTC', async () => {
  const capturas: Array<{ fn: string; args: unknown }> = []
  const admin = dobleCliente({ data: [], error: null }, capturas)

  await leerEmbudoDiario(admin, {
    desde: '2026-07-07T23:30:00.000Z',
    hasta: '2026-08-05T00:30:00.000Z',
  })

  assert.equal(capturas.length, 1)
  assert.equal(capturas[0].fn, 'admin_embudo_ventana')
  assert.deepEqual(capturas[0].args, { p_desde: '2026-07-07', p_hasta: '2026-08-05' })
})

test('leerEmbudoDiario mapea las filas y tolera metricas nulas', async () => {
  const admin = dobleCliente({
    data: [
      {
        dia: '2026-08-05',
        metricas: { videos_completados: 3, act_vuelta_d1_cota: 1 },
        calculado_en: '2026-08-05T22:00:00.000Z',
      },
      { dia: '2026-08-04', metricas: null, calculado_en: '2026-08-04T22:00:00.000Z' },
    ],
    error: null,
  })

  const filas = await leerEmbudoDiario(admin, {
    desde: '2026-08-04T00:00:00.000Z',
    hasta: '2026-08-05T00:00:00.000Z',
  })

  assert.equal(filas.length, 2)
  assert.equal(filas[0].dia, '2026-08-05')
  assert.equal(filas[0].metricas.videos_completados, 3)
  // La fila con metricas nulas se convierte en {} y no revienta nada aguas
  // abajo: resumenPilar1 la trata como ceros.
  assert.deepEqual(filas[1].metricas, {})
  assert.equal(resumenPilar1(7, filas).videosCompletados, 3)
})

test('leerEmbudoDiario lanza un error OPACO: el código, jamás el mensaje de Postgres', async () => {
  const admin = dobleCliente({ data: null, error: { code: '42501' } })
  await assert.rejects(
    () =>
      leerEmbudoDiario(admin, {
        desde: '2026-08-04T00:00:00.000Z',
        hasta: '2026-08-05T00:00:00.000Z',
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error)
      assert.equal(e.message, 'embudo: 42501')
      return true
    },
  )
})

test('leerEmbudoDiario devuelve [] si la RPC no devuelve un array', async () => {
  const admin = dobleCliente({ data: { raro: true }, error: null })
  const filas = await leerEmbudoDiario(admin, {
    desde: '2026-08-04T00:00:00.000Z',
    hasta: '2026-08-05T00:00:00.000Z',
  })
  assert.deepEqual(filas, [])
})

// ════════════════════════════════════════════════════════════════════════════
// 6 · Constantes — la ventana leída cubre la mayor ventana comparada
// ════════════════════════════════════════════════════════════════════════════

test('DIAS_VENTANA_EMBUDO cubre todas las ventanas comparadas', () => {
  for (const dias of VENTANAS_COMPARADAS) {
    assert.ok(
      dias <= DIAS_VENTANA_EMBUDO,
      `la ventana comparada de ${dias} días no cabe en la consulta de ${DIAS_VENTANA_EMBUDO}`,
    )
  }
  assert.deepEqual([...VENTANAS_COMPARADAS], [7, 30])
})
