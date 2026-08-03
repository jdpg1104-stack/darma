// ============================================================================
// /feed — la pantalla principal de Darma. Server Component con streaming.
//
// ── LA PRIMERA PÁGINA NO PASA POR /api/feed ────────────────────────────────
// Se consulta directamente con el cliente RLS. Ir a la propia API desde el
// servidor añadiría un salto HTTP completo (DNS, TLS, cabeceras, serialización)
// dentro del render, y eso se paga entero en el LCP de la pantalla que más veces
// se carga de la app. La ruta de API existe para el scroll, que sí viene del
// navegador.
//
// ── STREAMING ──────────────────────────────────────────────────────────────
// El selector de carril se envía de inmediato y la lista llega dentro de un
// `<Suspense>`. Así el HTML empieza a pintarse sin esperar a Postgres: la
// persona ve la estructura de la pantalla mientras se resuelve la consulta, en
// vez de una página en blanco.
//
// ── force-dynamic / revalidate = 0 NO SON AJUSTES DE RENDIMIENTO ───────────
// El feed depende de `auth.uid()` a través de RLS. Cacheado en el CDN, la
// primera respuesta se le sirve a la siguiente persona: es el feed de alguien
// servido a otro. En una app anónima eso no es una optimización agresiva, es una
// fuga de datos.
// ============================================================================

import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { consultarFeed } from '@/app/api/feed/consulta'
import { CURSOR_VACIO } from '@/app/api/feed/cursor'
import type { Carril } from '@/app/api/feed/tipos'
import { esCarril, idiomaDeContenido, LIMITE_POR_DEFECTO } from '@/app/api/feed/validacion'
import { FeedVacio } from '@/components/feed/FeedVacio'
import { ListaFeed } from '@/components/feed/ListaFeed'
import { ScrollInfinito } from '@/components/feed/ScrollInfinito'
import { SelectorCarril } from '@/components/feed/SelectorCarril'
import { Cargando } from '@/components/ui'
import { getSesion } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Tu feed · Darma',
}

interface PropsPagina {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaginaFeed({ searchParams }: PropsPagina) {
  const params = await searchParams
  const bruto = Array.isArray(params.carril) ? params.carril[0] : params.carril
  const carril: Carril = esCarril(bruto) ? bruto : 'para_ti'

  return (
    <>
      <SelectorCarril activo={carril} />
      {/* `key` para que cambiar de carril reinicie el límite de Suspense: sin
          ella, React reutiliza el árbol y la lista del carril anterior se queda
          en pantalla mientras carga la nueva. */}
      <Suspense key={carril} fallback={<Cargando variante="esqueleto" filas={5} />}>
        <PrimeraPagina carril={carril} />
      </Suspense>
    </>
  )
}

/**
 * El trozo que espera a Postgres. Separado en su propio componente porque solo
 * lo que está DENTRO del `<Suspense>` se suspende: si la consulta viviera en
 * `PaginaFeed`, la página entera —selector incluido— esperaría a la base de
 * datos y el streaming no serviría de nada.
 */
async function PrimeraPagina({ carril }: { carril: Carril }) {
  const sesion = await getSesion()
  // El proxy ya cierra las rutas privadas; esta comprobación es la segunda
  // cerradura, no la primera. Redirección y no error: llegar aquí sin sesión es
  // un enlace guardado o una sesión caducada, no un fallo.
  if (!sesion) redirect('/entrar')

  const supabase = await createClient()
  const cabeceras = await headers()

  const pagina = await consultarFeed(supabase, {
    carril,
    limite: LIMITE_POR_DEFECTO,
    cursor: CURSOR_VACIO,
    idioma: idiomaDeContenido(cabeceras.get('accept-language')),
  })

  if (pagina.items.length === 0) return <FeedVacio carril={carril} />

  return (
    <>
      <ListaFeed elementos={pagina.items} />
      <ScrollInfinito cursorInicial={pagina.siguienteCursor} carril={carril} limite={LIMITE_POR_DEFECTO} />
    </>
  )
}
