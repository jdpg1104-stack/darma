'use client'

// ============================================================================
// Scroll infinito. La única pieza de cliente grande del feed.
//
// ── SE DISPARA ANTES DE LLEGAR AL FINAL ────────────────────────────────────
// El centinela se coloca a la altura de unas 3 tarjetas del final
// (`rootMargin`), no al final. Si se dispara al llegar, la persona VE el hueco y
// la espera; disparando antes, la página siguiente suele estar montada cuando
// llega. Es la diferencia entre «infinito» y «a tirones».
//
// ── EL CURSOR SE GUARDA EN UNA REF, NO EN EL ESTADO ────────────────────────
// Si viviera en el estado, el callback del IntersectionObserver capturaría el
// valor del render en el que se creó y pediría dos veces la misma página en
// cuanto dos intersecciones se solaparan. La ref siempre tiene el último valor.
//
// ── UN SOLO VUELO A LA VEZ ─────────────────────────────────────────────────
// `cargandoRef` es un cerrojo síncrono. `useState` no sirve para esto: entre el
// `setCargando(true)` y el siguiente render caben dos intersecciones, y el
// resultado son tarjetas duplicadas — el mismo síntoma que produciría un OFFSET,
// que es justo lo que este feed existe para evitar.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Carril, ElementoFeed, PaginaFeed } from '@/app/api/feed/tipos'
import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Feed.module.css'
import { ListaFeed } from './ListaFeed'

export interface ScrollInfinitoProps {
  /** Cursor devuelto por la primera página, ya renderizada en el servidor. */
  cursorInicial: string | null
  carril: Carril
  limite?: number
}

/** Alto aproximado de tres tarjetas. Ver cabecera. */
const MARGEN_PREFETCH = '900px'

interface RespuestaFeed {
  ok: boolean
  data?: PaginaFeed
}

export function ScrollInfinito({ cursorInicial, carril, limite = 20 }: ScrollInfinitoProps) {
  const t = useTraductor()
  const [elementos, setElementos] = useState<ElementoFeed[]>([])
  const [error, setError] = useState(false)
  const [agotado, setAgotado] = useState(cursorInicial === null)

  const cursorRef = useRef<string | null>(cursorInicial)
  const cargandoRef = useRef(false)
  const centinelaRef = useRef<HTMLDivElement | null>(null)

  const cargarSiguiente = useCallback(async () => {
    if (cargandoRef.current || cursorRef.current === null) return
    cargandoRef.current = true
    setError(false)

    try {
      const parametros = new URLSearchParams({
        cursor: cursorRef.current,
        limite: String(limite),
        carril,
      })
      const respuesta = await fetch(`/api/feed?${parametros}`, { headers: { accept: 'application/json' } })
      if (!respuesta.ok) throw new Error('feed no disponible')

      const cuerpo = (await respuesta.json()) as RespuestaFeed
      if (!cuerpo.ok || !cuerpo.data) throw new Error('feed no disponible')

      setElementos((previos) => [...previos, ...cuerpo.data!.items])
      cursorRef.current = cuerpo.data.siguienteCursor
      if (cuerpo.data.siguienteCursor === null) setAgotado(true)
    } catch {
      // Sin detalle en pantalla: el mensaje de un fallo de red no ayuda a nadie
      // y el botón de reintentar sí. El detalle ya está en el log del servidor.
      setError(true)
    } finally {
      cargandoRef.current = false
    }
  }, [carril, limite])

  useEffect(() => {
    const centinela = centinelaRef.current
    if (!centinela || agotado) return

    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((entrada) => entrada.isIntersecting)) void cargarSiguiente()
      },
      { rootMargin: `0px 0px ${MARGEN_PREFETCH} 0px` },
    )

    observador.observe(centinela)
    return () => observador.disconnect()
  }, [cargarSiguiente, agotado])

  return (
    <>
      {elementos.length > 0 ? <ListaFeed elementos={elementos} /> : null}

      {/* Sin `aria-live`: anunciar «se han cargado 20 elementos más» cada vez que
          alguien scrollea convierte el lector de pantalla en ruido continuo. */}
      <div ref={centinelaRef} className={estilos.centinela} aria-hidden="true" />

      <p className={estilos.estadoScroll}>
        {error ? (
          <button type="button" className={estilos.reintentar} onClick={() => void cargarSiguiente()}>
            {t('feed.scrollError')}
          </button>
        ) : agotado ? (
          t('feed.finDeLista')
        ) : null}
      </p>
    </>
  )
}
