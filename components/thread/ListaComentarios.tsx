'use client'

// ============================================================================
// ListaComentarios — el hilo, en orden cronológico ascendente.
//
// Ascendente porque una conversación de apoyo se lee de arriba abajo: quien
// llega quiere ver cómo empezó y cómo fue. (El feed va al revés; no es una
// incoherencia, son dos lecturas distintas.)
//
// Es cliente porque cuatro cosas cambian sin recargar: las páginas siguientes,
// la marca de «me ayudó» (que se TRASLADA, así que hay que quitarla de otra
// fila), las respuestas nuevas que anuncia `HiloEnVivo` y la propia respuesta
// recién escrita. La primera página llega ya renderizada desde el servidor, así
// que el hilo se ve sin esperar a este JS.
//
// El compositor vive DENTRO de este componente y no al lado por una razón
// concreta: quien acaba de escribir tiene que verse a sí mismo en el hilo al
// instante, aunque su comentario todavía no esté validado. Con dos componentes
// hermanos habría que levantar el estado a un tercero o releer el hilo entero
// por una fila que ya tenemos en la mano.
// ============================================================================

import { useCallback, useState } from 'react'
import { Boton, EstadoVacio } from '@/components/ui'
import type { ComentarioHilo, PaginaCursor } from '@/app/api/comments/tipos'
import { useTraductor } from '@/i18n/Proveedor'
import { Comentario } from './Comentario.tsx'
import { BotonUtil } from './BotonUtil.tsx'
import { HiloEnVivo } from './HiloEnVivo.tsx'
import { CompositorRespuesta } from './CompositorRespuesta.tsx'
import estilos from './hilo.module.css'

export interface ListaComentariosProps {
  postId: string
  /** Primera página, cargada en el servidor. */
  inicial: PaginaCursor<ComentarioHilo>
  /** ¿Quien mira escribió el post? Habilita «me ayudó». */
  soyAutorDelPost: boolean
  /** Falso en el post propio: acompañarse a uno mismo no es una escucha. */
  puedeResponder: boolean
}

interface SobreLista {
  ok: boolean
  data?: PaginaCursor<ComentarioHilo>
}

export function ListaComentarios({
  postId,
  inicial,
  soyAutorDelPost,
  puedeResponder,
}: ListaComentariosProps) {
  const t = useTraductor()
  const [items, setItems] = useState<ComentarioHilo[]>(inicial.items)
  const [cursor, setCursor] = useState<string | null>(inicial.siguienteCursor)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(
    async (desde: string | null, reemplazar: boolean) => {
      setCargando(true)
      try {
        const url = new URL('/api/comments', window.location.origin)
        url.searchParams.set('postId', postId)
        if (desde) url.searchParams.set('cursor', desde)

        const respuesta = await fetch(url, { cache: 'no-store' })
        const sobre = (await respuesta.json()) as SobreLista
        if (!sobre.ok || !sobre.data) return

        setItems((previos) => {
          const base = reemplazar ? [] : previos
          const vistos = new Set(base.map((c) => c.id))
          return [...base, ...sobre.data!.items.filter((c) => !vistos.has(c.id))]
        })
        setCursor(sobre.data.siguienteCursor)
      } catch {
        // Silencio deliberado: el hilo ya visible sigue ahí y el botón se puede
        // volver a pulsar. Un cartel de error sobre una conversación de apoyo
        // molesta más de lo que informa.
      } finally {
        setCargando(false)
      }
    },
    [postId],
  )

  /**
   * La marca es única por post y se traslada: al marcar una, se le quita a
   * cualquier otra. Se aplica también en local para no releer el hilo entero
   * por un booleano.
   */
  const marcar = useCallback((comentarioId: string) => {
    setItems((previos) =>
      previos.map((c) => ({ ...c, esUtil: c.id === comentarioId })),
    )
  }, [])

  /** La propia respuesta se pinta al momento, validada o no: quien acaba de
   *  escribir tiene que verse. Al resto del hilo no le llega hasta validarse. */
  const anadirPropio = useCallback((comentario: ComentarioHilo) => {
    setItems((previos) =>
      previos.some((c) => c.id === comentario.id) ? previos : [...previos, comentario],
    )
  }, [])

  const compositor = puedeResponder ? (
    <CompositorRespuesta postId={postId} alPublicar={(r) => anadirPropio(r.comentario)} />
  ) : null

  if (items.length === 0) {
    return (
      <div className={estilos.hilo}>
        <EstadoVacio
          titulo={t('hilo.sinRespuestas')}
          descripcion={
            puedeResponder ? t('hilo.primeraPersona') : t('hilo.cuandoTeEscriban')
          }
          tono="cuidado"
        />
        {compositor}
      </div>
    )
  }

  return (
    <div className={estilos.hilo}>
      <HiloEnVivo
        postId={postId}
        idsConocidos={items.map((c) => c.id)}
        // Recarga desde el principio: una respuesta nueva puede haberse
        // validado antes que otra ya pintada, y reordenar a mano el hilo por
        // fecha en el cliente es duplicar el keyset del servidor.
        alMostrar={() => void cargar(null, true)}
      />

      <ul className={estilos.lista}>
        {items.map((comentario) => (
          <li key={comentario.id}>
            <Comentario
              comentario={comentario}
              soyAutorDelPost={soyAutorDelPost}
              acciones={
                <BotonUtil
                  comentarioId={comentario.id}
                  marcado={comentario.esUtil}
                  alMarcar={marcar}
                />
              }
            />
          </li>
        ))}
      </ul>

      {cursor ? (
        <Boton
          variante="fantasma"
          cargando={cargando}
          onClick={() => void cargar(cursor, false)}
        >
          {t('hilo.verMas')}
        </Boton>
      ) : null}

      {compositor}
    </div>
  )
}
