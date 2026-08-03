// ============================================================================
// GET /api/billing/catalog → { paquetes, regalos, cosmeticos, disponible }
//
// El catálogo NO lleva importes en dinero: lleva `sku` y cantidad de cristales.
// El precio real lo localiza cada tienda a partir de su tier de precio, y
// cualquier euro escrito aquí estaría mal en la mayoría de países (ver la
// cabecera de lib/billing/catalogo.ts). `precioReferencia` va marcado como lo
// que es: un orden de magnitud para ordenar la pantalla.
//
// `disponible: false` cuando IAP no está configurado en el entorno. La tienda
// degrada entonces a "solo en la app" y NO ofrece un checkout alternativo —
// que es exactamente lo que Apple y Google prohíben.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { configApple } from '@/lib/billing/apple'
import { PAQUETES, COMISION_TIENDA } from '@/lib/billing/catalogo'
import { cosmeticosPublicables } from '@/lib/billing/cosmeticos'
import { configGoogle } from '@/lib/billing/google'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { REGALOS, COMISION_REGALO, PRECIO_MINIMO_REGALO } from '@/lib/billing/regalos'
import { EXPLICACION_CRISTALES, FRASE_LINEA_ROJA, TIENDA_SOLO_EN_LA_APP } from '@/lib/billing/textos'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `billing:catalog:${sesion.userId}`,
      limit: LIMITES_PETICION.catalog.limite,
      windowSeconds: LIMITES_PETICION.catalog.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const disponible = configApple() !== null || configGoogle() !== null

    return sobreOk({
      paquetes: PAQUETES,
      regalos: REGALOS,
      cosmeticos: cosmeticosPublicables(),
      comisionTienda: COMISION_TIENDA,
      comisionRegalo: COMISION_REGALO,
      precioMinimoRegalo: PRECIO_MINIMO_REGALO,
      disponible,
      // La frase viaja en la respuesta para que ninguna superficie de pago
      // pueda pintarse sin ella por olvido.
      lineaRoja: FRASE_LINEA_ROJA,
      explicacion: disponible ? EXPLICACION_CRISTALES : TIENDA_SOLO_EN_LA_APP,
    })
  })
}
