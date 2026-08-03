'use client'

// ============================================================================
// B13 · Registro del service worker
//
// Alguien tiene que llamar a `navigator.serviceWorker.register('/sw.js')`, y
// ese alguien no puede ser `OptInPush`: el service worker sirve para MÁS cosas
// que las notificaciones —el precache de `/ayuda`, que tiene que funcionar sin
// red para quien esté en riesgo— y debe registrarse aunque la persona no quiera
// avisos y aunque no haya llaves VAPID.
//
// Se monta una sola vez, en un layout de `app/(app)` (dueño de ese archivo: F4;
// petición anotada en HANDOFF/PEDIDOS.md). Es un componente y no un `<script>`
// porque la CSP de `next.config.ts` es estricta y no queremos tocarla: un
// componente de React entra por el bundle propio, del mismo origen, y no
// necesita ninguna excepción de `script-src`.
//
// Renderiza `null`. Su coste en cliente es un `useEffect` y una llamada.
// ============================================================================

import { useEffect } from 'react'

export function RegistroServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Tras `load` a propósito: registrar durante la carga inicial compite por
    // ancho de banda con el JS que la persona sí está esperando, y el service
    // worker no sirve para nada en esa primera visita.
    const registrar = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Contexto no seguro (http://) o SW deshabilitado por política del
        // navegador. La app funciona igual, solo sin caché ni push.
      })
    }

    if (document.readyState === 'complete') {
      registrar()
      return
    }

    window.addEventListener('load', registrar)
    return () => window.removeEventListener('load', registrar)
  }, [])

  return null
}

/**
 * Avisa al service worker de que se ha cerrado la sesión para que borre las
 * cachés.
 *
 * B01 debe llamarla en el logout (pedido anotado en HANDOFF/PEDIDOS.md). Sin
 * esto, el shell cacheado de una cuenta sigue vivo cuando otra persona entra en
 * el mismo dispositivo — y en una app de apoyo emocional compartir el móvil es
 * lo normal, no la excepción.
 */
export function avisarCierreDeSesion(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.controller?.postMessage({ tipo: 'darma:logout' })
}
