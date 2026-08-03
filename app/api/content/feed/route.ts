// ============================================================================
// GET /api/content/feed — una página del scroll vertical de /animo.
//
// ── UNA CONSULTA ───────────────────────────────────────────────────────────
// `feed_animo()` (migración 0107_1) hace el keyset sobre `idx_content_feed` y
// excluye lo ya completado con una sonda por la PK de `content_views`. No hay
// segunda consulta para "¿cuáles he visto?" —sería un N+1 disfrazado— ni un
// `count(*)` para saber si hay más: el cursor siguiente se deriva de si la
// página vino llena.
//
// ── LO QUE NO SALE DE AQUÍ ─────────────────────────────────────────────────
// La `url` cruda del `content_item` no se devuelve nunca: el embed se compone
// en `lib/video/embed.ts` a partir de `externalId`, y así el cliente no puede
// acabar apuntando a un origen que la CSP bloquea.
//
// Un ítem cuyo `platform` no sea `youtube`, o cuyo `external_id` no tenga la
// forma de un id de YouTube, SE DESCARTA aquí. No se busca alternativa: la CSP
// solo permite `youtube-nocookie` y un iframe hacia otro sitio sale en blanco
// sin error visible.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { limitarVideo } from '@/lib/video/limites'
import { validarParametrosFeed } from '@/lib/video/validacion'
import { paginaFeed } from '@/lib/video/servidor'
import { itemVideoDesde } from '@/lib/video/embed'
import { siguienteCursor } from '@/lib/video/cursor'
import type { ItemVideo, PaginaCursor } from '@/lib/video/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(peticion: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    // El cliente ADMIN va SOLO al contador de rate limit: `check_rate_limit()`
    // está concedida a `service_role` únicamente, y con el cliente RLS la capa
    // distribuida haría fail-open sin que nada se queje.
    await limitarVideo('feed', sesion.userId, { supabase: createAdminClient() })

    const { cursor, limite, idioma } = validarParametrosFeed(new URL(peticion.url))

    const supabase = await createClient()
    const filas = await paginaFeed(supabase, idioma, cursor, limite)

    // El cursor se calcula sobre las filas CRUDAS, antes de descartar las no
    // reproducibles. Si se calculara sobre las ya filtradas, una página entera
    // de ítems descartados devolvería `siguienteCursor: null` y el scroll se
    // pararía en seco sobre un catálogo que todavía tiene contenido.
    const cursorSiguiente = siguienteCursor(filas, limite)

    const items: ItemVideo[] = []
    for (const fila of filas) {
      const item = itemVideoDesde(fila)
      if (item) items.push(item)
    }

    return sobreOk<PaginaCursor<ItemVideo>>({ items, siguienteCursor: cursorSiguiente })
  })
}
