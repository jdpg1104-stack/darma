// ============================================================================
// Despachador de un elemento del feed a su tarjeta.
//
// Existe para que la página del servidor y el scroll infinito del cliente
// pinten EXACTAMENTE lo mismo. Sin él habría dos árboles de render que se
// parecen: el día que uno añada un campo y el otro no, la tarjeta 20 y la 21 se
// verían distintas y nadie sabría por qué.
//
// El `switch` sobre `tipo` no lleva `default`: con `ElementoFeed` como unión
// discriminada, añadir un cuarto tipo sin tocar este archivo es un error de
// compilación (`nunca` deja de ser `never`). Un `default: return null` haría que
// el elemento nuevo desapareciera del feed en silencio.
// ============================================================================

import type { ElementoFeed } from '@/app/api/feed/tipos'

import { SlotEncuesta } from './SlotEncuesta'
import { TarjetaContenido } from './TarjetaContenido'
import { TarjetaPost } from './TarjetaPost'

export interface ElementoTarjetaProps {
  elemento: ElementoFeed
}

export function ElementoTarjeta({ elemento }: ElementoTarjetaProps) {
  switch (elemento.tipo) {
    case 'post':
      return <TarjetaPost post={elemento.post} />
    case 'contenido':
      return <TarjetaContenido contenido={elemento.contenido} />
    case 'encuesta':
      return <SlotEncuesta encuestaId={elemento.encuestaId} />
  }
}

/** Clave estable de React para un elemento. El tipo entra en la clave porque un
 *  post y una encuesta pueden compartir uuid (`polls.post_id`). */
export function claveDe(elemento: ElementoFeed): string {
  switch (elemento.tipo) {
    case 'post':
      return `post:${elemento.post.id}`
    case 'contenido':
      return `contenido:${elemento.contenido.id}`
    case 'encuesta':
      return `encuesta:${elemento.encuestaId}`
  }
}
