import test from 'node:test'
import assert from 'node:assert/strict'

import { esCronAutorizado } from './cronAuth.ts'

const SECRETO = 'a'.repeat(64)

// ── Prueba exigida nº 8 · caminos de fallo del Bearer ───────────────────────

test('CAMINO DE FALLO: sin cabecera Authorization → no autorizado', () => {
  assert.equal(esCronAutorizado(null, SECRETO), false)
  assert.equal(esCronAutorizado(undefined, SECRETO), false)
  assert.equal(esCronAutorizado('', SECRETO), false)
})

test('CAMINO DE FALLO: Bearer erróneo → no autorizado', () => {
  assert.equal(esCronAutorizado(`Bearer ${'b'.repeat(64)}`, SECRETO), false)
  // Prefijo correcto del secreto: no basta con acertar el principio.
  assert.equal(esCronAutorizado(`Bearer ${'a'.repeat(63)}`, SECRETO), false)
  // Ni con pasarse de largo.
  assert.equal(esCronAutorizado(`Bearer ${'a'.repeat(65)}`, SECRETO), false)
})

test('CAMINO DE FALLO: sin CRON_SECRET definido → 401 SIEMPRE, incluso con un Bearer', () => {
  // Fail-closed. La tentación es «si no hay secreto, deja pasar, que estamos en
  // local»: eso convierte un despliegue con una variable olvidada en un endpoint
  // abierto que agota la cuota de moderación de quien lo encuentre.
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, undefined), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, ''), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, null), false)
  assert.equal(esCronAutorizado(null, undefined), false)
})

test('un esquema que no es Bearer no vale, aunque lleve el secreto', () => {
  assert.equal(esCronAutorizado(SECRETO, SECRETO), false)
  assert.equal(esCronAutorizado(`Basic ${SECRETO}`, SECRETO), false)
  assert.equal(esCronAutorizado(`bearer ${SECRETO}`, SECRETO), false)
})

test('el Bearer correcto autoriza', () => {
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, SECRETO), true)
})

test('secretos de longitudes distintas no revientan la comparación', () => {
  // timingSafeEqual LANZA si los búferes no miden lo mismo; comprobar la
  // longitud antes filtraría el tamaño del secreto. Aquí se comprueba que ni
  // lanza ni acepta.
  assert.doesNotThrow(() => esCronAutorizado('Bearer x', SECRETO))
  assert.equal(esCronAutorizado('Bearer x', SECRETO), false)
  assert.equal(esCronAutorizado(`Bearer ${'x'.repeat(500)}`, SECRETO), false)
})
