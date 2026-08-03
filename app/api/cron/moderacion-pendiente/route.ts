// ============================================================================
// B00 · GET /api/cron/moderacion-pendiente — la ruta que pidió B11.
//
// PEDIDOS.md, «De B11 → B08 / B14 / F4»: releer los flags `ai_unavailable` en
// estado `pending` y volver a pasarlos por `evaluarContenido()` con
// `omitirLimiteUsuario: true`. Sin ella, todo lo que se publicó mientras el
// clasificador estaba caído se queda sin validar PARA SIEMPRE: la voz se abrió
// pero el karma no se recupera nunca.
//
// ── POR QUÉ EXISTE SI EL DESPACHADOR DIARIO YA LO CORRE ────────────────────
// Porque el caso de uso no es el mismo. En la lista diaria el trabajo tiene 8 s
// y comparte el reloj con otros siete. Aquí tiene 45 s enteros, y es lo que se
// dispara A MANO en cuanto el clasificador vuelve tras una caída larga, sin
// esperar a las 04:11 y sin arrastrar de paso una purga de retención. Es la
// misma función en los dos sitios (`lib/cron/plan.ts`), así que no pueden
// divergir.
//
// No lleva entrada propia en `vercel.json`: los dos huecos del plan Hobby están
// ocupados por los despachadores, y este trabajo ya corre dentro del diario.
// ============================================================================

import type { NextRequest, NextResponse } from 'next/server'
import { PLAN_MODERACION } from '@/lib/cron/plan.ts'
import { responderDespacho } from '@/lib/cron/ruta.ts'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  return responderDespacho(
    'moderacion-pendiente',
    req.headers.get('authorization'),
    PLAN_MODERACION,
  )
}
