// ============================================================================
// Tests del guard de tipos generados.
//
// La parte que necesita una Supabase local (generar de verdad) no se puede
// probar aquí; lo que sí se prueba —y es lo que falla en la práctica— es la
// COMPARACIÓN y, sobre todo, que el mensaje de fallo traiga el comando exacto.
// Un CI que dice «los tipos no coinciden» sin decir qué ejecutar hace perder
// veinte minutos a cada persona que se lo encuentra.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compararTipos, normalizar, COMANDO_REGENERAR, RUTA_TIPOS } from './guardTipos.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

test('11 · un database.types.ts desincronizado sale con hallazgo y con el comando exacto', () => {
  const actual = 'export type Database = { public: { Tables: { posts: object } } }\n'
  const generado = 'export type Database = { public: { Tables: { posts: object, comments: object } } }\n'

  const r = compararTipos(actual, generado)

  assert.equal(r.ok, false)
  assert.ok(r.primerasDiferencias.length > 0, 'debe señalar qué línea difiere')
  assert.ok(
    r.mensaje.includes(COMANDO_REGENERAR),
    `el mensaje debe traer el comando de regeneración:\n${r.mensaje}`,
  )
  assert.match(r.mensaje, /supabase db reset/)
  assert.match(r.mensaje, /No edites el archivo a mano/)
})

test('tipos idénticos → ok', () => {
  const contenido = 'export type Database = { public: { Tables: object } }\n'
  const r = compararTipos(contenido, contenido)
  assert.equal(r.ok, true)
  assert.deepEqual(r.primerasDiferencias, [])
})

test('CRLF vs LF no cuenta como diferencia (Windows escribe CRLF, el CLI genera LF)', () => {
  const lf = 'linea 1\nlinea 2\n'
  const crlf = 'linea 1\r\nlinea 2\r\n'
  assert.equal(compararTipos(crlf, lf).ok, true)
  assert.equal(normalizar(crlf), normalizar(lf))
})

test('un espacio al final de línea tampoco cuenta', () => {
  assert.equal(compararTipos('a   \nb\n', 'a\nb\n').ok, true)
})

test('editar el archivo a mano SÍ cuenta como diferencia', () => {
  // El caso real: alguien «arregla» un tipo en el archivo generado en vez de en
  // la migración. El CI tiene que revertirlo, y para eso tiene que detectarlo.
  const generado = 'export type Row = { id: string }\n'
  const editado = 'export type Row = { id: string | null }\n'
  assert.equal(compararTipos(editado, generado).ok, false)
})

// ── El archivo del repositorio ──────────────────────────────────────────────

test('lib/supabase/database.types.ts existe y es consumible', () => {
  const ruta = join(RAIZ, RUTA_TIPOS)
  assert.ok(existsSync(ruta), `${RUTA_TIPOS} no existe y doce bloques lo consumen (CONTRATOS §3)`)

  const contenido = readFileSync(ruta, 'utf8')
  assert.match(contenido, /ARCHIVO GENERADO/, 'debe llevar cabecera de archivo generado')
  assert.ok(
    contenido.includes(COMANDO_REGENERAR),
    'la cabecera debe decir con qué comando se regenera',
  )
  assert.match(contenido, /export type Database/)

  // Las tablas de las dos migraciones tienen que estar todas.
  for (const tabla of [
    'profiles',
    'identity_vault',
    'karma_weights',
    'karma_events',
    'posts',
    'comments',
    'post_votes',
    'refuges',
    'refuge_members',
    'refuge_messages',
    'kindred',
    'blocks',
    'content_items',
    'content_views',
    'polls',
    'poll_options',
    'poll_votes',
    'moderation_flags',
    'crisis_events',
    'crystal_ledger',
    'boosts',
    'gifts',
    'rate_limits',
  ]) {
    assert.match(contenido, new RegExp(`\\n\\s+${tabla}: \\{`), `falta la tabla ${tabla} en los tipos`)
  }
})
