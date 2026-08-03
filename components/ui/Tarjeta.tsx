import type { HTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import estilos from './Tarjeta.module.css'

/**
 * Props de la tarjeta.
 *
 * Igual que en `Boton`, el `Omit` quita `style` y `dangerouslySetInnerHTML`
 * además de `children`: son las dos prohibiciones del §Contrato de B16.md y el
 * tipo es el único sitio donde se pueden hacer cumplir de verdad.
 */
export interface TarjetaProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style' | 'dangerouslySetInnerHTML'> {
  children: ReactNode
  /** `'article'` para contenido de una persona; `'section'` para agrupaciones. */
  como?: 'article' | 'section' | 'div'
  /**
   * Realce sutil del borde izquierdo.
   *
   * ⚠️ `'crisis'` NO es una tarjeta roja de alarma, y esto no es negociable
   * (CONTRATOS.md §9): un post de riesgo alto se **prioriza, no se señaliza
   * como peligroso**. Pintarlo de rojo estigmatiza a quien lo escribió delante
   * de toda la comunidad y convierte a una persona que está mal en una alerta
   * del sistema. Por eso `'crisis'` es un borde de `--accent2` (el verde de la
   * calma), y en la práctica solo se usa en dos sitios: el panel de moderación
   * (B11) y la tarjeta de recursos de ayuda que ve **el propio autor**.
   * Si estás a punto de usarlo en un feed público, no es este componente.
   */
  acento?: 'ninguno' | 'logro' | 'crisis'
  /** Añade hover/focus-within. NO añade `onClick`: la acción va dentro. */
  interactiva?: boolean
}

/**
 * Superficie base de contenido. Server Component.
 *
 * `interactiva` solo cambia el aspecto al pasar por encima o al enfocar algo de
 * dentro. Deliberadamente no acepta `onClick`: un `<div onClick>` no es
 * enfocable, no responde a Enter y no lo anuncia ningún lector de pantalla. Si
 * la tarjeta entera lleva a un sitio, dentro va un `<a>` que ocupa el área
 * (`::after` con `inset: 0`), y así el teclado y el clic derecho funcionan.
 */
export function Tarjeta({
  children,
  como = 'div',
  acento = 'ninguno',
  interactiva = false,
  className,
  ...resto
}: TarjetaProps) {
  const Elemento = como

  return (
    <Elemento
      className={twMerge(
        clsx(
          estilos.tarjeta,
          acento !== 'ninguno' && estilos[acento],
          interactiva && estilos.interactiva,
        ),
        className,
      )}
      {...resto}
    >
      {children}
    </Elemento>
  )
}
