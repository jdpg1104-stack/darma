// ============================================================================
// B08 · GET /api/cron/content/videos — ingesta de vídeo (YouTube).
//
// Programado en Vercel a "17 */6 * * *" (ver HANDOFF/PEDIDOS.md: `vercel.json`
// lo posee F4). El minuto 17 y no el 0 es deliberado: los crons de la hora en
// punto compiten con el pico global de toda la plataforma, y los tres crons de
// este bloque no deben solaparse entre sí.
// ============================================================================

import type { NextRequest } from 'next/server'
import { ErrorApi } from '@/lib/auth/errores.ts'
import { manejarRuta } from '@/lib/auth/http.ts'
import { sobreOk } from '@/lib/auth/respuestas.ts'
import { esCronAutorizado, secretoCron } from '@/lib/ingest/cronAuth.ts'
import { ejecutarIngesta } from '@/lib/ingest/ejecutar.ts'
import { logger } from '@/lib/logger.ts'

// nodejs y no edge: `timingSafeEqual` (node:crypto) y el cliente admin lo exigen.
export const runtime = 'nodejs'
// 60 s de techo; el presupuesto interno es de 45 s y los 15 restantes son el
// margen para guardar el cursor y salir limpiamente.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return manejarRuta(async () => {
    // Lo primero de todo: un 401 no debe costar ni una consulta ni una lectura
    // de entorno de más. El registro va explícito porque el `catch` de
    // `manejarRuta` no sabe de qué cron venía la petición.
    if (!esCronAutorizado(req.headers.get('authorization'), secretoCron())) {
      logger.info('cron_no_autorizado', { ruta: 'cron:content:videos' })
      throw new ErrorApi('no_autenticado')
    }

    return sobreOk(await ejecutarIngesta({ tipo: 'videos' }))
  })
}
