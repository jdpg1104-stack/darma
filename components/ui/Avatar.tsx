import { clsx } from 'clsx'

import { LIENZO, dibujoAvatar, etiquetaAvatar } from './avatar.ts'
import type { Nivel } from './tokens.ts'
import estilos from './Avatar.module.css'

export type TamanoAvatar = 24 | 32 | 40 | 56 | 80

export interface AvatarProps {
  /** `profiles.avatar_seed`. Único origen del dibujo. NUNCA una URL. */
  semilla: string
  tamano?: TamanoAvatar
  /** Solo para el `aria-label` («Avatar de <alias>»). No se pinta. */
  alias?: string
  /** Aro de color del nivel. `null` = sin aro. */
  nivel?: Nivel | null
}

/**
 * Avatar generado, determinista y sin red. Server Component: el SVG se
 * serializa en el HTML del servidor, así que un feed de 20 tarjetas son 20
 * dibujos de ~350 bytes, cero peticiones y cero JS.
 *
 * NUNCA una foto ni un `<img src>`:
 *  · Una cara identifica, y Darma es anónima por diseño (CONTRATOS.md §2).
 *  · Un avatar de un tercero (dicebear, gravatar) le cuenta a ese tercero que
 *    esta persona estuvo en una app de salud emocional, cada vez que se pinta
 *    el feed. La CSP de `next.config.ts` lo bloquearía de todos modos:
 *    `img-src` admite `data:` y `blob:`, no hosts de avatares.
 *
 * El aro de nivel es un refuerzo, no información: el nivel se comunica con
 * `Insignia`, que tiene forma y texto. Un aro de color a solas sería el color
 * como único portador de información.
 */
export function Avatar({ semilla, tamano = 40, alias, nivel = null }: AvatarProps) {
  const dibujo = dibujoAvatar(semilla)
  const etiqueta = etiquetaAvatar(alias)

  return (
    <svg
      className={clsx(estilos.avatar, nivel && estilos.conAro)}
      data-nivel={nivel ?? undefined}
      width={tamano}
      height={tamano}
      viewBox={`0 0 ${LIENZO} ${LIENZO}`}
      // Sin alias no aporta nada al lector de pantalla: decirle «imagen» veinte
      // veces en un feed es ruido, no accesibilidad.
      role={etiqueta ? 'img' : undefined}
      aria-label={etiqueta ?? undefined}
      aria-hidden={etiqueta ? undefined : true}
      focusable="false"
    >
      {/* Sin clipPath a propósito: obligaría a un `id` y veinte ids repetidos en
          un feed son HTML inválido. Lo que se sale lo recorta el propio
          viewport del <svg>, y el redondeo lo pone el CSS del módulo. */}
      <g transform={dibujo.rotacion ? `rotate(${dibujo.rotacion} 12 12)` : undefined}>
        {dibujo.nodos.map((nodo, i) => {
          if (nodo.tipo === 'rect') {
            return (
              <rect
                key={i}
                x={nodo.x}
                y={nodo.y}
                width={nodo.ancho}
                height={nodo.alto}
                fill={nodo.relleno}
              />
            )
          }
          if (nodo.tipo === 'circulo') {
            return <circle key={i} cx={nodo.cx} cy={nodo.cy} r={nodo.r} fill={nodo.relleno} />
          }
          return <path key={i} d={nodo.d} fill={nodo.relleno} />
        })}
      </g>
    </svg>
  )
}
