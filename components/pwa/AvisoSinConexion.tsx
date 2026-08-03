'use client'

// ============================================================================
// B13 · Aviso de «sin conexión»
//
// ── LO QUE ESTE COMPONENTE NO HACE, Y ES LO IMPORTANTE ────────────────────
// NO encola publicaciones para enviarlas cuando vuelva la red. Suena a mejora
// obvia y es un problema de consentimiento: un desahogo escrito a las tres de
// la madrugada y publicado a las nueve, sin que su autor lo recuerde ni pueda
// arrepentirse, es contenido publicado sin permiso actual. Aquí el composer se
// deshabilita y se explica por qué. Perder un borrador es reparable; publicar
// algo que alguien ya no quería publicar, no.
//
// Lo que sí garantiza: `/ayuda` sigue accesible, porque está en el precache del
// service worker. Es la única razón por la que este banner lleva un enlace.
//
// Coste en cliente: dos listeners y un booleano. Es la hoja `'use client'` más
// pequeña que puede tener esta función.
// ============================================================================

import { useEffect, useState } from 'react'
import estilos from './pwa.module.css'

export interface AvisoSinConexionProps {
  /** Texto alternativo, por si una pantalla necesita matizar. */
  mensaje?: string
}

export function AvisoSinConexion({ mensaje }: AvisoSinConexionProps) {
  // Arranca en `false` y NO se inicializa con `navigator.onLine`: leerlo en el
  // primer render rompe la hidratación (el servidor no tiene `navigator`). El
  // efecto lo corrige en el mismo tick.
  const [sinConexion, setSinConexion] = useState(false)

  useEffect(() => {
    const sincronizar = () => setSinConexion(!navigator.onLine)
    sincronizar()

    window.addEventListener('online', sincronizar)
    window.addEventListener('offline', sincronizar)
    return () => {
      window.removeEventListener('online', sincronizar)
      window.removeEventListener('offline', sincronizar)
    }
  }, [])

  if (!sinConexion) return null

  return (
    // `polite` y no `assertive`: interrumpir a un lector de pantalla para decir
    // que no hay red es exactamente la clase de urgencia falsa que este bloque
    // evita.
    <div className={estilos.aviso} role="status" aria-live="polite">
      <span className={estilos.punto} aria-hidden="true" />
      <span>{mensaje ?? 'Sin conexión. Puedes leer lo que ya se había cargado.'}</span>
      <a className={estilos.enlaceAyuda} href="/ayuda">
        Ver ayuda
      </a>
    </div>
  )
}

/**
 * ¿Se puede escribir ahora mismo?
 *
 * Se exporta para que el composer (B03) deshabilite su botón con la MISMA
 * señal que pinta este banner, en vez de tener su propia idea de qué es estar
 * conectado. Devuelve `true` en el servidor: sin `navigator` no hay motivo para
 * bloquear nada.
 */
export function puedePublicar(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
