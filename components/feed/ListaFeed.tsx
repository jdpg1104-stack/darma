// ============================================================================
// La columna del feed. Server Component.
//
// `<ol>` y no `<div>`: el feed es una secuencia ORDENADA, y ese orden es
// información (lo dice el ranking). Un lector de pantalla anuncia «lista de 20
// elementos, elemento 3 de 20», que es exactamente la orientación que se pierde
// con un montón de divs.
// ============================================================================

import type { ElementoFeed } from '@/app/api/feed/tipos'

import { ElementoTarjeta, claveDe } from './ElementoTarjeta'
import estilos from './Feed.module.css'

export interface ListaFeedProps {
  elementos: ElementoFeed[]
}

export function ListaFeed({ elementos }: ListaFeedProps) {
  return (
    <ol className={estilos.lista}>
      {elementos.map((elemento) => (
        <li key={claveDe(elemento)}>
          <ElementoTarjeta elemento={elemento} />
        </li>
      ))}
    </ol>
  )
}
