import { filasEsqueleto } from './modelos.ts'
import estilos from './Cargando.module.css'

export interface CargandoProps {
  variante?: 'esqueleto' | 'texto'
  /** Solo para `'esqueleto'`: cuántas filas simular. */
  filas?: number
  /** Solo para `'texto'`. Por defecto «Cargando…». */
  etiqueta?: string
}

/**
 * Indicador de carga. Server Component.
 *
 * Dos modos, y la diferencia importa para el lector de pantalla:
 *  · `'esqueleto'` → bloques con la forma del contenido futuro. Van
 *    `aria-hidden`: no aportan NADA leídos («grupo, grupo, grupo») y además
 *    ensucian el anuncio del contenido real cuando llega.
 *  · `'texto'` → `role="status"` + `aria-live="polite"` con un texto de verdad.
 *    Es el que se usa cuando la espera es la única información que hay.
 *
 * Nunca los dos a la vez: dos regiones vivas compitiendo hacen que el lector
 * anuncie una y se coma la otra.
 */
export function Cargando({ variante = 'esqueleto', filas, etiqueta = 'Cargando…' }: CargandoProps) {
  if (variante === 'texto') {
    return (
      <p className={estilos.texto} role="status" aria-live="polite">
        <span className={estilos.punto} aria-hidden="true" />
        {etiqueta}
      </p>
    )
  }

  const total = filasEsqueleto(filas)

  return (
    <div className={estilos.esqueleto} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        // La última fila es más corta: imita un párrafo real. Un bloque de
        // rectángulos idénticos no se lee como texto que va a llegar.
        <span key={i} className={estilos.fila} data-corta={i === total - 1 ? '' : undefined} />
      ))}
    </div>
  )
}
