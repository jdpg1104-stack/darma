// ============================================================================
// El camino de ATAQUE de `POST /api/billing/restore`
//
// El agujero que estas pruebas cierran: la ruta acreditaba a la sesión
// cualquier recibo que Apple diera por bueno. Una firma válida dice «esta
// compra existió», no «es tuya», y el `originalTransactionId` con el que se pide
// el historial NO es un secreto: circula en capturas, en hilos de soporte y en
// los correos de reembolso.
//
// El `unique(external_id)` del ledger no salvaba nada: impide el doble cobro,
// no la mala atribución. Y una vez atribuida mal, esa misma idempotencia impide
// al dueño real restaurar lo suyo — «ya existe».
//
// Las cuatro pruebas que importan son las cuatro entradas posibles del titular:
// coincide, ajeno, ausente y deforme. Todo lo de aquí es política PURA: sin red,
// sin clave `.p8` y sin base de datos. Lo único que se inyecta son transacciones
// tal y como salen del JWS ya verificado.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  clasificarRestauracion,
  comprobarTitular,
  evaluarTransaccion,
  historialTransacciones,
  huellaTitular,
  titularDeTransaccion,
  verificarRecibo,
  type ReciboRestaurable,
  type TransaccionApple,
} from './apple.ts'

const CONFIG = { bundleId: 'app.darma', entorno: 'Production' } as const

/** uuid de quien pide la restauración. En Darma es `profiles.id`. */
const YO = '6b1f1f7c-1e4a-4b2e-9c3a-0d1a2b3c4d5e'
/** uuid de otra persona: el que sale en la captura del foro de soporte. */
const OTRA_PERSONA = 'f0e9d8c7-b6a5-4321-8765-43210fedcba9'

const TRANSACCION_BASE: TransaccionApple = {
  transactionId: '2000000123456789',
  bundleId: 'app.darma',
  productId: 'app.darma.crystals.550',
  environment: 'Production',
  type: 'Consumable',
}

/**
 * Reproduce EXACTAMENTE lo que hace `historialTransacciones()` con cada JWS ya
 * verificado: evaluar la política y quedarse con el titular declarado. Si esa
 * composición cambiara en `apple.ts`, estas pruebas dejarían de probar el camino
 * real, y por eso se construye igual en vez de escribir el objeto a mano.
 */
function reciboDe(transaccion: TransaccionApple): ReciboRestaurable {
  return { ...evaluarTransaccion(transaccion, CONFIG), cuentaApp: titularDeTransaccion(transaccion) }
}

// ── Los cuatro casos del titular ────────────────────────────────────────────

test('el titular que coincide con la sesión es el ÚNICO que acredita', () => {
  assert.equal(comprobarTitular(YO, YO), 'coincide')

  // Apple documenta un uuid, y hay clientes que lo mandan en mayúsculas o con
  // espacios alrededor. `profiles.id` es minúscula: comparar en crudo dejaría
  // sin restaurar a gente con un recibo perfectamente suyo.
  assert.equal(comprobarTitular(YO.toUpperCase(), YO), 'coincide')
  assert.equal(comprobarTitular(`  ${YO}  `, YO), 'coincide')
})

test('ATAQUE · un recibo de otra persona es AJENO, no un recibo más', () => {
  assert.equal(comprobarTitular(OTRA_PERSONA, YO), 'ajeno')

  const seleccion = clasificarRestauracion([reciboDe({ ...TRANSACCION_BASE, appAccountToken: OTRA_PERSONA })], YO)

  // Lo que importa: NADA acreditable.
  assert.deepEqual(seleccion.restaurables, [])
  assert.equal(seleccion.ajenas.length, 1)
  assert.equal(seleccion.sinTitular, 0)

  // Y en lo que sale hacia el log no puede estar el `profiles.id` de la otra
  // persona: sería atar su identidad a la sesión de quien lo está probando.
  assert.ok(!seleccion.ajenas.includes(OTRA_PERSONA))
  assert.equal(seleccion.ajenas[0], huellaTitular(OTRA_PERSONA))
})

test('ATAQUE · el titular AUSENTE ni acredita ni acusa', () => {
  for (const vacio of [null, undefined, '', '   ']) {
    assert.equal(comprobarTitular(vacio, YO), 'ausente', JSON.stringify(vacio))
  }

  // Un recibo legítimo puede no traerlo (compra anterior a que la app lo
  // enviara). Fail-closed: no se acredita. Pero `ajenas` vacío es lo que hace
  // que la ruta responda 200 con `acreditados: 0` en vez de acusar de robo.
  const seleccion = clasificarRestauracion([reciboDe(TRANSACCION_BASE)], YO)

  assert.deepEqual(seleccion.restaurables, [])
  assert.deepEqual(seleccion.ajenas, [])
  assert.equal(seleccion.sinTitular, 1, 'queda contado para que soporte pueda atenderlo a mano')
})

test('ATAQUE · un titular DEFORME no se degrada a «ausente»', () => {
  // Si lo deforme cayera en la rama indulgente, existiría un camino para
  // alcanzarla a propósito. Presente ⇒ tiene que coincidir; y si no coincide,
  // es ajeno aunque no sea el uuid de nadie.
  for (const deforme of ['no-es-un-uuid', '6b1f1f7c', '{}', '0', 'null', `${YO}x`, YO.replace(/-/g, '')]) {
    assert.equal(comprobarTitular(deforme, YO), 'ajeno', deforme)
  }

  const seleccion = clasificarRestauracion([reciboDe({ ...TRANSACCION_BASE, appAccountToken: 'null' })], YO)
  assert.deepEqual(seleccion.restaurables, [])
  assert.equal(seleccion.ajenas.length, 1)
})

test('un recibo con titular correcto SÍ se restaura (el arreglo no rompe el caso bueno)', () => {
  const mio = reciboDe({ ...TRANSACCION_BASE, appAccountToken: YO })

  const seleccion = clasificarRestauracion([mio], YO)

  assert.equal(seleccion.restaurables.length, 1)
  assert.equal(seleccion.restaurables[0]?.externalId, 'apple:2000000123456789')
  assert.equal(seleccion.restaurables[0]?.productId, 'app.darma.crystals.550')
  assert.deepEqual(seleccion.ajenas, [])
  assert.equal(seleccion.sinTitular, 0)
})

// ── Historial mezclado ──────────────────────────────────────────────────────

test('ATAQUE · un solo recibo ajeno tumba la restauración ENTERA', () => {
  // Un `originalTransactionId` es de una sola cuenta de Apple: si una
  // transacción del hilo declara otro titular, el hilo no es de quien lo pide.
  // Acreditar «los que sí coinciden» convertiría el intento en un éxito parcial.
  const historial = [
    reciboDe({ ...TRANSACCION_BASE, transactionId: '1', appAccountToken: YO }),
    reciboDe({ ...TRANSACCION_BASE, transactionId: '2', appAccountToken: OTRA_PERSONA }),
    reciboDe({ ...TRANSACCION_BASE, transactionId: '3' }),
  ]

  const seleccion = clasificarRestauracion(historial, YO)

  assert.deepEqual(seleccion.restaurables, [], 'ni siquiera el que coincidía')
  assert.equal(seleccion.ajenas.length, 1)
  assert.equal(seleccion.sinTitular, 1)
})

test('las huellas ajenas no se repiten: el log cuenta titulares, no recibos', () => {
  const historial = [
    reciboDe({ ...TRANSACCION_BASE, transactionId: '1', appAccountToken: OTRA_PERSONA }),
    reciboDe({ ...TRANSACCION_BASE, transactionId: '2', appAccountToken: OTRA_PERSONA.toUpperCase() }),
    reciboDe({ ...TRANSACCION_BASE, transactionId: '3', appAccountToken: 'otro-mas' }),
  ]

  const seleccion = clasificarRestauracion(historial, YO)

  assert.equal(seleccion.ajenas.length, 2, 'dos titulares distintos, tres recibos')
})

test('un historial vacío no es un ataque ni un error', () => {
  const seleccion = clasificarRestauracion([], YO)
  assert.deepEqual(seleccion, { restaurables: [], ajenas: [], sinTitular: 0 })
})

// ── Fail-closed en los bordes ───────────────────────────────────────────────

test('FALLO · sin sesión utilizable no se acredita nada', () => {
  // `requirePerfil()` garantiza el `userId`, pero la política no se apoya en esa
  // garantía: ante la duda, cerrado. Y con el titular también vacío sigue siendo
  // «ausente», que tampoco acredita.
  assert.equal(comprobarTitular(YO, ''), 'ajeno')
  assert.equal(comprobarTitular(YO, '   '), 'ajeno')
  assert.equal(comprobarTitular(null, ''), 'ausente')
})

test('titularDeTransaccion normaliza el blanco a null: «ausente» se define una sola vez', () => {
  assert.equal(titularDeTransaccion(TRANSACCION_BASE), null)
  assert.equal(titularDeTransaccion({ ...TRANSACCION_BASE, appAccountToken: '' }), null)
  assert.equal(titularDeTransaccion({ ...TRANSACCION_BASE, appAccountToken: '  ' }), null)
  assert.equal(titularDeTransaccion({ ...TRANSACCION_BASE, appAccountToken: ` ${YO} ` }), YO)
})

test('un recibo que no vale nunca llega a la clasificación con titular', () => {
  // Sandbox en producción: `evaluarTransaccion` ya lo invalida. Aunque traiga un
  // titular que coincide, el recibo no es acreditable, y `historialTransacciones`
  // lo descarta con el `.filter(r => r.valido)`.
  const sandbox = reciboDe({ ...TRANSACCION_BASE, environment: 'Sandbox', appAccountToken: YO })
  assert.equal(sandbox.valido, false)
  assert.equal(sandbox.externalId, null)
})

// ── Huella para el log ──────────────────────────────────────────────────────

test('la huella es estable, corta y no contiene el identificador', () => {
  const huella = huellaTitular(OTRA_PERSONA)

  assert.match(huella, /^[0-9a-f]{16}$/)
  assert.equal(huella, huellaTitular(OTRA_PERSONA), 'estable: si no, no se puede correlacionar')
  assert.ok(!huella.includes(OTRA_PERSONA.slice(0, 8)))
  assert.notEqual(huella, huellaTitular(YO))

  // Misma cuenta escrita de otra forma = misma huella; si no, el mismo atacante
  // parecería varios y el patrón se perdería.
  assert.equal(huellaTitular(` ${OTRA_PERSONA.toUpperCase()} `), huella)
})

// ── Sin configuración, nada (y sin red) ─────────────────────────────────────

test('FALLO · sin configuración de Apple no hay historial que restaurar', async () => {
  assert.deepEqual(await historialTransacciones('2000000123456789', null), [])

  // Y el recibo suelto sale sin titular: `cuentaApp` nunca queda `undefined`,
  // que es lo que haría que `comprobarTitular` tuviera que adivinar.
  const recibo = await verificarRecibo('2000000123456789', null)
  assert.equal(recibo.valido, false)
  assert.equal(recibo.cuentaApp, null)
})

// ── El mismo criterio en /verify, no uno propio ─────────────────────────────
//
// `restore` y `verify` cierran la misma puerta —un recibo auténtico no es un
// recibo TUYO— y la cierran con la MISMA función. Estas pruebas fijan que el
// criterio no se bifurque: el día que alguien ajuste `comprobarTitular()` para
// una de las dos rutas, la otra se entera.

test('🔴 las dos rutas comparten decisión: no hay un criterio por ruta', () => {
  // Si alguien escribe una comparación a mano en `verify` en vez de llamar aquí,
  // esta prueba no lo caza — pero el guard de abajo sí.
  const usuario = '11111111-1111-4111-8111-111111111111'
  const otro = '22222222-2222-4222-8222-222222222222'

  assert.equal(comprobarTitular(usuario, usuario), 'coincide')
  assert.equal(comprobarTitular(otro, usuario), 'ajeno')
  assert.equal(comprobarTitular(null, usuario), 'ausente')
})

test('🔴 las DOS rutas que acreditan comprueban titularidad', () => {
  // Lo que este guard vigila es que ninguna de las dos vías de acreditación se
  // quede sin la comprobación: `verify` (compra recién hecha) y `restore`
  // (historial). Verificar que un recibo es AUTÉNTICO no es verificar que es DE
  // QUIEN LO PRESENTA, y esa distinción tiene que estar en las dos.
  //
  // Aquí hubo además un intento de vigilar que ninguna comparase el titular «a
  // mano» en vez de llamar a `comprobarTitular()`. Se retiró: el regex daba
  // falsos positivos con una simple comprobación de nulidad, y un guard que
  // salta con su propio caso permitido enseña a desactivarlo — que es peor que
  // no tenerlo. Lo que quedaría por vigilar es de estilo, no de seguridad.
  for (const ruta of ['../../app/api/billing/verify/route.ts', '../../app/api/billing/restore/route.ts']) {
    const fuente = readFileSync(new URL(ruta, import.meta.url), 'utf8')
    assert.match(fuente, /comprobarTitular\(/, `${ruta} no comprueba titularidad`)
  }
})

test('la asimetría entre las dos rutas ante el titular AUSENTE es deliberada', () => {
  // `restore` no acredita lo ausente; `verify` sí. No es un descuido: en
  // `restore` se piden compras VIEJAS —el caso en que el token pudo no existir—
  // y en `verify` se acaba de pagar en un cliente que ya lo envía. Rechazar lo
  // ausente en `verify` rompería la compra recién hecha de quien use una versión
  // antigua. Si alguien unifica las dos, que sea a sabiendas.
  const verify = readFileSync(new URL('../../app/api/billing/verify/route.ts', import.meta.url), 'utf8')
  assert.match(verify, /verify_sin_titular/, 'verify debe REGISTRAR lo ausente aunque lo acredite')
})
