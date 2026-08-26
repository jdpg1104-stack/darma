// ============================================================================
// BotonHablarEnPrivado — pruebas sobre la fuente del puente perfil → refugio.
//
// Fuente, no runtime (mismo enfoque que ListaAlmasAfines.test.ts): lo que se
// vigila aquí es el ORDEN del ritual criptográfico y sus dos ramas de salida.
// Cambiar ese orden no rompe ningún tipo —todo son promesas encadenadas— pero
// sí rompe garantías: una clave guardada antes de crear la sala es la clave de
// un refugio fantasma, y una sala creada sin sobre es una conversación que la
// otra persona jamás podrá leer.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'BotonHablarEnPrivado.tsx'),
  'utf8',
)

test('es componente de cliente: la clave del refugio se genera en el navegador y no puede salir de él', () => {
  assert.match(fuente, /^'use client'/)
})

test('asegura la identidad ANTES de preparar los sobres: sin identidad no hay con qué envolver', () => {
  // Este es el camino del dispositivo sin identidad E2E: `asegurarIdentidad()`
  // la genera y publica si falta — el mismo camino que ya usan Hilo y
  // CrearCirculo — así que el botón nunca puede encontrarse «sin identidad».
  const posicionIdentidad = fuente.indexOf('asegurarIdentidad(miId)')
  const posicionSobres = fuente.indexOf('prepararSobresDeSalaNueva(identidad')
  assert.ok(posicionIdentidad > -1, 'llama a asegurarIdentidad')
  assert.ok(posicionSobres > posicionIdentidad, 'los sobres se preparan con la identidad ya asegurada')
})

test('sin sobre no hay sala: la rama sinClave corta antes de crearRefugio', () => {
  // No se puede cifrar para alguien cuya clave no existe; crear la sala igual
  // dejaría un refugio que la otra persona nunca podría leer.
  const posicionSinClave = fuente.indexOf('sobres.length === 0')
  const posicionCrear = fuente.indexOf('crearRefugio(')
  assert.ok(posicionSinClave > -1, 'la rama sin clave existe')
  assert.ok(posicionCrear > posicionSinClave, 'crearRefugio va después del corte')
  assert.match(fuente, /refugios\.privado\.sinClave/)
})

test('la clave se guarda DESPUÉS de crear la sala: nunca queda la llave de un refugio fantasma', () => {
  const posicionCrear = fuente.indexOf('crearRefugio(')
  const posicionGuardar = fuente.indexOf('guardarClaveRefugio(miId, refugeId')
  assert.ok(posicionGuardar > posicionCrear, 'guardar va después de crear')
})

test('al crearse la sala navega a /refugios/[id]', () => {
  assert.match(fuente, /router\.push\(`\/refugios\/\$\{refugeId\}`\)/)
})

test('el doble clic no abre dos salas: deshabilitado mientras crea', () => {
  assert.match(fuente, /disabled=\{estado === 'creando'\}/)
})

test('los errores se traducen por CÓDIGO, nunca pintando el message del servidor', () => {
  // `message` es diagnóstico en un solo idioma (cabecera de api.ts): el bloqueo
  // entre personas llega como código y `textoDeError()` lo pasa por catálogo.
  assert.match(fuente, /textoDeError\(/)
  assert.doesNotMatch(fuente, /\.message\b/)
})
