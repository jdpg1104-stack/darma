'use client'

import { usePathname } from 'next/navigation'

import estilos from './BotonCrisis.module.css'

export interface BotonCrisisProps {
  /** 'flotante' en los layouts de app/(app); 'inline' dentro de un formulario. */
  posicion?: 'flotante' | 'inline'
  /** Texto alternativo por idioma (B17 lo inyecta). Por defecto en español. */
  etiqueta?: string
}

/**
 * El acceso a los recursos de ayuda. No es un adorno de la interfaz: es la
 * pieza por la que Darma se toma en serio a sí misma, y por eso está en el
 * sistema de diseño y no en una pantalla concreta.
 *
 * Tres decisiones que parecen de estilo y no lo son:
 *
 * 1. **Es un `<a href="/ayuda">`, no un botón que abre un modal.** Si el bundle
 *    no ha hidratado, si el JS falla, si la conexión se cortó a mitad — el
 *    enlace sigue llevando a los teléfonos. Un modal depende de que todo haya
 *    ido bien, y el momento en que alguien pulsa esto es justo el momento en el
 *    que no puede permitirse que algo no vaya bien. `/ayuda` es pública en
 *    `proxy.ts` por la misma razón: nadie en riesgo debe toparse con un login.
 *
 * 2. **Sin animación de pulso y sin rojo de alarma como fondo.** Alarmar a
 *    quien ya está mal es contraproducente: se busca que esté SIEMPRE localizable,
 *    no que grite. Superficie `--panel`, borde e icono en `--danger`, texto en
 *    `--ink`. Nunca `--accent`, que está reservado a la acción primaria de cada
 *    pantalla — si el botón de crisis compitiera visualmente con «Publicar», se
 *    perdería justo cuando hace falta.
 *
 * 3. **Se oculta solo dentro de `/ayuda`.** Es la única razón por la que este
 *    componente es de cliente: un enlace a la página en la que ya estás es ruido
 *    y ocupa la esquina que necesita el contenido. Es el único uso de JS y la
 *    ausencia de JS no lo rompe (en el peor caso se ve el enlace de más).
 */
export function BotonCrisis({
  posicion = 'flotante',
  etiqueta = 'Necesito ayuda ahora',
}: BotonCrisisProps) {
  const ruta = usePathname()

  if (ruta?.startsWith('/ayuda')) return null

  return (
    <a
      href="/ayuda"
      aria-label={etiqueta}
      className={posicion === 'flotante' ? estilos.flotante : estilos.inline}
      data-posicion={posicion}
    >
      {/* aria-hidden: el nombre accesible ya lo da el aria-label del enlace.
          Sin esto, un lector de pantalla anuncia el icono y luego la etiqueta. */}
      <svg
        className={estilos.icono}
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
        <path d="M12 8v5" />
        <path d="M12 16.5h.01" />
      </svg>
      <span className={estilos.texto}>{etiqueta}</span>
    </a>
  )
}
