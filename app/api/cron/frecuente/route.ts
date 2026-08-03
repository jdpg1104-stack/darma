// ============================================================================
// B00 · GET /api/cron/frecuente — el despachador de lo volátil.
//
// Programado a "7 * * * *", que es el horario que pidió B06 para la foto del
// ranking (PEDIDOS.md). El minuto 7 y no el 0, por el pico global de la hora en
// punto.
//
// Dos trabajos, y el segundo solo a ciertas horas:
//   · ranking-snapshot  · siempre. Sin él el tablero se congela y nada falla de
//                         forma visible.
//   · metricas-rollup   · solo a las 22 y a las 23 UTC. NO es una optimización:
//                         `admin_rollup_dia()` mide `daily_karma_earned`, que se
//                         reinicia cada día, así que un día solo se puede medir
//                         el propio día y tarde. Recalcularlo después escribe
//                         ceros encima de los valores buenos. El porqué completo
//                         está en `lib/cron/trabajos/tablero.ts`.
//
// ⚠️ SOBRE LA FRECUENCIA REAL EN HOBBY: además del tope de dos crons, el plan
// gratuito no garantiza el disparo horario. Por eso `ranking-snapshot` está
// TAMBIÉN en la lista diaria: si esta ruta acaba disparándose una vez al día, el
// tablero se refresca igual desde allí en lugar de congelarse en silencio. Si
// esta ruta se dispara una sola vez al día y no cae en la ventana de las 22–23,
// el rollup no corre: es la primera cosa que hay que comprobar al desplegar, y
// está anotado en el informe del bloque.
// ============================================================================

import type { NextRequest, NextResponse } from 'next/server'
import { planFrecuente } from '@/lib/cron/plan.ts'
import { responderDespacho } from '@/lib/cron/ruta.ts'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  return responderDespacho(
    'frecuente',
    req.headers.get('authorization'),
    planFrecuente(new Date().getUTCHours()),
  )
}
