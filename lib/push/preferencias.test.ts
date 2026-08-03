import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PREFS_POR_DEFECTO,
  TIPOS_NOTIFICACION,
  esTipoNotificacion,
  estaActivo,
  revelaAlias,
  sanitizarPrefs,
} from './preferencias.ts'

// ── CAMINO FELIZ ────────────────────────────────────────────────────────────

test('1 · sanitizarPrefs conserva los valores válidos y rellena los defaults', () => {
  const salida = sanitizarPrefs({ te_escucharon: false, respuesta_hilo: true })

  assert.equal(salida.te_escucharon, false, 'lo que se pasó debe respetarse')
  assert.equal(salida.respuesta_hilo, true)
  // Lo que no se pasó, default.
  assert.equal(salida.te_ayudo, PREFS_POR_DEFECTO.te_ayudo)
  assert.equal(salida.alma_afin_en_crisis, true)
  assert.equal(salida.revelar_alias, true)

  // Siempre están las siete claves: quien consume no lidia con `undefined`.
  for (const tipo of TIPOS_NOTIFICACION) {
    assert.equal(typeof salida[tipo], 'boolean', `falta ${tipo}`)
  }
  assert.equal(typeof salida.revelar_alias, 'boolean')
})

test('defaults: lo dirigido está ON, lo ambiental está OFF', () => {
  assert.equal(PREFS_POR_DEFECTO.te_escucharon, true)
  assert.equal(PREFS_POR_DEFECTO.te_ayudo, true)
  assert.equal(PREFS_POR_DEFECTO.alma_afin_en_crisis, true)
  assert.equal(PREFS_POR_DEFECTO.mensaje_refugio, true)
  // Estos dos ON serían ruido: ninguno es «alguien hizo algo por ti».
  assert.equal(PREFS_POR_DEFECTO.respuesta_hilo, false)
  assert.equal(PREFS_POR_DEFECTO.nivel_alcanzado, false)
})

// ── CAMINO DE FALLO ─────────────────────────────────────────────────────────

test('7 · sanitizarPrefs descarta lo desconocido, no contamina el prototipo y no lanza', () => {
  const entrada = JSON.parse(
    '{"te_escucharon":"sí","__proto__":{"contaminado":true},"inventado":true}',
  ) as unknown

  const salida = sanitizarPrefs(entrada)

  // `'sí'` NO es `true`: convertir con `!!` haría que `'false'` activara avisos.
  assert.equal(salida.te_escucharon, PREFS_POR_DEFECTO.te_escucharon)
  assert.equal('inventado' in salida, false, 'la clave desconocida no debe copiarse')

  // Nada ha tocado Object.prototype.
  assert.equal(
    (Object.prototype as unknown as Record<string, unknown>).contaminado,
    undefined,
  )
  assert.equal(({} as Record<string, unknown>).contaminado, undefined)
})

test('sanitizarPrefs tolera cualquier basura sin lanzar', () => {
  for (const basura of [null, undefined, 42, 'texto', [], [1, 2], true, NaN]) {
    const salida = sanitizarPrefs(basura)
    assert.equal(salida.alma_afin_en_crisis, true, `falló con ${String(basura)}`)
  }
})

test('estaActivo trabaja sobre el jsonb crudo, no sobre algo ya saneado', () => {
  // Es la firma que evita el olvido: el llamante tiene la fila de Postgres.
  assert.equal(estaActivo({ te_ayudo: false }, 'te_ayudo'), false)
  assert.equal(estaActivo(null, 'te_escucharon'), true)
  assert.equal(estaActivo('{}', 'te_escucharon'), true)
  assert.equal(estaActivo({ respuesta_hilo: 'true' }, 'respuesta_hilo'), false)
})

test('revelar_alias se consulta sobre el EMISOR y por defecto es true', () => {
  assert.equal(revelaAlias({}), true)
  assert.equal(revelaAlias({ revelar_alias: false }), false)
  // Un valor no booleano no puede desactivarlo por accidente… ni activarlo.
  assert.equal(revelaAlias({ revelar_alias: 'no' }), true)
})

test('esTipoNotificacion rechaza lo que no está en la lista cerrada', () => {
  assert.equal(esTipoNotificacion('te_escucharon'), true)
  assert.equal(esTipoNotificacion('racha_diaria'), false)
  assert.equal(esTipoNotificacion(null), false)
  assert.equal(esTipoNotificacion('revelar_alias'), false, 'no es un tipo de aviso')
})
