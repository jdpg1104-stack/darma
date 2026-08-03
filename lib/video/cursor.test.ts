// ============================================================================
// B07 · Cursor keyset y validación de entrada (caso 10 de la ficha).
//
// Un cursor corrupto es 422, NUNCA "vuelve a la primera página": ese silencio
// convierte un scroll roto en un bucle infinito de la misma página y no hay
// forma de diagnosticarlo desde fuera.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CURSOR_INICIAL, codificarCursor, decodificarCursor, siguienteCursor } from './cursor.ts'
import { LIMITE_FEED_DEFECTO, LIMITE_FEED_MAXIMO, validarParametrosFeed } from './validacion.ts'
import { ErrorApi } from '../auth/errores.ts'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('ida y vuelta del cursor', () => {
  const original = { score: 1.2345678, id: ID }
  assert.deepEqual(decodificarCursor(codificarCursor(original)), original)
})

test('el cursor es opaco: no contiene el uuid en claro', () => {
  assert.ok(!codificarCursor({ score: 1, id: ID }).includes(ID))
})

// ── 10 · FALLO: cursor corrupto ────────────────────────────────────────────
test('un cursor manipulado devuelve null, no la primera página', () => {
  const corruptos = [
    'no-es-base64-!!!',
    Buffer.from('sin-separador').toString('base64url'),
    Buffer.from('1.5|no-es-uuid').toString('base64url'),
    Buffer.from('|' + ID).toString('base64url'),
    Buffer.from('abc|' + ID).toString('base64url'),
    // `Infinity` es el sentinel INTERNO de la primera página: aceptarlo desde
    // fuera permitiría pedir siempre la cabeza del feed con algo que aparenta
    // ser un cursor de scroll.
    Buffer.from('Infinity|' + ID).toString('base64url'),
    Buffer.from('NaN|' + ID).toString('base64url'),
    '',
  ]

  for (const cursor of corruptos) {
    assert.equal(decodificarCursor(cursor), null, `${cursor} debería rechazarse`)
  }
})

test('un cursor corrupto en la ruta es 422 entrada_invalida', () => {
  const url = new URL('https://darma.app/api/content/feed?cursor=basura!!')

  assert.throws(
    () => validarParametrosFeed(url),
    (error: unknown) => error instanceof ErrorApi && error.code === 'entrada_invalida' && error.status === 422,
  )
})

test('los parámetros del feed tienen defectos y techo', () => {
  const base = validarParametrosFeed(new URL('https://darma.app/api/content/feed'))
  assert.equal(base.limite, LIMITE_FEED_DEFECTO)
  assert.equal(base.limite, 10)
  assert.equal(base.idioma, 'es')
  assert.equal(base.cursor, null)

  assert.throws(
    () => validarParametrosFeed(new URL(`https://darma.app/x?limite=${LIMITE_FEED_MAXIMO + 1}`)),
    (error: unknown) => error instanceof ErrorApi && error.code === 'entrada_invalida',
  )
  assert.throws(
    () => validarParametrosFeed(new URL('https://darma.app/x?limite=0')),
    (error: unknown) => error instanceof ErrorApi,
  )
  assert.throws(
    () => validarParametrosFeed(new URL('https://darma.app/x?idioma=espanol')),
    (error: unknown) => error instanceof ErrorApi,
  )
})

// ── Fin de la paginación ───────────────────────────────────────────────────
test('una página incompleta cierra la paginación sin un viaje extra', () => {
  const filas = [{ id: ID, performance_score: 3 }]
  assert.equal(siguienteCursor(filas, 10), null)
  assert.equal(siguienteCursor([], 10), null)
})

test('una página llena devuelve el cursor de la última fila', () => {
  const filas = [
    { id: ID, performance_score: 3 },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', performance_score: 2 },
  ]
  const cursor = siguienteCursor(filas, 2)
  assert.deepEqual(decodificarCursor(cursor as string), {
    score: 2,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
})

test('el cursor inicial es el techo del índice', () => {
  assert.equal(CURSOR_INICIAL.score, Number.POSITIVE_INFINITY)
  assert.equal(CURSOR_INICIAL.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
})
