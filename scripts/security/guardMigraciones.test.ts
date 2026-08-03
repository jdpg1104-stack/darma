import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Guard del orden de las migraciones.
//
// El CLI de Supabase toma como VERSIÓN de una migración los caracteres que hay
// antes del primer guion bajo del nombre. Es decir: `0106_1_ranking.sql`,
// `0106_2_max_uuid.sql` y `0106_3_empates.sql` son todas la versión «0106», y
// al aplicarlas revientan con
//
//     duplicate key value violates unique constraint "schema_migrations_pkey"
//
// Nada lo detecta hasta que alguien reconstruye la base desde cero, y para
// entonces el error habla de una clave primaria y no del nombre de un archivo.
// Pasó de verdad: tres migraciones compartían prefijo y tumbaron el trabajo de
// RLS del CI la primera vez que corrió.
//
// La otra mitad del guard es el ORDEN. Una migración que revoca permisos sobre
// una función creada por otra tiene que ordenarse después de ella, y lo único
// que lo garantiza es el número. También pasó de verdad: `0009` intentaba
// revocar algo que creaba `0201`.
// ============================================================================

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = join(RAIZ, 'supabase', 'migrations')

function migraciones(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Lo que el CLI de Supabase usa como versión: hasta el primer `_`. */
function version(archivo: string): string {
  return archivo.split('_', 1)[0] ?? archivo
}

test('ninguna migración comparte versión con otra', () => {
  const porVersion = new Map<string, string[]>()
  for (const f of migraciones()) {
    const v = version(f)
    porVersion.set(v, [...(porVersion.get(v) ?? []), f])
  }

  const chocan = [...porVersion.entries()].filter(([, fs]) => fs.length > 1)

  assert.deepEqual(
    chocan,
    [],
    'Dos migraciones con el mismo prefijo son la MISMA versión para Supabase, y ' +
      '`db reset` muere con «duplicate key value violates unique constraint ' +
      '"schema_migrations_pkey"». Renumera para que cada una tenga la suya:\n' +
      chocan.map(([v, fs]) => `  versión ${v}: ${fs.join(', ')}`).join('\n'),
  )
})

test('la versión de cada migración es numérica y de ancho fijo', () => {
  for (const f of migraciones()) {
    assert.match(
      version(f),
      /^\d{4}$/,
      `${f}: la versión debe ser 4 dígitos. El orden de aplicación es alfabético, ` +
        `así que un ancho variable ordena "10" antes que "9".`,
    )
  }
})

test('hay migraciones y el guard mira donde debe', () => {
  // Si alguien mueve el directorio, este archivo dejaría de comprobar nada y
  // los dos tests de arriba pasarían sobre una lista vacía.
  assert.ok(migraciones().length >= 20, 'no se encontraron las migraciones del proyecto')
})
