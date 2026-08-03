// ============================================================================
// B08 · GET /api/cron/content/articulos — ingesta de lecturas (RSS).
//
// Programado a "37 */6 * * *": veinte minutos después del cron de vídeo, para
// que dos ejecuciones largas no coincidan y se repartan el cupo diario del
// modelo de moderación en vez de pelearse por él.
// ============================================================================

import { NextResponse, type NextRequest } from 'next/server'
import { apiError, withApiErrorHandling } from '@/lib/apiErrors.ts'
import { esCronAutorizado, secretoCron } from '@/lib/ingest/cronAuth.ts'
import { ejecutarIngesta } from '@/lib/ingest/ejecutar.ts'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!esCronAutorizado(req.headers.get('authorization'), secretoCron())) {
    return apiError('unauthorized', undefined, { logContext: { ruta: 'cron:content:articulos' } })
  }

  return withApiErrorHandling(async () => {
    const data = await ejecutarIngesta({ tipo: 'articulos' })
    return NextResponse.json({ ok: true, data })
  }, { ruta: 'cron:content:articulos' })
}
