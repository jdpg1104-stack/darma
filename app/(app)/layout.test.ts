// ============================================================================
// Layout de `app/(app)` — pruebas del montaje global.
//
// Este layout existe para dar garantías ESTRUCTURALES (botón de crisis y capa
// PWA en toda pantalla con sesión), y su modo de fallo es silencioso: quitar
// un componente de aquí no rompe ningún tipo ni ningún test de runtime —
// simplemente `/ayuda` deja de funcionar sin red, o una pantalla nueva se queda
// sin botón de crisis. Exactamente así estuvo la app durante semanas: los
// componentes de `components/pwa` completos y sin montar. Estas pruebas leen la
// fuente (mismo enfoque que el guard de `i18n/validacion.ts`) para que esa
// regresión deje de ser invisible.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { AVISO_NO_TERAPIA } from '../../lib/privacy/avisos.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'layout.tsx'), 'utf8')

test('monta BotonCrisis: CONTRATOS §9, en todas las pantallas', () => {
  assert.match(fuente, /<BotonCrisis\b/)
})

test('monta RegistroServiceWorker: sin él, /ayuda no funciona sin red', () => {
  assert.match(fuente, /<RegistroServiceWorker\b/)
})

test('monta AvisoSinConexion: el banner global de sin conexión', () => {
  assert.match(fuente, /<AvisoSinConexion\b/)
})

test('pinta el aviso permanente de no-terapia desde el catálogo (pedido B20 → B16/F4)', () => {
  // Un `<footer>` con la clave del catálogo, no el literal español: el layout
  // se sirve en los dos idiomas.
  assert.match(fuente, /<footer\b/)
  assert.match(fuente, /legal\.avisoNoTerapia/)
})

test('la clave española del catálogo es palabra por palabra AVISO_NO_TERAPIA', () => {
  // `lib/privacy/avisos.ts` es el único dueño de la redacción (su cabecera
  // explica por qué): si un abogado la cambia allí, esta prueba obliga a
  // actualizar el catálogo en vez de dejar dos versiones vivas.
  const catalogo = JSON.parse(readFileSync(join(raiz, 'messages', 'es.json'), 'utf8')) as {
    legal?: { avisoNoTerapia?: string }
  }
  assert.equal(catalogo.legal?.avisoNoTerapia, AVISO_NO_TERAPIA)
})

test('NO monta OptInPush: pedir permiso al cargar quema el origen para siempre', () => {
  // La cabecera de components/pwa/OptInPush.tsx lo prohíbe en layouts: la
  // denegación de Chrome es permanente para el origen. Se monta en el momento
  // oportuno del flujo, nunca aquí.
  assert.doesNotMatch(fuente, /<OptInPush\b/)
})

test('no importa la capa admin de push: eso jamás puede acabar en un bundle de navegador', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
})
