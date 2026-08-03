// ============================================================================
// GET /api/billing/ledger?cursor&limite → PaginaCursor<MovimientoPublico>
//
// ── LO QUE NO SALE ──────────────────────────────────────────────────────────
// `raw_receipt` (recibo crudo de la tienda: lleva identificadores de la cuenta
// de Apple o Google) y `external_id`. CONTRATOS §2 declara ese tipo de dato
// inexistente en Darma. Tampoco sale el `id`: es un bigint interno y viaja
// dentro del cursor opaco (CONTRATOS §1).
//
// La consulta vive en `mi_historial_cristales()`, que selecciona columnas
// explícitas y filtra por `auth.uid()`. Además, `0121_1` revoca el privilegio
// de columna de `raw_receipt`/`external_id` a `authenticated`, así que aunque
// alguien esquive esta ruta y vaya a PostgREST con la anon key, tampoco los ve.
// Las dos barreras son a propósito: la ruta puede reescribirse mal; el
// privilegio no.
//
// ── SALDO ───────────────────────────────────────────────────────────────────
// Se lee de `profiles.crystals`, **nunca con un `sum()` sobre el ledger**. El
// `sum()` es la herramienta de reconciliación de un cron nocturno, no la de
// pintar una pantalla. (Y si divergen, gana el ledger: ver PEDIDOS.)
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { decodificarCursor, historialCristales } from '@/lib/billing/ledger'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { parsearPagina } from '@/lib/billing/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `billing:ledger:${sesion.userId}`,
      limit: LIMITES_PETICION.ledger.limite,
      windowSeconds: LIMITES_PETICION.ledger.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const { cursor, limite } = parsearPagina(new URL(request.url))

    // Un cursor corrupto sirve la primera página; no es un 500. Es una url mal
    // pegada, no un fallo del sistema.
    const pagina = await historialCristales(supabase, {
      cursor: decodificarCursor(cursor),
      limite,
    })

    return sobreOk(pagina)
  })
}
