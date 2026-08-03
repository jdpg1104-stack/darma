'use client'

import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'

import { permitirCierre } from './modelos.ts'
import estilos from './Dialogo.module.css'

export interface DialogoProps {
  abierto: boolean
  /** Se invoca en Esc, click en el backdrop y botón de cierre. */
  alCerrar: () => void
  /** Obligatorio: es el `aria-labelledby` del diálogo. */
  titulo: string
  descripcion?: string
  children: ReactNode
  pie?: ReactNode
  /** Los diálogos de crisis no se pueden cerrar por accidente. */
  cierreAccidental?: boolean
}

/**
 * Diálogo modal sobre `<dialog>` nativo. Uno de los dos únicos componentes de
 * este bloque con `'use client'`.
 *
 * `showModal()` da gratis —y bien— lo que un modal a mano hace mal: atrapado de
 * foco, `Esc`, `::backdrop`, y el resto de la página marcada `inert` para el
 * ratón y para el lector de pantalla. No hay ninguna razón para escribir un
 * focus trap a mano en 2026, y sí muchas para no hacerlo: los caseros se saltan
 * con Shift+Tab desde el primer elemento, ignoran el contenido que aparece
 * después de abrir y dejan accesible el fondo para VoiceOver.
 *
 * Lo único que `<dialog>` no hace solo es DEVOLVER EL FOCO a quien lo abrió;
 * sin eso, al cerrar el foco se va al `<body>` y quien navega con teclado
 * aparece al principio de la página. Se guarda `document.activeElement` antes
 * de abrir y se restaura al cerrar.
 */
export function Dialogo({
  abierto,
  alCerrar,
  titulo,
  descripcion,
  children,
  pie,
  cierreAccidental = true,
}: DialogoProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const origenFoco = useRef<HTMLElement | null>(null)
  const idTitulo = useId()
  const idDescripcion = useId()

  useEffect(() => {
    const dialogo = ref.current
    if (!dialogo) return

    if (abierto && !dialogo.open) {
      origenFoco.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialogo.showModal()
      return
    }

    if (!abierto && dialogo.open) {
      dialogo.close()
      // `isConnected`: si quien abrió el diálogo ya no está en el DOM (una
      // tarjeta que se fue del feed mientras el diálogo estaba abierto),
      // enfocarlo lanza o no hace nada; mejor dejar el foco donde el navegador
      // lo ponga que provocar un error.
      if (origenFoco.current?.isConnected) origenFoco.current.focus()
      origenFoco.current = null
    }
  }, [abierto])

  // Desmontar con el diálogo abierto deja el <body> con el scroll bloqueado por
  // el modal nativo. Cerrar en la limpieza lo evita.
  useEffect(() => {
    const dialogo = ref.current
    return () => {
      if (dialogo?.open) dialogo.close()
    }
  }, [])

  /** `Esc`. El navegador lo dispara solo; aquí se decide si se le hace caso. */
  const alCancelar = (evento: SyntheticEvent<HTMLDialogElement>) => {
    if (!permitirCierre('esc', cierreAccidental)) {
      evento.preventDefault()
      return
    }
    evento.preventDefault() // el estado manda; cerrar es cosa del padre
    alCerrar()
  }

  /**
   * Click en el backdrop. El `::backdrop` no es un elemento con eventos
   * propios: los clicks fuera del panel llegan al propio `<dialog>`, así que
   * `evento.target === el diálogo` significa «has pinchado fuera».
   */
  const alPinchar = (evento: MouseEvent<HTMLDialogElement>) => {
    if (evento.target !== ref.current) return
    if (permitirCierre('backdrop', cierreAccidental)) alCerrar()
  }

  return (
    <dialog
      ref={ref}
      className={estilos.dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDescripcion : undefined}
      onCancel={alCancelar}
      onClick={alPinchar}
    >
      <div className={estilos.panel}>
        <header className={estilos.cabecera}>
          <h2 id={idTitulo} className={estilos.titulo}>
            {titulo}
          </h2>
          {/* El cierre explícito existe SIEMPRE, también con
              cierreAccidental=false: un diálogo del que no se puede salir es
              una trampa, y en una app de salud emocional, una trampa con la
              persona dentro. Lo que se impide es cerrarlo sin querer. */}
          <button type="button" className={estilos.cerrar} onClick={alCerrar} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </header>

        {descripcion ? (
          <p id={idDescripcion} className={estilos.descripcion}>
            {descripcion}
          </p>
        ) : null}

        <div className={estilos.cuerpo}>{children}</div>

        {pie ? <footer className={estilos.pie}>{pie}</footer> : null}
      </div>
    </dialog>
  )
}
