// ============================================================================
// Tests del guard de cliente admin.
//
// El caso que de verdad importa es el 6 de la ficha: la cadena de TRES saltos.
// Un guard que solo mire imports directos pasaría ese fixture sin decir nada, y
// eso es exactamente la fuga que ocurre en la vida real.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  detectarFugasAdmin,
  detectarNextPublicServiceRole,
  esComponenteCliente,
  extraerImports,
  resolverImport,
  formatearInforme,
} from './guardClienteAdmin.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const FIXTURE_FUGA = join(AQUI, 'fixtures', 'fuga-admin')
const FIXTURE_LIMPIO = join(AQUI, 'fixtures', 'arbol-limpio')

// ── Camino feliz (punto 2 de la ficha) ──────────────────────────────────────

test('2 · detectarFugasAdmin sobre el árbol real no encuentra fugas', () => {
  const fugas = detectarFugasAdmin(RAIZ)
  assert.deepEqual(fugas, [], formatearInforme(fugas))
})

test('2 bis · tampoco hay SUPABASE_SERVICE_ROLE_KEY bajo NEXT_PUBLIC_', () => {
  assert.deepEqual(detectarNextPublicServiceRole(RAIZ), [])
})

test('un árbol con componente cliente inocuo no da falso positivo', () => {
  assert.deepEqual(detectarFugasAdmin(FIXTURE_LIMPIO), [])
})

// ── Camino de fallo (punto 6 de la ficha) ───────────────────────────────────

test('6 · detecta la cadena de TRES saltos, no solo el import directo', () => {
  const fugas = detectarFugasAdmin(FIXTURE_FUGA)

  assert.equal(fugas.length, 1, `se esperaba exactamente una fuga:\n${formatearInforme(fugas)}`)
  const fuga = fugas[0]!

  assert.equal(fuga.archivoCliente, 'components/Tarjeta.ts')

  // Componente → utils → helper → admin: cuatro archivos, tres saltos. Si el
  // guard solo mirara imports directos, esto pasaría inadvertido.
  assert.deepEqual(fuga.cadena, [
    'components/Tarjeta.ts',
    'utils/formato.ts',
    'helpers/perfil.ts',
    'lib/supabase/admin.ts',
  ])
})

test('6 bis · el informe imprime la cadena completa y sale con hallazgos', () => {
  const informe = formatearInforme(detectarFugasAdmin(FIXTURE_FUGA))
  assert.match(informe, /components\/Tarjeta\.ts/)
  assert.match(informe, /helpers\/perfil\.ts/)
  assert.match(informe, /lib\/supabase\/admin\.ts/)
  // El informe tiene que decir qué hacer, y en qué orden.
  assert.match(informe, /ROTA LA CLAVE PRIMERO/)
})

// ── Piezas sueltas ──────────────────────────────────────────────────────────

test('esComponenteCliente reconoce la directiva y no se deja engañar', () => {
  assert.equal(esComponenteCliente("'use client'\nexport const x = 1"), true)
  assert.equal(esComponenteCliente('// comentario\n\n"use client"\n'), true)
  assert.equal(esComponenteCliente('export const x = 1\n'), false)
  // Una mención dentro del código NO es la directiva: debe ir antes de
  // cualquier sentencia real.
  assert.equal(esComponenteCliente("export const a = 1\n'use client'\n"), false)
})

test('extraerImports coge estáticos, dinámicos y require', () => {
  const fuente = [
    "import a from './a.ts'",
    "import { b } from '@/lib/b'",
    "export { c } from './c.ts'",
    "const d = await import('./d.ts')",
    "const e = require('./e.js')",
  ].join('\n')

  const imports = extraerImports(fuente)
  for (const esperado of ['./a.ts', '@/lib/b', './c.ts', './d.ts', './e.js']) {
    assert.ok(imports.includes(esperado), `falta ${esperado} en ${JSON.stringify(imports)}`)
  }
})

test('resolverImport ignora los paquetes de node_modules', () => {
  assert.equal(resolverImport('@supabase/supabase-js', join(RAIZ, 'lib', 'x.ts'), RAIZ), null)
})

test('resolverImport entiende el alias @/', () => {
  const destino = resolverImport('@/lib/karma', join(RAIZ, 'app', 'page.tsx'), RAIZ)
  assert.ok(destino?.endsWith('karma.ts'), `no resolvió @/lib/karma: ${destino}`)
})

test('el informe de éxito es explícito', () => {
  assert.match(formatearInforme([], []), /OK/)
})
