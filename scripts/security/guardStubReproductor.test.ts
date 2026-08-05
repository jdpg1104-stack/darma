// ============================================================================
// Pruebas del guard del stub e2e del reproductor.
//
// Dos mitades, como en los demás guards: reglas sobre contenidos sintéticos
// (que cada regla dispare y deje de disparar exactamente cuando debe) y el
// árbol REAL del repositorio (que hoy esté limpio — si esta prueba se pone
// roja, alguien movió el fusible o amplió la superficie del stub).
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IMPORTADOR_PERMITIDO,
  MODULO_FUSIBLE,
  escanearArbol,
  escanearContenido,
  formatearInforme,
} from './guardStubReproductor.ts'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── Regla 1 · la bandera solo vive en el fusible ────────────────────────────
test('la bandera fuera del fusible es infracción', () => {
  const hallazgos = escanearContenido(
    'lib/otra/cosa.ts',
    "const enE2E = process.env.NEXT_PUBLIC_E2E_STUB_PLAYER === '1'",
  )
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0].motivo, 'bandera-fuera-del-fusible')
})

test('un archivo cualquiera sin bandera ni import queda limpio', () => {
  assert.deepEqual(escanearContenido('lib/otra/cosa.ts', 'export const x = 1'), [])
})

// ── Regla 2 · el stub solo lo importa TarjetaVideo ──────────────────────────
test('importar el stub desde otro archivo es infracción', () => {
  const contenido = "import { stubReproductorActivo } from '@/lib/video/stubE2E'"
  const hallazgos = escanearContenido('components/feed/Otra.tsx', contenido)
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0].motivo, 'import-fuera-de-tarjeta')

  // Desde la tarjeta, el mismo import es legítimo.
  assert.deepEqual(escanearContenido(IMPORTADOR_PERMITIDO, contenido), [])
})

test('el import relativo tampoco se escapa', () => {
  // La forma que de verdad se escribiría en el barril vecino: sin `video/`.
  const hallazgos = escanearContenido(
    'lib/video/index.ts',
    "export { stubReproductorActivo } from './stubE2E.ts'",
  )
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0].motivo, 'import-fuera-de-tarjeta')
})

// ── Regla 3 · los cerrojos del fusible no se pueden borrar ──────────────────
test('el fusible sin sus dos cerrojos es infracción doble', () => {
  const hallazgos = escanearContenido(MODULO_FUSIBLE, 'export const nada = true')
  assert.deepEqual(
    hallazgos.map((h) => h.motivo).sort(),
    ['cerrojo-de-bandera-ausente', 'cerrojo-de-hostname-ausente'],
  )
})

test('el fusible REAL del repo conserva los dos cerrojos', () => {
  const contenido = readFileSync(join(RAIZ, MODULO_FUSIBLE), 'utf8')
  assert.deepEqual(escanearContenido(MODULO_FUSIBLE, contenido), [])
})

// ── El árbol real, hoy ──────────────────────────────────────────────────────
test('el árbol real está limpio', () => {
  const hallazgos = escanearArbol(RAIZ)
  assert.deepEqual(hallazgos, [], formatearInforme(hallazgos))
})

test('el informe limpio y el informe con hallazgos se distinguen', () => {
  assert.match(formatearInforme([]), /OK/)
  assert.match(
    formatearInforme([
      {
        archivo: 'x.ts',
        motivo: 'bandera-fuera-del-fusible',
        detalle: 'detalle',
      },
    ]),
    /infracción/,
  )
})
