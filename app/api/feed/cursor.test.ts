// ============================================================================
// Pruebas del cursor compuesto.
//
// El grueso son caminos de FALLO, y no por completismo: un cursor es lo único
// del feed que viaja por la url, o sea lo único que cualquiera puede manipular.
// La regla que se fija aquí —cualquier basura produce la primera página, nunca
// una excepción— es la que impide que un enlace mal pegado se convierta en un
// 500 y en una línea de log con el SQL dentro.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CURSOR_VACIO,
  codificarCursor,
  decodificarCursor,
  esPrimeraPagina,
  type CursorCompuesto,
} from './cursor.ts'
import { CURSOR_MAX_CARACTERES } from './validacion.ts'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

const COMPLETO: CursorCompuesto = {
  postsHot: { hotScore: 414.10537785382, id: UUID_A },
  postsNuevo: null,
  contenido: { hotScore: 0.87, id: UUID_B },
  encuesta: { instante: '2026-08-03T10:11:12.123456+00:00', id: UUID_C },
}

test('ida y vuelta: las tres posiciones sobreviven al viaje', () => {
  const token = codificarCursor(COMPLETO, 'para_ti')
  assert.ok(token)

  const vuelta = decodificarCursor(token, 'para_ti')
  assert.deepEqual(vuelta.postsHot, COMPLETO.postsHot)
  assert.deepEqual(vuelta.contenido, COMPLETO.contenido)
  assert.deepEqual(vuelta.encuesta, COMPLETO.encuesta)
  assert.equal(vuelta.postsNuevo, null)
})

test('el instante conserva los microsegundos exactos de Postgres', () => {
  // Truncar a milisegundos haría que el predicado (created_at, id) < (:ts, :id)
  // se saltara las filas escritas en los microsegundos intermedios: posts que
  // nadie llega a ver nunca, sin ningún síntoma visible.
  const instante = '2026-08-03T10:11:12.123456+00:00'
  const token = codificarCursor(
    { postsHot: null, postsNuevo: { instante, id: UUID_A }, contenido: null, encuesta: null },
    'nuevo',
  )
  assert.ok(token)

  const vuelta = decodificarCursor(token, 'nuevo')
  assert.equal(vuelta.postsNuevo?.instante, instante)
})

test('el token cabe en el límite de 256 caracteres que impone la validación', () => {
  // Si esto falla, un cursor legítimo sería rechazado por nuestra propia zod y
  // el scroll se pararía en la página 2 sin explicación.
  const token = codificarCursor(COMPLETO, 'para_ti')
  assert.ok(token)
  assert.ok(
    token.length <= CURSOR_MAX_CARACTERES,
    `el cursor mide ${token.length} y el máximo permitido es ${CURSOR_MAX_CARACTERES}`,
  )
})

test('sin posición de posts no hay página siguiente', () => {
  // El carril de posts es la columna vertebral: un feed que continúa solo con
  // vídeos curados no es el feed de una comunidad.
  assert.equal(codificarCursor(CURSOR_VACIO, 'para_ti'), null)
  assert.equal(codificarCursor({ ...COMPLETO, postsHot: null }, 'para_ti'), null)
})

// ── Caminos de fallo ────────────────────────────────────────────────────────

test('FALLO · un cursor corrupto devuelve la primera página, nunca una excepción', () => {
  const basura = [
    'no-es-base64-en-absoluto',
    '!!!.???.###',
    'a.b',                                   // segmentos de menos
    'a.b.c.d',                               // segmentos de más
    Buffer.from('sin-separador').toString('base64url') + '..',
    Buffer.from('12.5|no-es-un-uuid').toString('base64url') + '..',
    Buffer.from('NaN|' + UUID_A).toString('base64url') + '..',
    '.'.repeat(300),
    '',
  ]

  for (const token of basura) {
    const cursor = decodificarCursor(token, 'para_ti')
    assert.ok(esPrimeraPagina(cursor), `debería ser primera página: ${token.slice(0, 24)}`)
  }
})

test('FALLO · null y undefined también son la primera página', () => {
  assert.ok(esPrimeraPagina(decodificarCursor(null, 'para_ti')))
  assert.ok(esPrimeraPagina(decodificarCursor(undefined, 'nuevo')))
})

test('FALLO · un segmento roto no arrastra a los demás', () => {
  // Que las encuestas vengan corruptas no puede tirar el carril de posts: el
  // usuario perdería el sitio en el feed por un carril accesorio.
  const token = codificarCursor(COMPLETO, 'para_ti')!
  const [p, c] = token.split('.')
  const cursor = decodificarCursor(`${p}.${c}.###corrupto###`, 'para_ti')

  assert.deepEqual(cursor.postsHot, COMPLETO.postsHot)
  assert.deepEqual(cursor.contenido, COMPLETO.contenido)
  assert.equal(cursor.encuesta, null)
})

test('FALLO · un cursor del otro carril no rompe: ese carril arranca de cero', () => {
  const token = codificarCursor(COMPLETO, 'para_ti')!
  const cursor = decodificarCursor(token, 'nuevo')

  // El segmento numérico no vale como posición temporal.
  assert.equal(cursor.postsNuevo, null)
  assert.equal(cursor.postsHot, null)
  // Los carriles accesorios sí se conservan: son iguales en los dos carriles.
  assert.deepEqual(cursor.contenido, COMPLETO.contenido)
})

test('FALLO · un instante que no es una fecha se descarta', () => {
  const segmento = Buffer.from(`no-soy-una-fecha|${UUID_A}`, 'utf8').toString('base64url')
  const cursor = decodificarCursor(`${segmento}..`, 'nuevo')
  assert.equal(cursor.postsNuevo, null)
})
