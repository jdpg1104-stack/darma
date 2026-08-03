import type { ReactNode } from 'react'
import { clsx } from 'clsx'

import estilos from './Chip.module.css'

export interface ChipProps {
  children: ReactNode
  tono?: 'neutro' | 'logro' | 'aviso' | 'peligro'
  icono?: ReactNode
}

/**
 * Etiqueta corta de estado: «validado», «encuesta», «en pausa». Server
 * Component.
 *
 * El TEXTO siempre es `--ink` (≥14:1 en las dos superficies y los dos temas), y
 * el tono se comunica con el fondo teñido, el borde y el icono. La alternativa
 * (texto de color) obligaría a un color distinto por tema y por superficie para
 * no bajar de 4,5:1, y bastaría que alguien pusiera un chip sobre otro fondo
 * para romperlo.
 *
 * Y sobre todo: **el color nunca es el único portador de información**
 * (§Seguridad 5). Hay daltonismo entre el 8 % de los hombres, y en Darma el
 * estado «validado» decide si puedes publicar. Por eso `icono` existe y el
 * texto dice lo que pasa; el color solo lo refuerza.
 */
export function Chip({ children, tono = 'neutro', icono }: ChipProps) {
  return (
    <span className={clsx(estilos.chip, estilos[tono])}>
      {icono ? (
        <span className={estilos.icono} aria-hidden="true">
          {icono}
        </span>
      ) : null}
      {children}
    </span>
  )
}
