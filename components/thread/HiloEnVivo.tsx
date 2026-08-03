'use client'

// ============================================================================
// HiloEnVivo — respuestas nuevas, sin que el texto salte bajo el dedo de nadie.
//
// ── POR QUÉ UN BANNER Y NO INSERTAR AUTOMÁTICAMENTE ────────────────────────
// Alguien está leyendo el desahogo de otra persona. Si el contenido se
// reordena solo, pierde la línea que estaba leyendo y a veces acaba pulsando
// algo que no quería. Es agresivo en cualquier app; aquí, encima, ocurre
// mientras se lee algo doloroso. Aparece un aviso, y solo se mueve si lo
// pulsan.
//
// ── POR QUÉ SE ESCUCHA `UPDATE` Y NO `INSERT` ──────────────────────────────
// Un comentario SIEMPRE nace con `is_validated = false` (0004 cerró el INSERT a
// `(post_id, author_id, body)`), así que suscribirse a INSERT haría que Realtime
// emitiera por el cable el cuerpo de todos los comentarios pendientes de validar
// de todo el mundo. Realtime aplica RLS por FILA, pero no recorta columnas ni
// conoce nuestra regla de producto, y la ficha prohíbe expresamente que salga
// «si otra persona tiene un comentario no validado».
//
// Lo que convierte un comentario en una escucha visible es justo el UPDATE que
// pone `is_validated = true`. Escuchar UPDATE es, literalmente, «ha llegado una
// respuesta nueva» — y no viaja nada que no fuera a verse igualmente.
//
// ── LA FUGA QUE HAY QUE EVITAR ─────────────────────────────────────────────
// La suscripción se cierra en el `return` del `useEffect`. Sin eso, cada
// navegación deja un WebSocket abierto y a los veinte hilos el navegador se
// queda sin conexiones y empieza a fallar en silencio.
// ============================================================================

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Boton } from '@/components/ui'
import estilos from './hilo.module.css'

export interface HiloEnVivoProps {
  postId: string
  /** Ids ya pintados: lo que llegue y esté aquí no cuenta como nuevo. */
  idsConocidos: readonly string[]
  /** Se llama cuando la persona decide ver lo nuevo. */
  alMostrar: () => void
}

interface FilaRealtime {
  id?: unknown
  is_validated?: unknown
  state?: unknown
}

export function HiloEnVivo({ postId, idsConocidos, alMostrar }: HiloEnVivoProps) {
  const [nuevos, setNuevos] = useState<string[]>([])

  useEffect(() => {
    const supabase = createClient()
    const canal = supabase
      .channel(`post:${postId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'comments',
          filter: `post_id=eq.${postId}`,
        },
        (evento) => {
          const fila = evento.new as FilaRealtime
          const id = typeof fila.id === 'string' ? fila.id : null
          // El mismo UPDATE dispara con `is_helpful` o con una edición: solo
          // cuenta como respuesta nueva lo que acaba de validarse y sigue vivo.
          if (!id || fila.is_validated !== true || fila.state !== 'active') return

          setNuevos((previos) =>
            previos.includes(id) || idsConocidos.includes(id) ? previos : [...previos, id],
          )
        },
      )
      .subscribe()

    return () => {
      // `removeChannel` cierra el canal y, si era el último, también el socket.
      void supabase.removeChannel(canal)
    }
    // `idsConocidos` se lee dentro del callback; incluirlo en las dependencias
    // recrearía la suscripción con cada página cargada, que es exactamente la
    // fuga que este componente evita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  if (nuevos.length === 0) return null

  return (
    <div className={estilos.banner}>
      <Boton
        variante="secundario"
        tamano="sm"
        onClick={() => {
          setNuevos([])
          alMostrar()
        }}
      >
        {nuevos.length === 1
          ? 'Hay 1 respuesta nueva'
          : `Hay ${nuevos.length} respuestas nuevas`}
      </Boton>
    </div>
  )
}
