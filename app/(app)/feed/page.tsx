// ============================================================================
// /feed — la pantalla principal de Darma. Server Component.
//
// ── LA PRIMERA PÁGINA NO PASA POR /api/feed ────────────────────────────────
// Se consulta directamente con el cliente RLS. Ir a la propia API desde el
// servidor añadiría un salto HTTP completo (DNS, TLS, cabeceras, serialización)
// dentro del render, y eso se paga entero en el LCP de la pantalla que más veces
// se carga de la app. La ruta de API existe para el scroll, que sí viene del
// navegador.
//
// ── ⛔ SIN STREAMING, Y NO POR DESCUIDO ────────────────────────────────────
// Aquí hubo un `<Suspense>` alrededor de la lista para que el selector de
// carril se enviara de inmediato. La intención era buena y el efecto real era
// que ESTA PANTALLA NO PINTABA NI UN POST: el layout raíz es asíncrono —espera
// a `resolverLocale()` para el `lang` del documento— y suspende en todas las
// peticiones, así que React nunca completaba el intercambio del fallback. La
// lista se quedaba en el DOM dentro de un `div` con `display:none` y la
// hidratación no arrancaba.
//
// Es el mismo fallo que documenta app/SIN-LOADING.md para `loading.tsx`, que no
// era más que el azúcar de Next para exactamente este límite de Suspense. Se
// retiraron los `loading.tsx` y estos dos boundaries escritos a mano
// sobrevivieron a la limpieza.
//
// NO LO VUELVAS A AÑADIR sin arreglar antes la raíz: mientras `app/layout.tsx`
// sea asíncrono, cualquier `<Suspense>` por debajo mata la hidratación de esa
// rama. Y no lo ve `tsc`, ni el lint, ni las pruebas — solo un navegador de
// verdad.
//
// ── force-dynamic / revalidate = 0 NO SON AJUSTES DE RENDIMIENTO ───────────
// El feed depende de `auth.uid()` a través de RLS. Cacheado en el CDN, la
// primera respuesta se le sirve a la siguiente persona: es el feed de alguien
// servido a otro. En una app anónima eso no es una optimización agresiva, es una
// fuga de datos.
// ============================================================================

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
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { getSesion } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata() {
  const t = obtenerTraductor(await resolverLocale())
  return { title: t('feed.metaTitulo') }
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
      {/* `key` para que cambiar de carril reinicie el árbol: sin ella React lo
          reutiliza y la lista del carril anterior se queda en pantalla. */}
      <PrimeraPagina key={carril} carril={carril} />
    </>
  )
}

/**
 * El trozo que espera a Postgres. Sigue separado en su propio componente aunque
 * ya no haya `<Suspense>`: es la forma que hay que conservar para que el día que
 * la raíz deje de ser asíncrona baste con volver a envolver esta llamada.
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
