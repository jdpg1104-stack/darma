// ============================================================================
// POST /api/billing/cosmetico  { cosmeticoId }  → ResultadoCompraCosmetico
//
// El cliente manda el ID del cosmético, nunca su precio: el coste sale de
// `CATALOGO_COSMETICOS` y viaja a `comprar_cosmetico()` (0217_1), que cobra con
// `spend_crystals()` y escribe `profiles.cosmetic_frame` o `cosmetic_palette`
// en la MISMA transacción. Idempotente por (persona, cosmético): el reintento
// de un doble toque devuelve `comprado: false` con el saldo intacto, así que
// aquí no hace falta clave de idempotencia del cliente.
//
// 🔴 Decoración, y solo decoración. Nada de esta ruta toca karma ni la cola de
// crisis, y ningún cosmético comprable imita un nivel
// (`prohibidoPorqueImitaNivel`, con guard en `cosmeticos.test.ts`).
//
// ── POR QUÉ EL CLIENTE ADMIN ────────────────────────────────────────────────
// `comprar_cosmetico()` está concedida solo a `service_role`, y las dos
// columnas cosméticas están FUERA del `grant update` de `authenticated`: cobro
// y escritura tienen que ocurrir en la misma transacción del servidor. Si el
// cliente RLS pudiera escribirlas, se pondría el cosmético sin pagar.
// ============================================================================

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import {
  IDS_COSMETICOS_COMPRABLES,
  LIMITE_PETICION_COSMETICO,
  comprarCosmetico,
} from '@/lib/billing/cosmeticos'
import { parsear } from '@/lib/billing/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// `z.enum` sobre la tupla de `cosmeticos.ts`: el tipo, la validación y el CHECK
// del SQL salen de la misma lista (espejada por `cosmeticos.test.ts`). Y
// `.strict()`, como todo esquema de billing: un `crystals: 999999` colado en el
// body se rechaza con 422 en vez de ignorarse en silencio. El esquema vive aquí
// y no en `validacion.ts` solo por propiedad de archivos de esta ola (anotado
// en PEDIDOS para moverlo con los demás).
const esquemaCosmetico = z
  .object({
    cosmeticoId: z.enum(IDS_COSMETICOS_COMPRABLES),
  })
  .strict()

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const admin = createAdminClient()

    // ⛔ EL CLIENTE ADMIN, NO EL RLS. `check_rate_limit()` está REVOCADA a
    // `authenticated` y concedida solo a `service_role` (0002_comunidad.sql):
    // con el cliente RLS esto era un 429 permanente para todo el mundo (ver la
    // misma nota en boost/gift). `failClosed: true` y es correcto: si el
    // limitador cae de verdad, una ruta de dinero debe cerrarse, no abrirse.
    const permitido = await rateLimit({
      key: `billing:cosmetico:${sesion.userId}`,
      limit: LIMITE_PETICION_COSMETICO.limite,
      windowSeconds: LIMITE_PETICION_COSMETICO.ventanaSegundos,
      supabase: admin,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const datos = parsear(esquemaCosmetico, await leerCuerpo(request))

    const resultado = await comprarCosmetico(admin, {
      // De la SESIÓN. Aceptar un userId del body sería gastar los cristales de
      // otra persona en decorar el perfil de uno (CONTRATOS §6).
      userId: sesion.userId,
      cosmeticoId: datos.cosmeticoId,
    })

    return sobreOk(resultado)
  })
}

async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
