// ============================================================================
// Pruebas de la reposición y de la autenticación del cron.
//
// Los tres casos de 401 (sin Bearer, con Bearer erróneo, con CRON_SECRET sin
// definir) son el camino de fallo que de verdad importa: el tercero es el que
// convierte un despliegue con una variable olvidada en un endpoint abierto, y
// es el único que no se detecta probando a mano en local.
//
// La reposición real —0 activas → activa 3, dos veces seguidas no duplica,
// banco agotado → 0 sin error— se verificó CONTRA POSTGRES en `darma-dev`,
// porque la garantía de no duplicar es `uq_polls_bank_key` y un mock no puede
// probar un índice. Está registrado en HANDOFF/ESTADO.md.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esCronAutorizado } from '../ingest/cronAuth.ts'
import { IDIOMAS_BANCO, MAX_DIAS_ACTIVA, MINIMO_ACTIVAS, normalizar } from './reponer.ts'

// ── 10 · Los tres 401 ───────────────────────────────────────────────────────

test('sin cabecera Authorization → no autorizado', () => {
  assert.equal(esCronAutorizado(null, 'secreto-de-verdad'), false)
  assert.equal(esCronAutorizado(undefined, 'secreto-de-verdad'), false)
  assert.equal(esCronAutorizado('', 'secreto-de-verdad'), false)
})

test('con Bearer erróneo → no autorizado (y con uno de otra longitud tampoco)', () => {
  assert.equal(esCronAutorizado('Bearer otra-cosa', 'secreto-de-verdad'), false)
  assert.equal(esCronAutorizado('Bearer secreto-de-verdad-y-mas', 'secreto-de-verdad'), false)
  assert.equal(esCronAutorizado('Bearer secreto-de-verda', 'secreto-de-verdad'), false)
  assert.equal(esCronAutorizado('secreto-de-verdad', 'secreto-de-verdad'), false, 'sin el prefijo Bearer tampoco')
})

test('FAIL-CLOSED: sin CRON_SECRET definido, NADA pasa', () => {
  assert.equal(esCronAutorizado('Bearer lo-que-sea', undefined), false)
  assert.equal(esCronAutorizado('Bearer lo-que-sea', null), false)
  assert.equal(esCronAutorizado('Bearer ', ''), false)
  // El caso perverso: cabecera vacía y secreto vacío son "iguales", y una
  // comparación ingenua los daría por buenos.
  assert.equal(esCronAutorizado('Bearer', ''), false)
})

test('con el Bearer correcto sí pasa', () => {
  assert.equal(esCronAutorizado('Bearer secreto-de-verdad', 'secreto-de-verdad'), true)
})

// ── normalizar ──────────────────────────────────────────────────────────────

test('banco agotado → { activadas: 0 } sin error', () => {
  assert.deepEqual(normalizar({ activadas: 0, cerradas: 0 }), { activadas: 0, cerradas: 0 })
})

test('un jsonb inesperado da ceros, nunca NaN en un contador de operación', () => {
  assert.deepEqual(normalizar(null), { activadas: 0, cerradas: 0 })
  assert.deepEqual(normalizar('vaya'), { activadas: 0, cerradas: 0 })
  assert.deepEqual(normalizar({ activadas: 'tres' }), { activadas: 0, cerradas: 0 })
  assert.deepEqual(normalizar({ activadas: 3.7, cerradas: 1 }), { activadas: 3, cerradas: 1 })
})

// ── Constantes ──────────────────────────────────────────────────────────────

test('las constantes de reposición son las de la ficha', () => {
  assert.equal(MINIMO_ACTIVAS, 3, 'al menos 3 activas por idioma')
  assert.equal(MAX_DIAS_ACTIVA, 14, 'ninguna con más de 14 días')
  assert.deepEqual([...IDIOMAS_BANCO], ['es', 'en'])
})
