// ============================================================================
// Esqueleto del hilo. Cuatro filas: la forma aproximada de un post y un par de
// respuestas, para que el contenido no dé un salto al llegar.
// ============================================================================

import { Cargando } from '@/components/ui'

export default function CargandoHilo() {
  return (
    <main>
      <Cargando variante="esqueleto" filas={4} etiqueta="Abriendo la conversación…" />
    </main>
  )
}
