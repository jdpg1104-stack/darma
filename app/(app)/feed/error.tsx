'use client'

// ============================================================================
// Límite de error de /feed.
//
// DOS REGLAS:
//
// 1. **No se pinta `error.message`.** Un error que llega hasta aquí puede
//    arrastrar el mensaje de Postgres, y ese mensaje filtra nombres de tabla, de
//    columna y de restricción — `uq_comments_one_listen_per_post` le cuenta a
//    quien lo lea la mecánica antifarmeo entera, gratis. Lo que se muestra es
//    `digest`, el identificador que Next genera y que se puede cruzar con el log
//    del servidor.
//
// 2. **El acceso a ayuda sobrevive al error.** El botón de crisis vive en el
//    layout, y un `error.tsx` de ruta no sustituye al layout: si el feed se cae,
//    quien estaba mirándolo sigue teniendo a un clic los recursos de ayuda. Esa
//    es justo la razón por la que `BotonCrisis` está en el layout y no en la
//    página.
// ============================================================================

import { useEffect } from 'react'

import estilos from '@/components/feed/Feed.module.css'
import { useTraductor } from '@/i18n/Proveedor'

export default function ErrorFeed({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTraductor()

  useEffect(() => {
    // A la consola del navegador, no a la pantalla. `console.error` está
    // permitido por el eslint del repo justamente para esto.
    console.error('[darma][feed] error de renderizado', error.digest ?? '(sin digest)')
  }, [error])

  return (
    <section role="alert" className={estilos.estadoScroll}>
      <h1>{t('feed.error.titulo')}</h1>
      <p>{t('feed.error.descripcion')}</p>
      <button type="button" className={estilos.reintentar} onClick={reset}>
        {t('comun.reintentar')}
      </button>
      {error.digest ? <p>{t('feed.error.referencia', { digest: error.digest })}</p> : null}
    </section>
  )
}
