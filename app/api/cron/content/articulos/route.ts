// ============================================================================
// B08 · GET /api/cron/content/articulos — ingesta de lecturas (RSS).
//
// Programado a "37 */6 * * *": veinte minutos después del cron de vídeo, para
// que dos ejecuciones largas no coincidan y se repartan el cupo diario del
// modelo de moderación en vez de pelearse por él.
// ============================================================================

import type { NextRequest } from 'next/server'
import { ErrorApi } from '@/lib/auth/errores.ts'
import { manejarRuta } from '@/lib/auth/http.ts'
import { sobreOk } from '@/lib/auth/respuestas.ts'
import { esCronAutorizado, secretoCron } from '@/lib/ingest/cronAuth.ts'
import { ejecutarIngesta } from '@/lib/ingest/ejecutar.ts'
import { logger } from '@/lib/logger.ts'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return manejarRuta(async () => {
    if (!esCronAutorizado(req.headers.get('authorization'), secretoCron())) {
      logger.info('cron_no_autorizado', { ruta: 'cron:content:articulos' })
      throw new ErrorApi('no_autenticado')
    }

    return sobreOk(await ejecutarIngesta({ tipo: 'articulos' }))
  })
}
