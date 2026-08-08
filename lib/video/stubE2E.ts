// ============================================================================
// B18 · Stub del reproductor para la suite E2E, con fusible anti-producción.
//
// ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
// El widget de youtube-nocookie NO responde en Chromium headless: acepta el
// handshake `{event:'listening'}` y no emite jamás `onReady` ni
// `onStateChange` (verificado con sondeos aislados fuera de la app: iframe
// directo, red con 200s, cero eventos en 15 s, también con channel:'chrome').
// Sin `onStateChange: REPRODUCIENDO` el flujo entero de acreditación de
// TarjetaVideo —latidos, /sesion, /latido, /completado— queda sin disparador y
// el recorrido (f) de e2e/specs/06-feed-video.spec.ts no puede correr.
//
// El stub es un documento `srcdoc` que habla EXACTAMENTE el protocolo del
// widget (listening → onReady; command playVideo/pauseVideo → onStateChange
// 1/2). `srcdoc` a propósito y no una ruta propia: no hay respuesta HTTP, así
// que ni `X-Frame-Options: DENY` ni `frame-ancestors 'none'` lo bloquean, no
// hay superficie nueva en producción y el documento hereda NUESTRO origen —
// con lo que la barrera de `parsearMensaje` (origen exacto + source ===
// contentWindow del iframe) se ejerce DE VERDAD, no se salta.
//
// ── EL FUSIBLE: DOS CERROJOS INDEPENDIENTES ────────────────────────────────
//  1. En BUILD: `process.env.NEXT_PUBLIC_E2E_STUB_PLAYER === '1'`. Next inlina
//     la variable al compilar; solo la declara el `webServer` de
//     playwright.config.ts. En cualquier build sin ella, la comparación queda
//     compilada a `false` y esta rama es código muerto.
//  2. En RUNTIME: `window.location.hostname` tiene que ser local. Aunque
//     alguien declarase la bandera en Vercel por error, el fusible sigue
//     cerrado para toda visita real.
// Los dos cerrojos los vigila scripts/security/guardStubReproductor.ts: la
// bandera solo puede leerse aquí, este módulo solo puede importarlo
// TarjetaVideo, y borrar cualquiera de los cerrojos pone el guard en rojo.
//
// Y aunque el fusible se abriera: `parsearMensaje` sigue exigiendo UN origen
// exacto (el propio) y que `source` sea el contentWindow de la tarjeta. Un
// iframe hostil de otro origen sigue sin poder fingir un «vídeo terminado»;
// quien ya ejecuta código en nuestro origen no necesita fingir nada.
// ============================================================================

/** Bandera inlinada en build. Literal a propósito: Next solo sustituye
 *  accesos con el nombre completo `process.env.NEXT_PUBLIC_…`. */
const BANDERA_STUB = process.env.NEXT_PUBLIC_E2E_STUB_PLAYER === '1'

/** ¿Es un hostname de desarrollo local? Lista CERRADA, comparación exacta:
 *  `endsWith('localhost')` dejaría pasar `evil-localhost`. */
export function esHostnameLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * El fusible, como función pura para poder probarlo sin navegador.
 * Abierto (true) = el stub puede activarse.
 */
export function fusibleStubAbierto(
  banderaActiva: boolean,
  hostname: string | null | undefined,
): boolean {
  if (!banderaActiva) return false
  if (!hostname) return false
  return esHostnameLocal(hostname)
}

/** ¿Debe esta pestaña usar el stub en lugar del widget real? */
export function stubReproductorActivo(): boolean {
  if (!BANDERA_STUB) return false
  if (typeof window === 'undefined') return false
  return fusibleStubAbierto(true, window.location.hostname)
}

/**
 * El doble del widget. Mismo protocolo que la IFrame API sobre postMessage:
 *
 *   padre → stub   {event:'listening', id, channel:'widget'}
 *   stub  → padre  {event:'onReady', info:null}
 *   padre → stub   {event:'command', func:'playVideo'|'pauseVideo'|…, args:[]}
 *   stub  → padre  {event:'onStateChange', info: 1|2}
 *
 * Igual que el widget real, NO emite nada antes del `listening`: así el spec
 * ejerce la suscripción de verdad y un fallo en `suscribirse()` sigue saliendo
 * rojo. Y el propio stub filtra por origen y por `source === parent` — es un
 * doble del widget, no una puerta abierta a cualquier mensaje.
 *
 * El script es inline: la CSP actual lleva 'unsafe-inline' en script-src (ver
 * next.config.ts). El día que se migre a nonce, este marcado tendrá que
 * moverse a un archivo servido con 'self' — el test del guard fallará antes,
 * porque el stub dejará de responder en la suite.
 */
export const MARCADO_STUB_REPRODUCTOR = `<!doctype html>
<html><head><meta charset="utf-8"><title>stub e2e del reproductor</title></head>
<body data-stub-reproductor-e2e>
<script>
(function () {
  'use strict'
  var escuchando = false
  function enviar(mensaje) {
    parent.postMessage(JSON.stringify(mensaje), window.origin)
  }
  window.addEventListener('message', function (evento) {
    if (evento.origin !== window.origin) return
    if (evento.source !== window.parent) return
    var datos
    try { datos = JSON.parse(evento.data) } catch (error) { return }
    if (!datos || typeof datos !== 'object') return
    if (datos.event === 'listening') {
      escuchando = true
      enviar({ event: 'onReady', info: null })
      return
    }
    if (!escuchando) return
    if (datos.event !== 'command') return
    if (datos.func === 'playVideo') enviar({ event: 'onStateChange', info: 1 })
    if (datos.func === 'pauseVideo') enviar({ event: 'onStateChange', info: 2 })
  })
})()
</script>
</body></html>`
