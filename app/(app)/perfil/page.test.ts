// ============================================================================
// /perfil — pruebas del montaje de la capa PWA (B13) en el perfil propio.
//
// Fuente, no runtime (mismo enfoque que app/(app)/layout.test.ts): quitar
// `BotonInstalar` o `BotonSalir` de esta página no rompe ningún tipo ni ningún
// test de integración — simplemente la app deja de poderse instalar desde
// ningún sitio, o la sesión deja de poderse cerrar y las cachés del service
// worker sobreviven al cambio de persona en un móvil compartido.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

test('monta BotonInstalar: la instalación pertenece al perfil, no a un flotante global', () => {
  assert.match(fuente, /<BotonInstalar \/>/)
})

test('monta BotonSalir: sin él no hay forma de cerrar sesión ni de vaciar las cachés del SW', () => {
  assert.match(fuente, /<BotonSalir \/>/)
})

test('NO monta OptInPush: cargar el perfil no es un momento oportuno', () => {
  // La cabecera de components/pwa/OptInPush.tsx lo prohíbe fuera del momento en
  // que la notificación acaba de tener sentido: pedir permiso al abrir una
  // pantalla quema el origen de forma permanente si se deniega.
  assert.doesNotMatch(fuente, /<OptInPush\b/)
})

test('no importa la capa admin de push: eso jamás puede acabar en un bundle de navegador', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
})
