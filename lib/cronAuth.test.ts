// ============================================================================
// Pruebas de la ÚNICA implementación de la autenticación de crons.
//
// Las pruebas de B06 (`lib/ranking/cronAuth.test.ts`) y B08
// (`lib/ingest/cronAuth.test.ts`) siguen ahí y siguen pasando: ahora ejercitan
// esta misma función a través del re-export, que es justo lo que se quiere
// comprobar. Lo que se añade aquí es lo que ninguna de las dos podía probar por
// separado: que NO HAY DOS.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { esCronAutorizado, secretoCron } from './cronAuth.ts'
import { esCronAutorizado as desdeIngesta, secretoCron as secretoIngesta } from './ingest/cronAuth.ts'
import { esCronRankingAutorizado, secretoCronRanking } from './ranking/cronAuth.ts'

const SECRETO = 'un-secreto-de-cron-suficientemente-largo'

// ── LO QUE ESTA PRUEBA EXISTE PARA IMPEDIR ─────────────────────────────────
// Que alguien vuelva a escribir una segunda implementación en cualquiera de los
// dos módulos. Si `lib/ingest/cronAuth.ts` o `lib/ranking/cronAuth.ts` dejan de
// ser alias, esto falla inmediatamente y en el sitio correcto.
test('ingest y ranking son LA MISMA función, no dos copias', () => {
  assert.equal(desdeIngesta, esCronAutorizado, 'lib/ingest/cronAuth.ts ha dejado de re-exportar')
  assert.equal(esCronRankingAutorizado, esCronAutorizado, 'lib/ranking/cronAuth.ts ha dejado de re-exportar')
  assert.equal(secretoIngesta, secretoCron)
  assert.equal(secretoCronRanking, secretoCron)
})

test('camino feliz: el Bearer correcto pasa', () => {
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, SECRETO), true)
})

test('FAIL-CLOSED: sin CRON_SECRET no pasa NADIE, ni con un Bearer bien formado', () => {
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, undefined), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, null), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}`, ''), false)
  assert.equal(esCronAutorizado(null, undefined), false)
})

test('sin cabecera, con otro esquema, o sin el prefijo exacto → no autorizado', () => {
  assert.equal(esCronAutorizado(null, SECRETO), false)
  assert.equal(esCronAutorizado(undefined, SECRETO), false)
  assert.equal(esCronAutorizado('', SECRETO), false)
  assert.equal(esCronAutorizado(SECRETO, SECRETO), false, 'sin el prefijo Bearer tampoco')
  assert.equal(esCronAutorizado(`Basic ${SECRETO}`, SECRETO), false)
  assert.equal(esCronAutorizado(`bearer ${SECRETO}`, SECRETO), false, 'el prefijo distingue mayúsculas')
})

test('un secreto parecido no vale: ni prefijo, ni sufijo, ni longitud distinta', () => {
  assert.equal(esCronAutorizado('Bearer otra-cosa', SECRETO), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO}-y-mas`, SECRETO), false)
  assert.equal(esCronAutorizado(`Bearer ${SECRETO.slice(0, -1)}`, SECRETO), false)
})

test('longitudes distintas NO lanzan: `timingSafeEqual` explotaría sin el relleno', () => {
  // Si esto lanzara, el 401 se convertiría en un 500 — y un 500 distinto del
  // 401 es en sí mismo un oráculo sobre la longitud del secreto.
  assert.doesNotThrow(() => esCronAutorizado('Bearer x', SECRETO))
  assert.equal(esCronAutorizado('Bearer x', SECRETO), false)
  assert.equal(esCronAutorizado(`Bearer ${'x'.repeat(500)}`, SECRETO), false)
  assert.equal(esCronAutorizado('Bearer ', SECRETO), false)
  assert.equal(esCronAutorizado('Bearer', SECRETO), false)
})

test('el secreto se lee del entorno en la llamada, no al importar el módulo', () => {
  const previo = process.env.CRON_SECRET
  try {
    process.env.CRON_SECRET = 'valor-nuevo'
    assert.equal(secretoCron(), 'valor-nuevo')
    delete process.env.CRON_SECRET
    assert.equal(secretoCron(), undefined)
  } finally {
    if (previo === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previo
  }
})
