import type { ReactNode } from 'react'
import { clsx } from 'clsx'

import { mostrarIlustracion } from './modelos.ts'
import estilos from './EstadoVacio.module.css'

export interface EstadoVacioProps {
  titulo: string
  descripcion?: string
  /** `'cuidado'` para vacíos que duelen (sin respuestas, sin almas afines). */
  tono?: 'neutro' | 'cuidado'
  accion?: ReactNode
  /**
   * Ancla estable para el e2e (B18). Declarada a mano porque este componente
   * no hace spread de props: sin esto, un `data-testid` pasado desde fuera se
   * perdería en silencio. No cambia nada del render ni de la accesibilidad.
   */
  'data-testid'?: string
}

/**
 * Pantalla vacía. Server Component.
 *
 * EL TONO ES LA FUNCIONALIDAD, no el pulido. Nada de «¡Vaya, no hay nada aquí!
 * 😢». Quien llega a un vacío en Darma muchas veces llega desde un sitio malo:
 * ha publicado y nadie le ha respondido todavía.
 *
 * Por eso `tono='cuidado'` (a) quita la ilustración —un dibujo simpático junto
 * a «nadie ha respondido» lee como burla—, (b) baja el color y (c) espera un
 * copy sobrio de quien lo usa. El componente no puede escribir el texto por
 * ti, pero sí puede quitar todo lo que sobra alrededor.
 *
 * Recordatorio de copy (Trampa #5 de B16.md): aquí no se dice «crédito», ni
 * «puntos», ni «racha». Se dice «personas a las que has acompañado».
 */
export function EstadoVacio({
  titulo,
  descripcion,
  tono = 'neutro',
  accion,
  'data-testid': testId,
}: EstadoVacioProps) {
  const conIlustracion = mostrarIlustracion(tono)

  return (
    <div className={clsx(estilos.vacio, estilos[tono])} data-testid={testId}>
      {conIlustracion ? (
        // Tres círculos concéntricos incompletos: una forma abierta, sin cara y
        // sin emoción. Decorativa, luego aria-hidden.
        <svg
          className={estilos.ilustracion}
          viewBox="0 0 64 64"
          width="64"
          height="64"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 8" />
          <circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" />
          <circle cx="32" cy="32" r="4" fill="currentColor" />
        </svg>
      ) : null}

      <h2 className={estilos.titulo}>{titulo}</h2>
      {descripcion ? <p className={estilos.descripcion}>{descripcion}</p> : null}
      {accion ? <div className={estilos.accion}>{accion}</div> : null}
    </div>
  )
}
