import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { atributosBoton } from './modelos.ts'
import estilos from './Boton.module.css'

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro'
export type TamanoBoton = 'sm' | 'md' | 'lg'

/**
 * Props del botón.
 *
 * NOTA SOBRE EL `Omit`: además de `children` (que se redeclara obligatorio) se
 * quitan `style` y `dangerouslySetInnerHTML`. La ficha B16 exige las dos cosas
 * en su §Contrato («ningún componente acepta `style`», «ninguno acepta
 * `dangerouslySetInnerHTML`») y con `ButtonHTMLAttributes` entero ambas
 * llegarían heredadas de `HTMLAttributes`. Quitarlas del TIPO es lo que
 * convierte la regla en algo que el compilador hace cumplir: un bloque no puede
 * inyectar un color a mano ni renderizar HTML de un desahogo ajeno.
 * Ninguna prop del contrato cambia de nombre ni desaparece.
 */
export interface BotonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'children' | 'style' | 'dangerouslySetInnerHTML'
  > {
  children: ReactNode
  variante?: VarianteBoton
  tamano?: TamanoBoton
  /** Deshabilita y anuncia el estado; NO cambia el ancho del botón. */
  cargando?: boolean
  iconoInicio?: ReactNode
  bloque?: boolean
}

/**
 * Botón. Server Component: no envía un byte de JS.
 *
 * Decisiones que no son de estilo:
 *  · `type="button"` por defecto. Dentro de un `<form>`, el valor por defecto
 *    del navegador es `submit`, y un botón secundario que envía el formulario
 *    sin querer es el bug de formulario más común que existe.
 *  · `cargando` NO sustituye el texto por un spinner: el indicador se superpone
 *    y el texto se queda. Cambiar el contenido encoge el botón, empuja lo que
 *    hay debajo y a veces deja el puntero encima de OTRA acción.
 *  · Objetivo táctil de 44 px reales en los tres tamaños, incluido `sm`, que se
 *    ve más pequeño pero amplía su área con un `::before` (§Seguridad 6).
 */
export function Boton({
  children,
  variante = 'primario',
  tamano = 'md',
  cargando = false,
  iconoInicio,
  bloque = false,
  className,
  disabled,
  type,
  ...resto
}: BotonProps) {
  const estado = atributosBoton({ cargando, disabled })

  return (
    <button
      // twMerge FUSIONA la clase que llegue del bloque consumidor con las
      // nuestras; no la sustituye. Sustituirla dejaría botones sin altura
      // mínima ni foco visible en cuanto alguien pasara un `className`.
      className={twMerge(
        clsx(
          estilos.boton,
          estilos[variante],
          estilos[tamano],
          bloque && estilos.bloque,
          cargando && estilos.cargando,
        ),
        className,
      )}
      type={type ?? 'button'}
      {...estado}
      {...resto}
    >
      {iconoInicio ? (
        <span className={estilos.icono} aria-hidden="true">
          {iconoInicio}
        </span>
      ) : null}
      <span className={estilos.contenido}>{children}</span>
      {cargando ? <span className={estilos.indicador} aria-hidden="true" /> : null}
    </button>
  )
}
