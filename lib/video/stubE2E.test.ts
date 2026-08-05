// ============================================================================
// B18 · El fusible del stub del reproductor.
//
// El stub sustituye al widget de YouTube SOLO en la suite E2E. Estas pruebas
// afirman el fusible por los dos lados: que abre exactamente cuando debe
// (bandera + hostname local) y, sobre todo, que NO abre en ninguna otra
// combinación — porque un stub activo en producción significaría un feed de
// vídeo que finge reproducir sin reproducir nada.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARCADO_STUB_REPRODUCTOR,
  esHostnameLocal,
  fusibleStubAbierto,
  stubReproductorActivo,
} from './stubE2E.ts'

// ── El fusible cierra sin bandera, esté donde esté ──────────────────────────
test('sin bandera el fusible está cerrado, incluso en localhost', () => {
  assert.equal(fusibleStubAbierto(false, 'localhost'), false)
  assert.equal(fusibleStubAbierto(false, '127.0.0.1'), false)
  assert.equal(fusibleStubAbierto(false, 'darma.example'), false)
})

// ── Con bandera, solo hostnames locales EXACTOS ─────────────────────────────
test('con bandera solo abre en un hostname local exacto', () => {
  assert.equal(fusibleStubAbierto(true, 'localhost'), true)
  assert.equal(fusibleStubAbierto(true, '127.0.0.1'), true)
  assert.equal(fusibleStubAbierto(true, '[::1]'), true)
})

test('un hostname que solo CONTENGA localhost no pasa', () => {
  const impostores = [
    'darma.example',
    'localhost.evil.example', // prefijo
    'evil-localhost',         // sufijo
    'www.localhost',          // subdominio
    '127.0.0.1.evil.example',
    '192.168.1.10',           // LAN no es local: otra máquina la alcanza
    '',
  ]
  for (const hostname of impostores) {
    assert.equal(fusibleStubAbierto(true, hostname), false, `${hostname} no puede abrir el fusible`)
    assert.equal(esHostnameLocal(hostname), false)
  }
})

test('sin hostname (null, undefined) el fusible está cerrado', () => {
  assert.equal(fusibleStubAbierto(true, null), false)
  assert.equal(fusibleStubAbierto(true, undefined), false)
})

// ── El envoltorio real, en este proceso ─────────────────────────────────────
test('fuera de un navegador el stub nunca se activa', () => {
  // En node no hay `window`; y en este proceso de test la bandera de build no
  // está inlinada a '1'. Cualquiera de los dos cerrojos basta.
  assert.equal(stubReproductorActivo(), false)
})

// ── El marcado del doble conserva sus propias barreras ──────────────────────
test('el stub filtra por origen y por source, y exige el handshake', () => {
  // Aserciones de PRESENCIA sobre el script inline: el protocolo completo se
  // ejerce en e2e (spec 06); aquí solo se impide que una edición despistada
  // borre una de las tres barreras del doble.
  assert.match(MARCADO_STUB_REPRODUCTOR, /evento\.origin !== window\.origin/)
  assert.match(MARCADO_STUB_REPRODUCTOR, /evento\.source !== window\.parent/)
  assert.match(MARCADO_STUB_REPRODUCTOR, /if \(!escuchando\) return/)
})

test('el stub responde el protocolo del widget, no otro', () => {
  assert.match(MARCADO_STUB_REPRODUCTOR, /'listening'/)
  assert.match(MARCADO_STUB_REPRODUCTOR, /onReady/)
  assert.match(MARCADO_STUB_REPRODUCTOR, /onStateChange/)
  // Nunca con el comodín: el destino del postMessage es el origen heredado.
  assert.doesNotMatch(MARCADO_STUB_REPRODUCTOR, /postMessage\([^)]*'\*'/)
})
