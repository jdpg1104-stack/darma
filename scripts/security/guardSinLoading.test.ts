// ============================================================================
// Tests del guard de hidratación (loading.tsx / <Suspense>).
//
// El test que de verdad importa es el primero: el árbol REAL está limpio. Es la
// regresión que faltó dos veces — ocho `loading.tsx` la primera, dos
// `<Suspense>` manuales la segunda — y que ningún otro check ve porque el fallo
// solo existe al hidratar en un navegador (app/SIN-LOADING.md).
//
// El segundo que importa es el de los comentarios: las advertencias «⛔ no
// pongas un <Suspense> aquí» viven en los archivos vigilados, y un guard que
// gritara por la advertencia acabaría desactivado — justo el día antes de que
// hiciera falta.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buscarSuspense,
  detectarSinLoading,
  esNombreLoading,
  formatearInforme,
  quitarComentarios,
} from './guardSinLoading.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const FIXTURE_ROTO = join(AQUI, 'fixtures', 'sin-loading')
const FIXTURE_LIMPIO = join(AQUI, 'fixtures', 'sin-loading-limpio')

// ── El árbol real ───────────────────────────────────────────────────────────

test('el árbol real no tiene ni loading.tsx ni <Suspense>', () => {
  const hallazgos = detectarSinLoading(RAIZ)
  assert.deepEqual(hallazgos, [], formatearInforme(hallazgos))
})

// ── Camino de fallo, sobre fixtures ─────────────────────────────────────────

test('detecta el archivo loading.tsx por nombre y el <Suspense> por contenido', () => {
  const hallazgos = detectarSinLoading(FIXTURE_ROTO)

  // Dos infracciones y ni una más: components/Tarjeta.tsx solo menciona
  // <Suspense> en comentarios, y app/pagina.spec.ts lo lleva en un regex de
  // test colocado — ninguno de los dos debe aparecer.
  assert.equal(hallazgos.length, 2, formatearInforme(hallazgos))

  const porArchivo = hallazgos.find((h) => h.tipo === 'archivo-loading')
  assert.ok(porArchivo, 'falta el hallazgo del loading.tsx')
  assert.equal(porArchivo.archivo, 'app/loading.tsx')
  assert.equal(porArchivo.linea, 0)

  const porSuspense = hallazgos.find((h) => h.tipo === 'suspense')
  assert.ok(porSuspense, 'falta el hallazgo del <Suspense>')
  assert.equal(porSuspense.archivo, 'app/feed/page.tsx')
  // La línea exacta del `<Suspense fallback=` del fixture: sin ella el informe
  // no es accionable.
  assert.equal(porSuspense.linea, 8)
})

test('un árbol limpio con advertencias en comentarios no da falsos positivos', () => {
  assert.deepEqual(detectarSinLoading(FIXTURE_LIMPIO), [])
})

// ── Piezas sueltas ──────────────────────────────────────────────────────────

test('esNombreLoading reconoce las variantes de Next y nada más', () => {
  assert.equal(esNombreLoading('loading.tsx'), true)
  assert.equal(esNombreLoading('loading.js'), true)
  // En Windows el sistema de archivos no distingue mayúsculas: `Loading.tsx`
  // ES `loading.tsx` para Next desplegado desde este repo.
  assert.equal(esNombreLoading('Loading.TSX'), true)
  assert.equal(esNombreLoading('cargando.tsx'), false)
  assert.equal(esNombreLoading('loading.css'), false)
})

test('quitarComentarios borra el texto comentado y conserva las líneas', () => {
  const fuente = '// <Suspense>\nconst x = 1 /* <Suspense> */\n/* dos\nlíneas */ fin\n'
  const limpio = quitarComentarios(fuente)
  assert.equal(limpio.split('\n').length, fuente.split('\n').length, 'cambió el número de líneas')
  assert.ok(!limpio.includes('Suspense'), `quedó texto de comentario: ${limpio}`)
  assert.ok(limpio.includes('const x = 1'), 'se llevó código por delante')
  assert.ok(limpio.includes('fin'), 'no cerró el comentario de bloque donde tocaba')
})

test('buscarSuspense ignora comentarios de línea, de bloque y de JSX', () => {
  const soloComentarios = [
    '// aquí hubo un <Suspense> y se quitó',
    '/* ⛔ no envuelvas esto en <Suspense> */',
    '{/* tampoco un <Suspense> aquí */}',
  ].join('\n')
  assert.deepEqual(buscarSuspense(soloComentarios), [])
})

test('buscarSuspense encuentra el <Suspense> real con su línea', () => {
  const fuente = "import { Suspense } from 'react'\nconst a = 1\nexporta(<Suspense fallback={null} />)\n"
  assert.deepEqual(buscarSuspense(fuente), [3])
})

test('buscarSuspense también caza la forma cualificada <React.Suspense>', () => {
  assert.deepEqual(buscarSuspense('renderiza(<React.Suspense fallback={null} />)'), [1])
})

test('buscarSuspense NO confunde un componente cuyo nombre empieza igual', () => {
  assert.deepEqual(buscarSuspense('renderiza(<SuspenseLista />)'), [])
})

test('un // dentro de una cadena no abre comentario ni esconde un <Suspense>', () => {
  // Si el escáner tratara el `//` de la URL como comentario, el <Suspense>
  // posterior desaparecería del informe: un falso NEGATIVO, el peor caso.
  const fuente = "const u = 'https://ejemplo.invalid'; usa(<Suspense fallback={null} />)"
  assert.deepEqual(buscarSuspense(fuente), [1])
})

test('la etiqueta de cierre no duplica el hallazgo de la de apertura', () => {
  const fuente = '<Suspense fallback={null}>\n  <p>x</p>\n</Suspense>\n'
  assert.deepEqual(buscarSuspense(fuente), [1])
})

// ── Informe ─────────────────────────────────────────────────────────────────

test('el informe de éxito es explícito', () => {
  assert.match(formatearInforme([]), /OK/)
})

test('el informe de fallo apunta a SIN-LOADING.md y explica el síntoma', () => {
  const informe = formatearInforme([
    { archivo: 'app/feed/loading.tsx', tipo: 'archivo-loading', linea: 0 },
    { archivo: 'app/feed/page.tsx', tipo: 'suspense', linea: 42 },
  ])
  assert.match(informe, /SIN-LOADING\.md/)
  assert.match(informe, /app\/feed\/loading\.tsx/)
  assert.match(informe, /app\/feed\/page\.tsx:42/)
  assert.match(informe, /hidrata/i)
})
