'use client'

// ============================================================================
// BotonApoyo — el apoyo al POST.
//
// ⚠️ UN APOYO NO DA KARMA Y NO CUENTA COMO ESCUCHA. ⚠️
//
// Escrito aquí tal cual, como en `app/api/comments/route.ts`, porque este es el
// otro sitio donde alguien podría «arreglarlo». En Darma el aplauso es barato:
// la moneda es la palabra escrita y validada. Un apoyo mueve
// `posts.upvote_count` —que sí pesa en el hot score del feed— y nada más: ni
// una fila en `karma_events`, ni un crédito de reciprocidad. Si algún día se da
// karma por likes, el sistema de reciprocidad entero deja de significar nada,
// porque farmear pasa a costar un clic. Si alguien lo pide, la respuesta es no.
//
// Y no existe apoyo sobre un COMENTARIO: la forma de reconocer una respuesta es
// «me ayudó», que la firma el autor del post y sí paga (+15). Un botón de like
// en cada comentario convertiría el hilo en una competición delante de alguien
// que está mal.
//
// El voto lo escribe B03 en `POST /api/posts/[id]/voto` (tabla `post_votes`,
// política `votes_write_own`). Aquí solo se llama. Anotado en PEDIDOS.md.
// ============================================================================

import { useState, useTransition } from 'react'
import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'

export interface BotonApoyoProps {
  postId: string
  apoyosIniciales: number
  yaApoyado?: boolean
}

export function BotonApoyo({ postId, apoyosIniciales, yaApoyado = false }: BotonApoyoProps) {
  const t = useTraductor()
  const [apoyos, setApoyos] = useState(apoyosIniciales)
  const [apoyado, setApoyado] = useState(yaApoyado)
  const [enCurso, iniciar] = useTransition()

  function alternar() {
    iniciar(async () => {
      // Optimista: el coste de equivocarse es un número que se corrige al
      // recargar. No hay economía detrás, así que no hay nada que cuadrar.
      const siguiente = !apoyado
      setApoyado(siguiente)
      setApoyos((n) => Math.max(0, n + (siguiente ? 1 : -1)))

      try {
        const respuesta = await fetch(`/api/posts/${postId}/voto`, {
          method: siguiente ? 'POST' : 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        if (!respuesta.ok) throw new Error(String(respuesta.status))
      } catch {
        setApoyado(!siguiente)
        setApoyos((n) => Math.max(0, n + (siguiente ? -1 : 1)))
      }
    })
  }

  return (
    <Boton
      variante="fantasma"
      tamano="sm"
      onClick={alternar}
      cargando={enCurso}
      aria-pressed={apoyado}
      aria-label={apoyado ? t('feed.quitarApoyo') : t('feed.apoyar')}
    >
      {t('hilo.apoyo', { n: apoyos })}
    </Boton>
  )
}
