'use client'

// ============================================================================
// BotonSalir — cerrar sesión desde el perfil propio.
//
// No existía ningún componente que llamara a `POST /api/auth/salir` (la ruta
// estaba lista desde B01 y sin consumidor). Vive aquí y no en `components/auth`
// porque su única pantalla es el perfil propio, que es de este bloque.
//
// ── EL ORDEN ES EL CONTRATO ────────────────────────────────────────────────
//  1. `POST /api/auth/salir` — el cliente de Supabase borra la cookie.
//  2. `olvidarEsteDispositivo()` — borra de IndexedDB TODAS las claves E2E del
//     dispositivo (identidades y claves de refugio, de cualquier cuenta; el
//     porqué de «todas» está en su cabecera en `lib/crypto/almacen.ts`).
//     SIEMPRE antes de redirigir, y en el navegador, porque IndexedDB solo
//     existe allí: sin esto, la cookie muere pero la clave —que es lo que abre
//     las conversaciones— sigue viva en el aparato (pedido B10 → B01 en
//     HANDOFF/PEDIDOS.md).
//  3. `avisarCierreDeSesion()` — `postMessage({tipo:'darma:logout'})` al
//     service worker para que borre las cachés. SIEMPRE antes de redirigir:
//     compartir el móvil es lo normal en esta app, y sin este aviso el shell
//     cacheado de una cuenta sigue vivo cuando otra persona entra en el mismo
//     dispositivo (pedido B13 → B01 en HANDOFF/PEDIDOS.md).
//  4. Navegación DURA con `window.location.replace('/entrar')`, no
//     `router.push`: la recarga completa descarta todo el estado en memoria de
//     la sesión anterior (borradores en useState, canales Realtime, cachés del
//     cliente), y `replace` evita que «atrás» vuelva a pintar el shell con
//     datos de quien ya se fue.
//
// Un fallo del POST no bloquea la salida: si el token ya caducó, la persona ya
// está fuera, y las cachés se borran igual. Retenerla «hasta que el servidor
// confirme» sería lo contrario de lo que pide quien pulsa «Salir» en un móvil
// compartido. El mismo criterio vale para el paso 2: un IndexedDB roto o
// bloqueado no puede retener a nadie dentro de una sesión que quiere cerrar.
// ============================================================================

import { useState } from 'react'
import { Boton } from '@/components/ui'
import { avisarCierreDeSesion } from '@/components/pwa'
import { olvidarEsteDispositivo } from '@/lib/crypto/almacen'
import { useTraductor } from '@/i18n/Proveedor'

export function BotonSalir() {
  const t = useTraductor()
  const [ocupado, setOcupado] = useState(false)

  async function salir() {
    if (ocupado) return
    setOcupado(true)
    try {
      // POST y no GET: ver la cabecera de app/api/auth/salir/route.ts (CSRF).
      await fetch('/api/auth/salir', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // Sin red o sesión ya caducada: se sale igual. Ver la cabecera.
    }
    try {
      await olvidarEsteDispositivo()
    } catch {
      // IndexedDB roto o bloqueado: se sale igual. Mismo criterio que el POST
      // de arriba — un fallo de almacenamiento no puede bloquear la salida.
    }
    avisarCierreDeSesion()
    window.location.replace('/entrar')
    // Sin `setOcupado(false)`: la página entera se descarta con la navegación,
    // y reactivar el botón un instante invitaría a un segundo clic inútil.
  }

  return (
    <Boton
      variante="secundario"
      cargando={ocupado}
      onClick={() => void salir()}
      data-testid="perfil-boton-salir"
    >
      {t('auth.salir')}
    </Boton>
  )
}
