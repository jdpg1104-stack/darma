// ============================================================================
// POST /api/billing/restore  { plataforma, referencia }
//   → { acreditados: number; saldo: number }
//
// Sin esto, quien reinstala la app pierde lo que pagó y pide un reembolso con
// toda la razón. La restauración re-verifica el historial de transacciones
// contra la tienda y acredita **lo que falte**, apoyándose en el mismo
// `on conflict (external_id) do nothing`: lo que ya estaba no se duplica, y por
// eso la ruta se puede llamar mil veces sin consecuencia.
//
// ── EL RATE LIMIT MÁS BAJO DEL BLOQUE, Y NO ES UNA ERRATA ───────────────────
// Una sola petición aquí dispara N verificaciones contra la App Store Server
// API. Sin freno nos convertimos en un cliente abusivo y Apple limita a
// NOSOTROS: dejaría de funcionar la verificación de todas las compras
// legítimas, no solo la restauración.
//
// 🔴 Restaurar acredita cristales. Nunca karma.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { historialTransacciones } from '@/lib/billing/apple'
import { resolverPaquete } from '@/lib/billing/catalogo'
import { verificarRecibo as verificarGoogle } from '@/lib/billing/google'
import { acreditarCompra, origenDePlataforma, type Plataforma } from '@/lib/billing/ledger'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { esquemaRestaurar, parsear } from '@/lib/billing/validacion'
import { logger } from '@/lib/logger'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Tope de compras a restaurar en una petición. Acota el coste del peor caso. */
const MAX_RESTAURAR = 50

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `billing:restore:${sesion.userId}`,
      limit: LIMITES_PETICION.restore.limite,
      windowSeconds: LIMITES_PETICION.restore.ventanaSegundos,
      supabase,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const { plataforma, referencia } = parsear(esquemaRestaurar, await leerCuerpo(request))

    const recibos = await recibosARestaurar(plataforma, referencia)

    const admin = createAdminClient()
    let acreditados = 0
    let saldo = 0

    for (const recibo of recibos.slice(0, MAX_RESTAURAR)) {
      const paquete = resolverPaquete(recibo.productId)
      if (!paquete || !recibo.externalId) {
        // Una compra de un producto retirado del catálogo no se acredita a
        // ojo: se registra para revisarla a mano. Inventar una cantidad sería
        // exactamente lo que este bloque no puede hacer.
        logger.info('billing:restore_producto_desconocido', {
          user_id: sesion.userId,
          product_id: recibo.productId ?? 'null',
        })
        continue
      }

      const resultado = await acreditarCompra(admin, {
        userId: sesion.userId,
        externalId: recibo.externalId,
        sku: paquete.sku,
        source: origenDePlataforma(plataforma),
        recibo: { productId: recibo.productId, externalId: recibo.externalId, restaurada: true },
      })

      if (resultado.acreditado) acreditados += 1
      saldo = resultado.saldo
    }

    return sobreOk({ acreditados, saldo })
  })
}

/**
 * Apple da el historial completo a partir del `originalTransactionId`. Google
 * no tiene equivalente para consumibles: la app manda los pares
 * `productId|purchaseToken` que conserva localmente, separados por comas, y
 * cada uno se verifica por separado.
 */
async function recibosARestaurar(plataforma: Plataforma, referencia: string) {
  if (plataforma === 'apple') return historialTransacciones(referencia)

  const tokens = referencia.split(',').map((t) => t.trim()).filter(Boolean).slice(0, MAX_RESTAURAR)
  const verificados = await Promise.all(tokens.map((t) => verificarGoogle(t)))
  return verificados.filter((r) => r.valido)
}

async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
