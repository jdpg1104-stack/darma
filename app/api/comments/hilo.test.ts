// ============================================================================
// Pruebas de la parte PURA de B04.
//
//   node --test --experimental-strip-types "app/api/comments/hilo.test.ts"
//
// Aquí solo está lo que se puede decidir sin base de datos: el códec del
// cursor, la proyección de una fila a su forma pública, la lectura del karma
// realmente concedido y la traducción del 23505.
//
// Lo que SÍ necesita Postgres —que el comentario nace con `is_validated =
// false`, que el trigger paga +10 y +1 crédito, que el índice único corta el
// segundo crédito en el mismo post, que un apoyo no mueve nada de economía— se
// verifica contra la base de desarrollo real, porque probar un trigger con un
// doble de prueba solo demuestra que el doble funciona.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { codificarCursor, decodificarCursor } from './cursor.ts'
import {
  aComentarioHilo,
  esEscuchaDuplicada,
  karmaConcedido,
  perfilDeAutor,
  validacionRepetida,
  type FilaAutor,
  type FilaComentario,
} from './dominio.ts'

const AUTOR: FilaAutor = {
  id: '11111111-1111-4111-8111-111111111111',
  alias: 'Faro Sereno 4821',
  avatar_seed: 'a1b2c3d4e5f60718',
  level: 'brote',
  karma_reputation: 640,
  availability: 'disponible',
}

function fila(parcial: Partial<FilaComentario> = {}): FilaComentario {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    author_id: AUTOR.id,
    body: 'Te leo y me suena mucho a lo que me pasó el año pasado con el trabajo.',
    is_validated: true,
    is_helpful: false,
    upvote_count: 0,
    created_at: '2026-08-03T10:00:00.000Z',
    autor: AUTOR,
    ...parcial,
  }
}

// ── Cursor ──────────────────────────────────────────────────────────────────

test('el cursor va y vuelve sin perder el par (created_at, id)', () => {
  const cursor = { creadoEn: '2026-08-03T10:00:00.000Z', id: AUTOR.id }
  assert.deepEqual(decodificarCursor(codificarCursor(cursor)), cursor)
})

test('el cursor es opaco: no contiene el uuid en claro', () => {
  const codificado = codificarCursor({ creadoEn: '2026-08-03T10:00:00.000Z', id: AUTOR.id })
  assert.ok(!codificado.includes(AUTOR.id))
  // base64url: sin +, / ni relleno, para que sobreviva a una query string.
  assert.match(codificado, /^[A-Za-z0-9_-]+$/)
})

test('FALLO: un cursor corrupto se trata como primera página, no como error', () => {
  for (const malo of [
    undefined,
    null,
    '',
    'no-es-base64!!',
    codificarCursor({ creadoEn: '2026-08-03T10:00:00.000Z', id: AUTOR.id }).slice(0, 8),
    Buffer.from('solo-una-parte').toString('base64url'),
    Buffer.from('2026-08-03T10:00:00.000Z|no-soy-un-uuid').toString('base64url'),
    Buffer.from('no-soy-una-fecha|11111111-1111-4111-8111-111111111111').toString('base64url'),
  ]) {
    assert.equal(decodificarCursor(malo as string | null | undefined), null)
  }
})

// ── Proyección pública ──────────────────────────────────────────────────────

test('el perfil del autor solo expone lo que CONTRATOS §2 llama PerfilPublico', () => {
  const perfil = perfilDeAutor(AUTOR)
  assert.deepEqual(Object.keys(perfil).sort(), [
    'alias',
    'avatarSeed',
    'disponibilidad',
    'esMentor',
    'id',
    'karmaReputacion',
    'nivel',
  ])
})

test('un comentario de otra persona nunca revela que está sin validar', () => {
  const comentario = aComentarioHilo(fila({ is_validated: false }), 'otro-usuario')
  assert.equal(comentario.esMio, false)
  // Aunque la fila diga false, hacia fuera no se cuenta: quién tiene un
  // comentario pendiente es información sobre esa persona.
  assert.equal(comentario.validado, true)
})

test('el propio autor SÍ ve que su comentario está en revisión', () => {
  const comentario = aComentarioHilo(fila({ is_validated: false }), AUTOR.id)
  assert.equal(comentario.esMio, true)
  assert.equal(comentario.validado, false)
})

test('no salen quality_score, author_id, state ni risk', () => {
  const comentario = aComentarioHilo(fila(), AUTOR.id)
  assert.deepEqual(Object.keys(comentario).sort(), [
    'apoyos',
    'autor',
    'body',
    'creadoEn',
    'esMio',
    'esUtil',
    'id',
    'validado',
  ])
})

test('el embed del autor llega como array y se normaliza igual', () => {
  const comentario = aComentarioHilo(fila({ autor: [AUTOR] }), AUTOR.id)
  assert.equal(comentario.autor.alias, AUTOR.alias)
})

// ── Karma realmente concedido ───────────────────────────────────────────────

test('karmaGanado sale del ledger; sin fila en el ledger es 0, no 10', () => {
  // Es el caso del tope diario: award_karma recorta a 0 y ni siquiera escribe.
  assert.equal(karmaConcedido(null), 0)
  assert.equal(karmaConcedido([]), 0)
})

test('con el tope diario rozado se anuncia lo pagado, no los 10 nominales', () => {
  // daily_karma_earned = 118 → award_karma paga 2.
  assert.equal(karmaConcedido([{ delta_reputation: 2 }]), 2)
  assert.equal(karmaConcedido([{ delta_reputation: 10 }]), 10)
})

// ── El 23505 del índice único ───────────────────────────────────────────────

test('FALLO: el choque con uq_comments_one_listen_per_post no es un 500', () => {
  assert.equal(esEscuchaDuplicada({ code: '23505' }), true)
  assert.equal(esEscuchaDuplicada({ code: '23514' }), false)
  assert.equal(esEscuchaDuplicada(new Error('duplicate key value')), false)
  assert.equal(esEscuchaDuplicada(null), false)
  assert.equal(esEscuchaDuplicada(undefined), false)
})

test('la escucha repetida se explica en humano y sin nombrar el índice', () => {
  const resultado = validacionRepetida()
  assert.equal(resultado.estado, 'valido')
  assert.ok(resultado.motivo)
  assert.ok(!resultado.motivo!.includes('uq_comments'))
  assert.ok(!resultado.motivo!.toLowerCase().includes('duplicate'))
})

// ── La salvaguarda del modelo económico ─────────────────────────────────────
//
// Este test parece trivial y es el más importante del archivo. Vigila que la
// frase siga escrita donde alguien la leería antes de «arreglar» el sistema
// dando karma por likes, y que ninguna ruta del bloque llame a award_karma o
// spend_karma por su cuenta: el karma de B04 lo mueve el trigger, dentro de la
// misma transacción que la validación. No lo borres aunque parezca tonto.

const AQUI = import.meta.dirname

test('«un apoyo no da karma ni cuenta como escucha» sigue escrito en el código', () => {
  const ruta = readFileSync(join(AQUI, 'route.ts'), 'utf8')
  const boton = readFileSync(join(AQUI, '..', '..', '..', 'components', 'thread', 'BotonApoyo.tsx'), 'utf8')

  for (const fuente of [ruta, boton]) {
    assert.match(fuente, /NO DA KARMA Y NO CUENTA COMO ESCUCHA/)
  }
})

test('ninguna ruta de B04 llama a award_karma ni a spend_karma', () => {
  for (const relativa of [['route.ts'], ['[id]', 'route.ts'], ['[id]', 'util', 'route.ts']]) {
    const fuente = readFileSync(join(AQUI, ...relativa), 'utf8')
    assert.ok(!/rpc\(\s*['"]award_karma/.test(fuente), `award_karma en ${relativa.join('/')}`)
    assert.ok(!/rpc\(\s*['"]spend_karma/.test(fuente), `spend_karma en ${relativa.join('/')}`)
  }
})

test('el cliente admin no se usa fuera de los sitios justificados', () => {
  // La cuenta que importa: cuántos archivos del bloque importan el admin.
  const archivos = [
    ['route.ts'],
    ['[id]', 'route.ts'],
    ['[id]', 'util', 'route.ts'],
    ['consulta.ts'],
    ['cursor.ts'],
    ['dominio.ts'],
    ['validador.ts'],
    ['validacion.ts'],
  ]

  const conAdmin = archivos.filter((relativa) =>
    /createAdminClient/.test(readFileSync(join(AQUI, ...relativa), 'utf8')),
  )

  assert.deepEqual(
    conAdmin.map((r) => r.join('/')).sort(),
    ['[id]/route.ts', '[id]/util/route.ts', 'route.ts'],
  )
})
