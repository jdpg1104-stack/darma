// ============================================================================
// Los caminos de fallo de la curación con fragmento.
//
// El camino feliz de esta ruta ya lo cubría la pantalla. Lo que no estaba
// cubierto —y es lo único que de verdad importa aquí— son las combinaciones que
// NO deben pasar. La peor de todas es la primera: aprobar una charla de 87
// minutos sin elegir el momento, que es cómo se llegó a un feed vertical con
// piezas de 55 minutos de media que además no pagaban karma a nadie.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CLIP_MAX_S, CLIP_MIN_S } from '../../../../lib/video/acreditacion.ts'
import { estadoDePartida, estadoResultante, motivoDeRechazo } from './decision.ts'

/** Una charla real del catálogo: «Cómo convertir tus heridas en propósito». */
const CHARLA_LARGA = 5236

function entrada(parcial: Partial<Parameters<typeof motivoDeRechazo>[0]> = {}) {
  return {
    decision: 'aprobar' as const,
    inicioSegundos: null,
    finSegundos: null,
    duracionSegundos: CHARLA_LARGA,
    ...parcial,
  }
}

// ── EL FALLO QUE MOTIVA TODO ESTO ──────────────────────────────────────────
test('no se puede aprobar una charla de 87 minutos sin elegir el momento', () => {
  assert.equal(
    motivoDeRechazo(entrada()),
    'admin.curacion.fragmentoObligatorio',
  )
})

test('con el momento elegido, la misma charla se aprueba', () => {
  assert.equal(
    motivoDeRechazo(entrada({ inicioSegundos: 3120, finSegundos: 3160 })),
    null,
  )
})

// ── Lo corto no necesita recorte ───────────────────────────────────────────
test('un clip de 45 s se aprueba entero, sin fragmento', () => {
  assert.equal(motivoDeRechazo(entrada({ duracionSegundos: 45 })), null)
})

test('sin duración conocida no se puede exigir el fragmento', () => {
  // Los ítems del feed Atom llegan sin duración: exigirlo sería impedir curar
  // justo lo que peor documentado llega.
  assert.equal(motivoDeRechazo(entrada({ duracionSegundos: null })), null)
})

// ── Fragmentos que no valen ────────────────────────────────────────────────
test('media pareja no es medio fragmento: es el vídeo entero empezando tarde', () => {
  assert.equal(
    motivoDeRechazo(entrada({ inicioSegundos: 3120, finSegundos: null })),
    'admin.curacion.fragmentoInvalido',
  )
  assert.equal(
    motivoDeRechazo(entrada({ inicioSegundos: null, finSegundos: 3160 })),
    'admin.curacion.fragmentoInvalido',
  )
})

test('un fragmento fuera de los topes se rechaza con mensaje propio', () => {
  const casos: Array<[number, number, string]> = [
    [3120, 3120 + CLIP_MIN_S - 1, 'por debajo del mínimo'],
    [0, CLIP_MAX_S + 1, 'por encima del máximo'],
    [3160, 3120, 'fin antes que inicio'],
    [5200, 5300, 'el fin no cabe en el vídeo'],
  ]

  for (const [inicioSegundos, finSegundos, porque] of casos) {
    assert.equal(
      motivoDeRechazo(entrada({ inicioSegundos, finSegundos })),
      'admin.curacion.fragmentoInvalido',
      porque,
    )
  }
})

// ── Descartar ──────────────────────────────────────────────────────────────
test('descartar sin motivo no se acepta', () => {
  assert.equal(
    motivoDeRechazo(entrada({ decision: 'rechazar' })),
    'admin.curacion.motivoObligatorio',
  )
  assert.equal(
    motivoDeRechazo(entrada({ decision: 'rechazar', motivo: '  x ' })),
    'admin.curacion.motivoObligatorio',
    'un motivo de un carácter no es un motivo',
  )
})

test('descartar NO exige fragmento, aunque el vídeo sea larguísimo', () => {
  // La fricción va en aprobar, no en descartar: ponerla en las dos salidas
  // empuja a aprobar por inercia.
  assert.equal(motivoDeRechazo(entrada({ decision: 'rechazar', motivo: 'no es salud mental' })), null)
})

test('recortar lo que se descarta se rechaza en vez de guardarse a medias', () => {
  assert.equal(
    motivoDeRechazo(
      entrada({
        decision: 'rechazar',
        motivo: 'no es salud mental',
        inicioSegundos: 3120,
        finSegundos: 3160,
      }),
    ),
    'admin.curacion.fragmentoAlRechazar',
  )
})

// ── Recortar lo ya aprobado ────────────────────────────────────────────────
test('recortar exige fragmento: es lo único que hace', () => {
  assert.equal(
    motivoDeRechazo(entrada({ decision: 'recortar' })),
    'admin.curacion.fragmentoObligatorio',
  )
  assert.equal(
    motivoDeRechazo(entrada({ decision: 'recortar', inicioSegundos: 3120, finSegundos: 3160 })),
    null,
  )
})

// ── Los estados ────────────────────────────────────────────────────────────
test('cada decisión parte del estado que le corresponde', () => {
  assert.equal(estadoDePartida('aprobar'), 'pending')
  assert.equal(estadoDePartida('rechazar'), 'pending')
  assert.equal(estadoDePartida('recortar'), 'approved', 'recortar actúa sobre lo ya publicado')
})

test('recortar no reabre ni cierra nada: solo encuadra', () => {
  assert.equal(estadoResultante('aprobar'), 'approved')
  assert.equal(estadoResultante('rechazar'), 'rejected')
  assert.equal(estadoResultante('recortar'), null)
})
