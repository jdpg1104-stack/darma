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
// `BotonCrisis` se monta AQUÍ y no en el layout de `app/(app)` porque ese
// layout todavía no existe (es de F4). CONTRATOS §9 exige que esté visible en
// todas las pantallas de `app/(app)`; anotado en PEDIDOS.md para que se mueva
// al layout cuando exista y deje de estar duplicado.
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
import estilos from './animo.module.css'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ánimo · Darma',
  description: 'Vídeos cortos de bienestar, curados. Sin comentarios, sin nadie mirando.',
}

/** Idioma del feed. Provisional: sale del contrato de B17 en cuanto exista un
 *  `idiomaDeSesion()`. Anotado en PEDIDOS.md. */
const IDIOMA_POR_DEFECTO = 'es'

export default async function PaginaAnimo() {
  await requireSesion()

  const supabase = await createClient()
  const filas = await paginaFeed(supabase, IDIOMA_POR_DEFECTO, null, LIMITE_FEED_DEFECTO)

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
            titulo="Todavía no hay vídeos para ti"
            descripcion="Estamos curando contenido nuevo. Vuelve en un rato."
          />
        </div>
      ) : (
        <FeedVertical inicial={inicial} idioma={IDIOMA_POR_DEFECTO} />
      )}
    </main>
  )
}
