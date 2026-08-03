// ============================================================================
// B08 · GET /api/cron/content/reverificar — barrido diario de salud del catálogo.
//
// Programado a "23 4 * * *". SIN ESTO EL FEED ACUMULA VÍDEOS MUERTOS: el embed
// que hoy funciona puede dejar de funcionar mañana porque el dueño lo bloquea,
// lo pone en privado o lo borra, y nadie nos avisa. La persona que abre el feed
// de bienestar a las tres de la mañana no se encuentra un vídeo: se encuentra un
// recuadro negro, y eso es peor que no haber abierto la app.
//
// Un `desconocido` (timeout, 429, red) NO retira nada: el ítem sigue `approved`
// y se vuelve a preguntar mañana. Retirar ante la duda vaciaría el feed poco a
// poco y de forma invisible.
//
// Aprovecha el paso para purgar `ingest_log` a 90 días, acotado a 5 000 filas.
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
    return apiError('unauthorized', undefined, { logContext: { ruta: 'cron:content:reverificar' } })
  }

  return withApiErrorHandling(async () => {
    const data = await ejecutarIngesta({ tipo: 'reverificar' })
    return NextResponse.json({ ok: true, data })
  }, { ruta: 'cron:content:reverificar' })
}
