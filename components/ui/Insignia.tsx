import { clsx } from 'clsx'

import { simboloNivel } from './modelos.ts'
import type { Nivel } from './tokens.ts'
import estilos from './Insignia.module.css'

export interface InsigniaProps {
  nivel: Nivel
  /** Con etiqueta muestra «Guía»; sin ella, solo el símbolo + `aria-label`. */
  conEtiqueta?: boolean
}

/**
 * Distintivo de nivel. Server Component.
 *
 * Cada nivel tiene una FORMA distinta, no solo un color (semilla, brote, rombo,
 * estrella). No es decoración: entre el 8 % de los hombres hay daltonismo y el
 * nivel decide qué se puede hacer en la app —hostear un círculo, por ejemplo—.
 * El color nunca es el único portador de información (§Seguridad 5 de B16.md).
 *
 * Sin `conEtiqueta`, el nombre del nivel sigue estando en el árbol de
 * accesibilidad vía `aria-label`: se oculta a la vista, nunca al lector.
 */
export function Insignia({ nivel, conEtiqueta = false }: InsigniaProps) {
  const { d, etiqueta } = simboloNivel(nivel)

  return (
    <span
      className={clsx(estilos.insignia, conEtiqueta && estilos.conEtiqueta)}
      data-nivel={nivel}
      role="img"
      aria-label={`Nivel ${etiqueta}`}
    >
      <svg
        className={estilos.simbolo}
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={d}
          fill={nivel === 'brote' ? 'none' : 'currentColor'}
          stroke={nivel === 'brote' ? 'currentColor' : 'none'}
          strokeWidth={nivel === 'brote' ? 1.8 : undefined}
          strokeLinecap={nivel === 'brote' ? 'round' : undefined}
        />
      </svg>
      {conEtiqueta ? <span className={estilos.texto}>{etiqueta}</span> : null}
    </span>
  )
}
