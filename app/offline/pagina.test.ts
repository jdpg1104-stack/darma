// ============================================================================
// /offline — pruebas del contrato con el service worker.
//
// La página nació de un agujero silencioso: `public/sw.js` la precacheaba y la
// usaba como caída de la navegación sin red, pero la ruta no existía y el SW
// respondía un 503 de texto plano. Nada se ponía rojo. Estas pruebas fijan el
// contrato por los dos lados —el SW la precachea, la página existe y cumple sus
// restricciones— leyendo las FUENTES, igual que hace el guard de literales de
// `i18n/validacion.ts`: son invariantes de archivo, no de runtime, y así se
// comprueban sin arrancar Next.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { MENSAJES } from '../../i18n/traductor.ts'
import { aplanar } from '../../i18n/catalogo.ts'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const fuenteSw = readFileSync(join(RAIZ, 'public', 'sw.js'), 'utf8')
const fuentePagina = readFileSync(join(RAIZ, 'app', 'offline', 'page.tsx'), 'utf8')

/** Las rutas del array `PRECACHE` de `public/sw.js`, tal cual están escritas. */
function rutasDelPrecache(): readonly string[] {
  const bloque = /const PRECACHE = \[([\s\S]*?)\]/.exec(fuenteSw)
  assert.ok(bloque, 'public/sw.js ya no declara `const PRECACHE = [...]`: si se renombró, actualiza esta prueba y revisa /offline')
  const rutas: string[] = []
  const reRuta = /'([^']+)'/g
  for (let m = reRuta.exec(bloque[1]); m !== null; m = reRuta.exec(bloque[1])) {
    rutas.push(m[1])
  }
  return rutas
}

// ── El lado del service worker ──────────────────────────────────────────────

test('public/sw.js precachea exactamente "/offline" (ni variante ni barra final)', () => {
  const rutas = rutasDelPrecache()
  assert.ok(
    rutas.includes('/offline'),
    `el precache es [${rutas.join(', ')}] y no contiene "/offline": la navegación sin red caería al 503 de texto plano`,
  )
  // Y no hay una variante parecida que la página no cubra ('/offline/', '/sin-conexion'…).
  const variantes = rutas.filter((r) => r.startsWith('/offline') && r !== '/offline')
  assert.deepEqual(variantes, [], 'una variante de /offline en el precache no la sirve esta página')
})

test('el fetch handler usa "/offline" como caída de la navegación', () => {
  assert.match(
    fuenteSw,
    /caches\.match\('\/offline'\)/,
    'sin esta rama, precachear /offline no sirve de nada: nadie la respondería',
  )
})

// ── El lado de la página ────────────────────────────────────────────────────

test('la página es estática: force-static y ni una hoja de cliente propia', () => {
  assert.match(
    fuentePagina,
    /export const dynamic = 'force-static'/,
    'sin force-static la página depende de la petición y el SW cachearía una respuesta por persona',
  )
  assert.doesNotMatch(fuentePagina, /'use client'/, 'la caída sin red no puede necesitar hidratación')
  assert.doesNotMatch(fuentePagina, /<Suspense/, 'PROHIBIDO en este repo: ver app/SIN-LOADING.md')
  // `resolverLocale()` bajo force-static devuelve siempre el defecto: usarlo
  // aquí sería un bug silencioso (parecería que traduce y nunca traduciría).
  // Se mira el import y no el texto entero: la cabecera lo menciona al explicarlo.
  assert.doesNotMatch(fuentePagina, /import\s*\{[^}]*\bresolverLocale\b[^}]*\}/)
})

test('la página enlaza a /ayuda, que es su razón de ser', () => {
  assert.match(fuentePagina, /href="\/ayuda"/)
})

test('todas las claves t(...) de la página existen en los dos catálogos', () => {
  const claves: string[] = []
  const reClave = /\bt\('([^']+)'\)/g
  for (let m = reClave.exec(fuentePagina); m !== null; m = reClave.exec(fuentePagina)) {
    claves.push(m[1])
  }
  assert.ok(claves.length >= 2, 'la página debe sacar su copy del catálogo, no de literales')

  for (const [idioma, catalogo] of Object.entries(MENSAJES)) {
    const plano = aplanar(catalogo)
    for (const clave of claves) {
      assert.ok(
        plano.has(clave),
        `la clave "${clave}" que usa /offline falta en ${idioma}.json — el traductor la pintaría tal cual`,
      )
    }
  }
})
