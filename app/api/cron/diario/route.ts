// ============================================================================
// B00 · GET /api/cron/diario — el despachador del día.
//
// Programado a "11 4 * * *" (04:11 UTC). El minuto 11 y no el 0 es el mismo
// criterio que ya usan los crons de B08 y B06: a la hora en punto compiten los
// crons de medio internet y el arranque en frío de una función que va a hablar
// mucho con Postgres es justo donde se nota. Las 04 UTC es la hora de menos
// tráfico de la app.
//
// Corre OCHO trabajos en orden de prioridad, encabezados por los dos que tienen
// plazo legal (RGPD). El reparto de presupuesto, el orden y qué pasa cuando el
// reloj se agota están explicados en `lib/cron/plan.ts`.
//
// Es GET porque Vercel Cron dispara con GET, igual que las rutas de B08.
// ============================================================================

import type { NextRequest, NextResponse } from 'next/server'
import { PLAN_DIARIO } from '@/lib/cron/plan.ts'
import { responderDespacho } from '@/lib/cron/ruta.ts'

// `nodejs` y no `edge`: `timingSafeEqual` viene de `node:crypto` y el cliente
// admin no funciona en el runtime del borde.
export const runtime = 'nodejs'
// 60 s es el techo del plan Hobby. El presupuesto interno del despachador es de
// 52 s y los 8 restantes son el margen para escribir el último registro, soltar
// el arrendamiento y devolver el JSON.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  return responderDespacho('diario', req.headers.get('authorization'), PLAN_DIARIO)
}
