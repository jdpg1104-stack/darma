'use client'

// ============================================================================
// El único trozo de JS de una tarjeta de post.
//
// UI optimista: el `+1` se pinta ANTES de que responda el servidor y se revierte
// si falla. No es un truco de percepción — en una lista de 20 tarjetas, esperar
// el round-trip antes de pintar hace que la gente pulse dos veces, y el segundo
// clic quita el voto que el primero acababa de poner.
//
// La reversión es al valor EXACTO que había antes, no un `-1`: si mientras tanto
// llegó otro render con un contador distinto, restar uno dejaría el número mal
// para siempre.
//
// ⚠️ DEPENDENCIA PENDIENTE: `POST /api/posts/:id/voto` es de B03 y todavía no
// existe. Mientras no exista, el fetch devuelve 404, el componente revierte y la
// tarjeta se queda como estaba: se degrada a «no se pudo votar», nunca a un
// contador que miente. Anotado en HANDOFF/PEDIDOS.md.
// ============================================================================

import { useState, useTransition } from 'react'

import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Feed.module.css'

export interface BotonVotoProps {
  postId: string
  upvotesIniciales: number
  heVotadoInicial: boolean
}

export function BotonVoto({ postId, upvotesIniciales, heVotadoInicial }: BotonVotoProps) {
  const t = useTraductor()
  const [votado, setVotado] = useState(heVotadoInicial)
  const [upvotes, setUpvotes] = useState(upvotesIniciales)
  const [enCurso, empezar] = useTransition()

  function alternar() {
    const votadoPrevio = votado
    const upvotesPrevios = upvotes

    // Optimista: primero se pinta.
    setVotado(!votadoPrevio)
    setUpvotes(upvotesPrevios + (votadoPrevio ? -1 : 1))

    empezar(async () => {
      try {
        const respuesta = await fetch(`/api/posts/${postId}/voto`, {
          method: votadoPrevio ? 'DELETE' : 'POST',
          headers: { accept: 'application/json' },
        })
        if (!respuesta.ok) throw new Error('voto rechazado')
      } catch {
        // Vuelta al estado exacto anterior. Sin mensaje de error: un aviso por
        // un voto fallido interrumpe la lectura más de lo que aporta, y el
        // botón vuelto a su sitio ya comunica que no se guardó.
        setVotado(votadoPrevio)
        setUpvotes(upvotesPrevios)
      }
    })
  }

  return (
    <button
      type="button"
      className={estilos.voto}
      // `aria-pressed` y no un cambio de color: el estado del botón tiene que
      // estar en el árbol de accesibilidad, no solo en la paleta.
      aria-pressed={votado}
      aria-label={votado ? t('feed.quitarApoyo') : t('feed.apoyar')}
      disabled={enCurso}
      onClick={alternar}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 21s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12c-1.8 4.4-9.3 9-9.3 9Z"
          fill={votado ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      {upvotes}
    </button>
  )
}
