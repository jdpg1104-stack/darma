// ============================================================================
// ListaAlmasAfines — pruebas del montaje del opt-in de push (B13).
//
// Fuente, no runtime (mismo enfoque que app/(app)/layout.test.ts): quitar este
// montaje no rompe nada visible, solo deja los avisos de Alma Afín sin vía de
// activación; y moverlo a la rama vacía pediría permiso de notificaciones a
// alguien que aún no guardó a nadie — en el vacío, con la denegación de Chrome
// como coste permanente (cabecera de components/pwa/OptInPush.tsx).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ListaAlmasAfines.tsx'),
  'utf8',
)

test('monta OptInPush con el momento correcto: primera_alma_afin', () => {
  assert.match(fuente, /<OptInPush momento="primera_alma_afin" \/>/)
})

test('el opt-in va DESPUÉS del retorno temprano de la lista vacía', () => {
  // El `return` con `<EstadoVacio` corta antes: sin ningún Alma Afín guardada,
  // «avisarte si un Alma Afín necesita hablar» no significa nada todavía.
  // Se busca el USO en JSX (`<EstadoVacio`), no el import de la cabecera.
  const posicionVacio = fuente.indexOf('<EstadoVacio')
  const posicionOptIn = fuente.indexOf('<OptInPush')
  assert.ok(posicionVacio > -1, 'la rama vacía existe')
  assert.ok(posicionOptIn > posicionVacio, 'el opt-in se pinta solo con la lista poblada')
})

test('no importa la capa admin de push: eso jamás puede acabar en un bundle de navegador', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
})
