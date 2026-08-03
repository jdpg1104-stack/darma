'use client'

// ============================================================================
// B13 · Botón de instalación de la PWA
//
// `beforeinstallprompt` solo lo dispara Chromium, solo si el manifiesto es
// válido, solo con service worker activo y solo si la app no está ya instalada.
// Como no hay forma fiable de saber de antemano si va a llegar, el botón NO se
// pinta hasta que llega: un botón «Instalar» que no hace nada es peor que no
// tener botón.
//
// En Safari el evento no existe y la instalación es «Compartir → Añadir a
// pantalla de inicio». Aquí no se pinta nada: unas instrucciones permanentes
// para un gesto del sistema operativo son ruido en todas las demás sesiones.
//
// El evento se guarda y se dispara con un GESTO del usuario, nunca al recibirlo.
// `prompt()` fuera de un gesto lo ignora el navegador, y encima gasta el evento.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import estilos from './pwa.module.css'

/** `BeforeInstallPromptEvent` no está en las libs de TypeScript (es una API
 *  no estandarizada de Chromium), así que se declara lo mínimo que se usa. */
interface EventoInstalacion extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface BotonInstalarProps {
  /** Texto alternativo del botón. */
  etiqueta?: string
}

export function BotonInstalar({ etiqueta }: BotonInstalarProps) {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null)

  useEffect(() => {
    const alRecibir = (e: Event) => {
      // Sin `preventDefault()` Chrome muestra su propia barra de instalación, y
      // entonces habría dos invitaciones a la vez diciendo lo mismo.
      e.preventDefault()
      setEvento(e as EventoInstalacion)
    }

    const alInstalar = () => setEvento(null)

    window.addEventListener('beforeinstallprompt', alRecibir)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alRecibir)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  const instalar = useCallback(async () => {
    if (!evento) return
    // El evento es de un solo uso: se limpia pase lo que pase, para que el
    // botón no quede pintado prometiendo algo que ya no puede hacer.
    setEvento(null)
    try {
      await evento.prompt()
      await evento.userChoice
    } catch {
      // El navegador puede rechazarlo si el gesto ya caducó. Sin ruido.
    }
  }, [evento])

  if (!evento) return null

  return (
    <button
      type="button"
      className={`${estilos.boton} ${estilos.secundario}`}
      onClick={() => void instalar()}
    >
      {etiqueta ?? 'Instalar Darma'}
    </button>
  )
}
