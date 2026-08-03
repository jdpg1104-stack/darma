import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { POLITICA_RETENCION, reglaDeTabla, tablasConPurgaAutomatica } from './retencion.ts'

const RAIZ = join(import.meta.dirname, '..', '..')

/**
 * Lista LITERAL de las tablas con datos personales del esquema (0001, 0002,
 * 0101, 0107 y 0201). Está escrita a mano a propósito: si se derivara del
 * propio array de la política, el test no comprobaría nada — se estaría
 * comparando la política consigo misma. Añadir una tabla al esquema y no
 * clasificarla tiene que romper aquí.
 */
const TABLAS_CON_DATOS_PERSONALES: readonly string[] = [
  // 0001_core
  'profiles',
  'identity_vault',
  'karma_events',
  'posts',
  'comments',
  'post_votes',
  // 0002_comunidad
  'refuge_members',
  'refuge_messages',
  'kindred',
  'blocks',
  'content_views',
  'poll_votes',
  'moderation_flags',
  'crisis_events',
  'crystal_ledger',
  'boosts',
  'gifts',
  'rate_limits',
  // 0101_b01_auth
  'auth_totp',
  // 0107_b07_reproduccion
  'content_sessions',
  // 0201_b20_privacidad
  'consents',
  'privacy_requests',
  'retired_aliases',
]

test('la política cubre TODAS las tablas con datos personales del esquema', () => {
  const cubiertas = new Set(POLITICA_RETENCION.map((r) => r.tabla))
  const faltan = TABLAS_CON_DATOS_PERSONALES.filter((t) => !cubiertas.has(t))

  assert.deepEqual(
    faltan,
    [],
    `sin clasificar: ${faltan.join(', ')}. Una tabla con datos personales y sin plazo ` +
      'convierte /legal/retencion en un documento que miente.',
  )
})

test('la política no clasifica tablas que no existen', () => {
  const conocidas = new Set(TABLAS_CON_DATOS_PERSONALES)
  for (const regla of POLITICA_RETENCION) {
    assert.ok(conocidas.has(regla.tabla), `${regla.tabla} no está en el esquema`)
  }
})

test('cada regla tiene plazo, base legal y una justificación de verdad', () => {
  for (const regla of POLITICA_RETENCION) {
    assert.ok(regla.plazo.length > 3, `${regla.tabla}: plazo vacío`)
    assert.match(regla.baseLegal, /RGPD|Código de Comercio|Ley/, `${regla.tabla}: base legal floja`)
    // Una justificación de cuatro palabras no es una justificación.
    assert.ok(regla.justificacion.length > 60, `${regla.tabla}: justificación demasiado corta`)
    assert.equal(typeof regla.purgaAutomatica, 'boolean')
  }
})

test('no hay tablas repetidas en la política', () => {
  const tablas = POLITICA_RETENCION.map((r) => r.tabla)
  assert.equal(new Set(tablas).size, tablas.length)
})

test('identity_vault vive exactamente lo que la cuenta', () => {
  const regla = reglaDeTabla('identity_vault')
  assert.ok(regla)
  assert.equal(regla.plazo, 'vida de la cuenta')
  assert.equal(regla.purgaAutomatica, false)
})

test('lo que declara purga automática es lo que purgar_retencion() borra', () => {
  const migracion = readFileSync(
    join(RAIZ, 'supabase', 'migrations', '0201_1_b20_privacidad.sql'),
    'utf8',
  )
  const cuerpo = migracion.slice(migracion.indexOf('function public.purgar_retencion'))

  for (const tabla of tablasConPurgaAutomatica()) {
    assert.ok(
      cuerpo.includes(`delete from public.${tabla}`),
      `${tabla} declara purga automática pero purgar_retencion() no la borra`,
    )
  }
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · crystal_ledger NO se purga en automático (es append-only por trigger)', () => {
  const regla = reglaDeTabla('crystal_ledger')
  assert.ok(regla)
  assert.equal(regla.purgaAutomatica, false)
  assert.match(regla.justificacion, /append-only|manual/i)

  const migracion = readFileSync(
    join(RAIZ, 'supabase', 'migrations', '0201_1_b20_privacidad.sql'),
    'utf8',
  )
  const cuerpo = migracion.slice(migracion.indexOf('function public.purgar_retencion'))
  assert.ok(
    !cuerpo.includes('delete from public.crystal_ledger'),
    'purgar_retencion() intenta borrar crystal_ledger: el trigger de inmutabilidad de 0002 ' +
      'lanzaría y el cron entero fallaría en cada pasada.',
  )
})

test('FALLO · purgar_retencion() nunca borra sin límite por lote', () => {
  const migracion = readFileSync(
    join(RAIZ, 'supabase', 'migrations', '0201_1_b20_privacidad.sql'),
    'utf8',
  )
  const cuerpo = migracion.slice(migracion.indexOf('function public.purgar_retencion'))

  // Cada `delete` del barrido va acotado por ctid + limit. Un delete sin límite
  // sobre content_views o refuge_messages bloquea la tabla y tumba la app.
  const borrados = cuerpo.match(/delete from public\.\w+/g) ?? []
  assert.ok(borrados.length >= 5)
  assert.equal((cuerpo.match(/limit v_lote/g) ?? []).length, borrados.length)
})

test('FALLO · una tabla nueva sin clasificar se detecta (simulación)', () => {
  const cubiertas = new Set(POLITICA_RETENCION.map((r) => r.tabla))
  // La tabla que alguien creará mañana y olvidará clasificar.
  assert.ok(!cubiertas.has('tabla_futura_sin_clasificar'))
  const inventada = [...TABLAS_CON_DATOS_PERSONALES, 'tabla_futura_sin_clasificar']
  const faltan = inventada.filter((t) => !cubiertas.has(t))
  assert.deepEqual(faltan, ['tabla_futura_sin_clasificar'])
})
