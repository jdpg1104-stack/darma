// ============================================================================
// Selector de carril. Server Component: dos enlaces, cero JS.
//
// Son `<a href>` y no botones con estado de cliente por una razón concreta: el
// carril tiene que estar en la URL. Así se puede compartir, recargar sin perder
// el sitio, y volver con el botón atrás del navegador. Un selector con estado
// local se pierde en cuanto la pestaña se recarga, y el feed es exactamente la
// pantalla que la gente deja abierta y vuelve a mirar.
//
// `aria-current="page"` y no solo un color: el carril activo tiene que estar en
// el árbol de accesibilidad. El estilo lo cuelga de ese atributo, así que no
// pueden desincronizarse.
// ============================================================================

import Link from 'next/link'

import type { Carril } from '@/app/api/feed/tipos'
import { obtenerTraductor, resolverLocale } from '@/i18n'

import estilos from './Feed.module.css'

export interface SelectorCarrilProps {
  activo: Carril
}

/** La etiqueta es una CLAVE del catálogo, no copy: el texto se resuelve al pintar. */
const OPCIONES: ReadonlyArray<{ carril: Carril; clave: string; href: string }> = [
  { carril: 'para_ti', clave: 'feed.paraTi', href: '/feed' },
  { carril: 'nuevo', clave: 'feed.recientes', href: '/feed?carril=nuevo' },
]

export async function SelectorCarril({ activo }: SelectorCarrilProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <nav className={estilos.carriles} aria-label={t('feed.carriles')} data-testid="feed-carriles">
      {OPCIONES.map((opcion) => (
        <Link
          key={opcion.carril}
          href={opcion.href}
          prefetch
          className={estilos.carril}
          aria-current={opcion.carril === activo ? 'page' : undefined}
        >
          {t(opcion.clave)}
        </Link>
      ))}
    </nav>
  )
}
