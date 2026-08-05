// ============================================================================
// El índice de límites no puede envejecer en silencio
//
// `lib/rateLimit.ts` tenía una tabla central que no llamaba NADIE, con números
// distintos de los reales. Sobrevivió meses porque dos apuntes de PEDIDOS.md la
// trataban como una de dos políticas en conflicto, cuando era una política y un
// señuelo: nada la ejecutaba, así que ninguna prueba podía contradecirla.
//
// En su lugar quedó un índice en comentario de dónde vive la tabla de cada
// bloque. Un índice a mano se queda obsoleto en cuanto alguien añade una ruta, y
// entonces es exactamente el mismo señuelo otra vez. Esta prueba es lo único que
// hace que la sustitución sea una mejora y no un cambio de sitio del problema.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../', import.meta.url))

/** Carpetas que se recorren buscando tablas de límites. */
const RECORRIDAS = ['app', 'lib']

/** Ni dependencias ni los árboles de trabajo de los agentes en paralelo. */
const IGNORADAS = new Set(['node_modules', '.next', '.git', 'worktrees'])

function archivosTs(directorio: string): string[] {
  const encontrados: string[] = []
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    if (IGNORADAS.has(entrada.name)) continue
    const ruta = join(directorio, entrada.name)
    if (entrada.isDirectory()) encontrados.push(...archivosTs(ruta))
    else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.test.ts')) encontrados.push(ruta)
  }
  return encontrados
}

test('🔴 toda tabla de límites está en el índice de lib/rateLimit.ts', () => {
  const indice = readFileSync(new URL('./rateLimit.ts', import.meta.url), 'utf8')

  const tablas: Array<{ nombre: string; ruta: string }> = []
  for (const carpeta of RECORRIDAS) {
    for (const archivo of archivosTs(join(RAIZ, carpeta))) {
      const fuente = readFileSync(archivo, 'utf8')
      for (const coincidencia of fuente.matchAll(/^export const (LIMITES_[A-Z0-9_]+)/gm)) {
        // Barras normales siempre: el índice se escribe una vez y esta prueba
        // también corre en Windows, donde `relative()` devuelve `\`.
        tablas.push({ nombre: coincidencia[1], ruta: relative(RAIZ, archivo).split(sep).join('/') })
      }
    }
  }

  // Si esto fallara, el bug no sería «faltan tablas»: sería que el recorrido ha
  // dejado de encontrarlas y la prueba estaría pasando en vacío.
  assert.ok(tablas.length >= 5, `solo se han encontrado ${tablas.length} tablas; el recorrido no funciona`)

  const ausentes = tablas.filter(({ nombre, ruta }) => {
    // Nombre y ruta EN LA MISMA LÍNEA: dos bloques distintos exportan
    // `LIMITES_PETICION` (billing y polls), así que buscarlos por separado daría
    // por indexada una tabla que no está.
    const linea = new RegExp(`^//.*\\b${nombre}\\b.*\\b${ruta.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$`, 'm')
    return !linea.test(indice)
  })

  assert.deepEqual(
    ausentes.map((t) => `${t.nombre} (${t.ruta})`),
    [],
    'hay tablas de límites que no aparecen en el índice de lib/rateLimit.ts. ' +
      'Añádelas ahí: el índice existe para poder leer todos los límites juntos, ' +
      'y uno incompleto engaña más que no tenerlo.',
  )
})

test('🔴 no vuelve a haber una tabla central de límites sin usar', () => {
  const fuente = readFileSync(new URL('./rateLimit.ts', import.meta.url), 'utf8')
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // Lo que se prohíbe no es una tabla central: es una que nadie ejecute. Si
  // algún día se centralizan de verdad los límites, este guard se quita a la vez
  // que se cablean las rutas, en el mismo cambio y a propósito.
  assert.doesNotMatch(codigo, /export const RATE_LIMITS/, 'ha vuelto la tabla central que no llamaba nadie')
  assert.doesNotMatch(codigo, /export async function limitAction/, 'ha vuelto el atajo que no usaba ninguna ruta')
})
