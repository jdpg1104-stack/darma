// ============================================================================
// B08 · GET /api/cron/content/videos — ingesta de vídeo (YouTube).
//
// Programado en Vercel a "17 */6 * * *" (ver HANDOFF/PEDIDOS.md: `vercel.json`
// lo posee F4). El minuto 17 y no el 0 es deliberado: los crons de la hora en
// punto compiten con el pico global de toda la plataforma, y los tres crons de
// este bloque no deben solaparse entre sí.
// ============================================================================

import { NextResponse, type NextRequest } from 'next/server'
import { apiError, withApiErrorHandling } from '@/lib/apiErrors.ts'
import { esCronAutorizado, secretoCron } from '@/lib/ingest/cronAuth.ts'
import { ejecutarIngesta } from '@/lib/ingest/ejecutar.ts'

// nodejs y no edge: `timingSafeEqual` (node:crypto) y el cliente admin lo exigen.
export const runtime = 'nodejs'
// 60 s de techo; el presupuesto interno es de 45 s y los 15 restantes son el
// margen para guardar el cursor y salir limpiamente.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!esCronAutorizado(req.headers.get('authorization'), secretoCron())) {
    return apiError('unauthorized', undefined, { logContext: { ruta: 'cron:content:videos' } })
  }

  return withApiErrorHandling(async () => {
    const data = await ejecutarIngesta({ tipo: 'videos' })
    return NextResponse.json({ ok: true, data })
  }, { ruta: 'cron:content:videos' })
}
