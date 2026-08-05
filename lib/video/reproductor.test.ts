// ============================================================================
// B07 · La barrera de `event.origin`.
//
// Caso 9 de la ficha, y es un CAMINO DE FALLO: un mensaje de otro origen no
// puede hacerse pasar por un «vídeo terminado» del reproductor. Sin esta
// comprobación, cualquier iframe de la página —o cualquier ventana que nos haya
// abierto— podría disparar la llamada a /completado.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESTADO, enviarComando, parsearMensaje, suscribirse } from './reproductor.ts'
import { ORIGEN_EMBED } from './embed.ts'

/** El único origen del que se aceptan mensajes. Espejo del `frame-src` de la
 *  CSP de next.config.ts. */
const ORIGEN_EMBED_ESPERADO = ORIGEN_EMBED

const FIN = JSON.stringify({ event: 'onStateChange', info: ESTADO.TERMINADO })

// ── 9 · FALLO ───────────────────────────────────────────────────────────────
test('un mensaje con origin de otro dominio se ignora', () => {
  assert.equal(parsearMensaje({ origin: 'https://evil.example', data: FIN }), null)
})

test('no vale un origen que solo CONTENGA el nuestro', () => {
  const impostores = [
    'https://www.youtube-nocookie.com.evil.example',
    'https://evil.example/https://www.youtube-nocookie.com',
    'http://www.youtube-nocookie.com',          // sin TLS
    'https://youtube-nocookie.com',             // sin www
    'https://www.youtube.com',                  // el dominio con cookies
    '',
    'null',
  ]

  for (const origin of impostores) {
    assert.equal(parsearMensaje({ origin, data: FIN }), null, `${origin} no puede pasar`)
  }
})

test('el mensaje legítimo sí se interpreta', () => {
  const mensaje = parsearMensaje({ origin: ORIGEN_EMBED_ESPERADO, data: FIN })
  assert.deepEqual(mensaje, { evento: 'onStateChange', estado: ESTADO.TERMINADO })
})

test('acepta el estado tanto en info como en info.playerState', () => {
  const directo = parsearMensaje({
    origin: ORIGEN_EMBED_ESPERADO,
    data: { event: 'onStateChange', info: ESTADO.REPRODUCIENDO },
  })
  assert.equal(directo?.estado, ESTADO.REPRODUCIENDO)

  const anidado = parsearMensaje({
    origin: ORIGEN_EMBED_ESPERADO,
    data: { event: 'infoDelivery', info: { playerState: ESTADO.PAUSADO } },
  })
  assert.equal(anidado?.estado, ESTADO.PAUSADO)
})

test('basura del origen correcto no lanza: devuelve null', () => {
  const basura: unknown[] = ['{no es json', null, 42, [], { event: 'otro' }, { sin: 'evento' }]
  for (const data of basura) {
    assert.equal(parsearMensaje({ origin: ORIGEN_EMBED_ESPERADO, data }), null)
  }
})

test('un estado desconocido no se inventa', () => {
  const mensaje = parsearMensaje({
    origin: ORIGEN_EMBED_ESPERADO,
    data: { event: 'onStateChange', info: 99 },
  })
  assert.deepEqual(mensaje, { evento: 'onStateChange', estado: null })
})

// ── Los comandos salen con origen DESTINO explícito ────────────────────────
test('enviarComando nunca usa el comodín "*" como origen destino', () => {
  const enviados: Array<[string, string]> = []
  const destino = {
    postMessage(mensaje: string, origen: string) {
      enviados.push([mensaje, origen])
    },
  }

  enviarComando(destino, 'playVideo')
  enviarComando(destino, 'unMute')
  suscribirse(destino, 'id-de-prueba')

  assert.equal(enviados.length, 3)
  for (const [, origen] of enviados) {
    assert.equal(origen, ORIGEN_EMBED_ESPERADO)
    assert.notEqual(origen, '*')
  }

  assert.deepEqual(JSON.parse(enviados[0][0]), { event: 'command', func: 'playVideo', args: [] })
  assert.equal(JSON.parse(enviados[2][0]).event, 'listening')
})

test('un destino ausente o sin postMessage no revienta', () => {
  assert.doesNotThrow(() => enviarComando(null, 'playVideo'))
  assert.doesNotThrow(() => enviarComando(undefined, 'pauseVideo'))
  assert.doesNotThrow(() => suscribirse(null, 'x'))
})

// ── El origen inyectado (stub e2e) no ablanda la barrera ────────────────────
// `origenPermitido` sustituye UN origen exacto por OTRO origen exacto: con el
// origen del stub inyectado, youtube-nocookie deja de pasar y viceversa. En
// ningún caso pasan dos a la vez.
test('con origen inyectado, SOLO ese origen pasa (ni siquiera el real)', () => {
  const origenStub = 'http://localhost:3018'

  const delStub = parsearMensaje({ origin: origenStub, data: FIN }, origenStub)
  assert.deepEqual(delStub, { evento: 'onStateChange', estado: ESTADO.TERMINADO })

  assert.equal(parsearMensaje({ origin: ORIGEN_EMBED_ESPERADO, data: FIN }, origenStub), null)
  assert.equal(parsearMensaje({ origin: 'https://evil.example', data: FIN }, origenStub), null)
  assert.equal(parsearMensaje({ origin: '', data: FIN }, origenStub), null)
})

test('sin origen inyectado, el del stub NO pasa: rige youtube-nocookie', () => {
  assert.equal(parsearMensaje({ origin: 'http://localhost:3018', data: FIN }), null)
  assert.equal(parsearMensaje({ origin: 'http://localhost:3000', data: FIN }), null)
})

test('los comandos salen hacia el origen inyectado cuando lo hay', () => {
  const enviados: Array<[string, string]> = []
  const destino = {
    postMessage(mensaje: string, origen: string) {
      enviados.push([mensaje, origen])
    },
  }

  enviarComando(destino, 'playVideo', 'http://localhost:3018')
  suscribirse(destino, 'id', 'http://localhost:3018')

  assert.deepEqual(enviados.map(([, o]) => o), ['http://localhost:3018', 'http://localhost:3018'])
})
