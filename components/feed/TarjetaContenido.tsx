'use client'

// ============================================================================
// Contenido curado de bienestar.
//
// `'use client'` por el idioma, no por interactividad: la tarjeta la pinta
// también `ScrollInfinito`, que es de cliente, así que la duración legible tiene
// que salir del contexto de locale (`useTraductor`). Sin estado ni efectos.
//
// La miniatura va con `next/image`, y el motivo principal NO es el rendimiento:
// es el ANONIMATO. Con un `<img src="https://i.ytimg.com/…">` el navegador de la
// persona pide la imagen directamente a YouTube, y eso le cuenta a YouTube —con
// IP y user-agent— que este dispositivo está mirando contenido de salud mental,
// veinte veces por carga de feed. Con `next/image` la imagen la busca nuestro
// servidor y el tercero solo ve a nuestra infraestructura. Es exactamente el
// principio de «cero terceros en el navegador» de ARCHITECTURE §2.
//
// El optimizador solo acepta los hosts de `images.remotePatterns` de
// `next.config.ts` (i.ytimg.com y Supabase Storage), que son los mismos que
// confía la CSP en `img-src`: una url que no venga de la ingesta no carga.
//
// `loading="lazy"` (el valor por defecto de `next/image`): en una página de 20
// tarjetas, las miniaturas fuera de pantalla no deben competir por el LCP.
// ============================================================================

import Image from 'next/image'

import { Chip, Tarjeta } from '@/components/ui'
import type { ContenidoFeed } from '@/app/api/feed/tipos'
import type { Traductor } from '@/i18n'
import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Feed.module.css'

export interface TarjetaContenidoProps {
  contenido: ContenidoFeed
}

/** `null` cuando no hay duración (los vídeos del feed Atom no la traen). */
function duracionLegible(segundos: number | null, t: Traductor): string | null {
  if (segundos == null || segundos <= 0) return null
  const minutos = Math.round(segundos / 60)
  return minutos < 1 ? t('feed.duracionCorta') : t('feed.duracionMinutos', { n: minutos })
}

export function TarjetaContenido({ contenido }: TarjetaContenidoProps) {
  const t = useTraductor()
  const duracion = duracionLegible(contenido.duracionSegundos, t)

  return (
    <Tarjeta como="article" interactiva className={estilos.tarjeta}>
      <div className={estilos.contenido}>
        {contenido.miniatura ? (
          // Decorativa: el título ya está en el texto del enlace, y repetirlo en
          // el `alt` hace que el lector de pantalla lo anuncie dos veces.
          <Image className={estilos.miniatura} src={contenido.miniatura} alt="" width={96} height={54} />
        ) : null}

        <div>
          <h3 className={estilos.titulo}>
            {/* Enlace externo: `rel="noreferrer"` para no contarle a la
                plataforma desde qué página venía esta persona. En una app de
                salud emocional, el referer ES un dato sensible. */}
            <a href={contenido.url} target="_blank" rel="noreferrer" className={estilos.enlaceTitulo}>
              {contenido.titulo}
            </a>
          </h3>
          {contenido.resumen ? <p className={estilos.resumen}>{contenido.resumen}</p> : null}
          <p className={estilos.meta}>
            <Chip>{contenido.plataforma}</Chip>
            {duracion ? ` · ${duracion}` : null}
          </p>
        </div>
      </div>
    </Tarjeta>
  )
}
