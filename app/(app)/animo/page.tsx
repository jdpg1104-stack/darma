// ============================================================================
// /animo — nivel 1 de Darma.
//
// Es la puerta de entrada masiva: alguien que llega roto no escribe el primer
// día, mira. Por eso esta pantalla no pide nada —ni alias, ni texto, ni
// interacción con nadie— y por eso el +1 al completar un vídeo vale 1 y no más:
// ver un vídeo es autocuidado, no aportación a la comunidad. Si valiera más, el
// camino más rápido a Mentor sería hacer scroll, y eso rompería el mensaje
// entero de la app.
//
// ── PRESUPUESTO: ≤ 3 CONSULTAS ─────────────────────────────────────────────
//  1. `mi_sesion()` vía `requireSesion()` (memoizada por render).
//  2. `feed_animo()` — la primera página, aquí, en el servidor. Hacerla desde
//     el cliente añadiría una cascada de red antes del primer fotograma.
// Ninguna más. `BotonCrisis` y el resto de la capa no consultan nada.
//
// `BotonCrisis` NO se monta aquí: llega desde `app/(app)/layout.tsx`, que lo
// pinta flotante para todo el grupo, como exige CONTRATOS §9. Esta página no
// lo duplica.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { requireSesion } from '@/lib/auth/session'
import { paginaFeed } from '@/lib/video/servidor'
import { itemVideoDesde } from '@/lib/video/embed'
import { siguienteCursor } from '@/lib/video/cursor'
import { LIMITE_FEED_DEFECTO } from '@/lib/video/validacion'
import type { ItemVideo, PaginaCursor } from '@/lib/video/tipos'
import { FeedVertical } from '@/components/video'
import { EstadoVacio } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import estilos from './animo.module.css'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `generateMetadata` y no un `metadata` constante: el título y la descripción
 * de la pestaña también son copy, y en una app en dos idiomas un `<title>` en
 * español es lo primero que se ve y lo último que alguien revisa.
 */
export async function generateMetadata() {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('contenido.meta.titulo'),
    description: t('contenido.meta.descripcion'),
  }
}

/**
 * Idioma del CATÁLOGO de vídeos, que NO es el de la interfaz.
 *
 * Se queda en `'es'` a propósito aunque el traductor ya sepa resolver el locale:
 * cambiarlo aquí cambia qué filas devuelve `feed_animo()`, y si el catálogo
 * todavía no tiene vídeos en inglés, quien lea la app en inglés se encontraría
 * con `/animo` vacía. Eso es una decisión de contenido y de datos, no de copy;
 * anotada en HANDOFF/PEDIDOS.md para B07/B08.
 */
const IDIOMA_DEL_CATALOGO = 'es'

export default async function PaginaAnimo() {
  await requireSesion()

  const t = obtenerTraductor(await resolverLocale())

  const supabase = await createClient()
  const filas = await paginaFeed(supabase, IDIOMA_DEL_CATALOGO, null, LIMITE_FEED_DEFECTO)

  const items: ItemVideo[] = []
  for (const fila of filas) {
    // Un ítem que no sea de YouTube se DESCARTA: la CSP solo permite
    // `youtube-nocookie` y un iframe hacia otro origen sale en blanco sin error
    // visible, que es el peor fallo posible.
    const item = itemVideoDesde(fila)
    if (item) items.push(item)
  }

  const inicial: PaginaCursor<ItemVideo> = {
    items,
    siguienteCursor: siguienteCursor(filas, LIMITE_FEED_DEFECTO),
  }

  return (
    <main className={estilos.pantalla}>
      {items.length === 0 ? (
        <div className={estilos.vacio}>
          <EstadoVacio
            titulo={t('contenido.vacioTitulo')}
            descripcion={t('contenido.vacioDescripcion')}
          />
        </div>
      ) : (
        <FeedVertical inicial={inicial} idioma={IDIOMA_DEL_CATALOGO} />
      )}
    </main>
  )
}
