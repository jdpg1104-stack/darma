'use client'

// ============================================================================
// B07 · El scroll vertical.
//
// Recibe la PRIMERA página ya resuelta por el Server Component de `/animo` (una
// consulta, en el servidor, sin cascada de red en el cliente) y a partir de ahí
// pagina por keyset con el cursor opaco.
//
// ── LA VENTANA DE IFRAMES ──────────────────────────────────────────────────
// Solo tres tarjetas montan iframe: la activa y sus dos vecinas. Diez iframes
// de YouTube simultáneos son ~4 MB de JS de terceros; el presupuesto de
// CONTRATOS §11 son 120 KB por ruta y un LCP por debajo de 2,5 s en 4G. Las
// demás tarjetas son una miniatura de `i.ytimg.com`, que es exactamente lo que
// se vería igualmente mientras el reproductor carga.
//
// La ventana se calcula AQUÍ y no en cada tarjeta: es una propiedad de la lista
// (anterior, actual, siguiente), no de una tarjeta suelta.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ventanaDeIframes } from '@/lib/video/autoplay'
import type { ItemVideo, PaginaCursor, ResultadoCompletado } from '@/lib/video/tipos'
import { TarjetaVideo } from './TarjetaVideo'
import { useActivoDelFeed } from './useAutoplayEnVista'
import estilos from './FeedVertical.module.css'

export interface FeedVerticalProps {
  inicial: PaginaCursor<ItemVideo>
  idioma: string
}

type Envoltorio<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export function FeedVertical({ inicial, idioma }: FeedVerticalProps) {
  const [items, setItems] = useState<ItemVideo[]>(inicial.items)
  const [cursor, setCursor] = useState<string | null>(inicial.siguienteCursor)
  const [cargando, setCargando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const centinela = useRef<HTMLDivElement | null>(null)
  const activo = useActivoDelFeed()

  const orden = useMemo(() => items.map((i) => i.id), [items])
  const vivos = useMemo(() => ventanaDeIframes(orden, activo), [orden, activo])

  const cargarMas = useCallback(async () => {
    if (!cursor || cargando) return
    setCargando(true)
    try {
      const parametros = new URLSearchParams({ cursor, idioma, limite: '10' })
      const respuesta = await fetch(`/api/content/feed?${parametros.toString()}`)
      const json = (await respuesta.json()) as Envoltorio<PaginaCursor<ItemVideo>>

      if (!json.ok) {
        // El código es estable y traducible; el mensaje ya viene escrito para
        // una persona (CONTRATOS §4). No se compone otro aquí.
        setAviso(json.message)
        setCursor(null)
        return
      }

      // Se filtra por id: si dos páginas se solapan (el catálogo cambia
      // mientras se hace scroll), React se quejaría de claves duplicadas y la
      // tarjeta repetida volvería a pedir el +1 de algo ya completado.
      setItems((previos) => {
        const vistos = new Set(previos.map((i) => i.id))
        return [...previos, ...json.data.items.filter((i) => !vistos.has(i.id))]
      })
      setCursor(json.data.siguienteCursor)
    } catch {
      setAviso('No hemos podido cargar más vídeos. Comprueba tu conexión.')
    } finally {
      setCargando(false)
    }
  }, [cargando, cursor, idioma])

  useEffect(() => {
    const nodo = centinela.current
    if (!nodo || typeof IntersectionObserver === 'undefined') return

    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void cargarMas()
      },
      // 400 px de antelación: pedir la página siguiente cuando el centinela ya
      // está en pantalla llega tarde y el scroll se detiene en blanco.
      { rootMargin: '400px' },
    )

    observador.observe(nodo)
    return () => observador.disconnect()
  }, [cargarMas])

  function alCompletar(_item: ItemVideo, resultado: ResultadoCompletado) {
    if (resultado.motivo === 'tope_diario') {
      // Con `ok: true` a propósito: hoy ya llegó al máximo, y eso no es un
      // error suyo. El vídeo cuenta como visto igualmente.
      setAviso('Hoy ya has llegado al máximo de karma. El vídeo cuenta igual.')
    }
  }

  return (
    <div className={estilos.contenedor}>
      {items.map((item) => (
        <TarjetaVideo
          key={item.id}
          item={item}
          conIframe={vivos.has(item.id)}
          alCompletar={alCompletar}
        />
      ))}

      <div className={estilos.pie} ref={centinela} aria-live="polite">
        {aviso ?? (cargando ? 'Cargando más…' : cursor ? '' : 'Por hoy no hay más. Vuelve mañana.')}
      </div>
    </div>
  )
}
