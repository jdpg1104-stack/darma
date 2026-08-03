// ============================================================================
// GET /api/health — sondeo barato de salud (público)
//
// Lo consume un uptime-checker cada 30 s. Contrato:
//   200 + {ok:true,data:{estado,version,dependencias}}  → puedo servir
//   503 + el mismo cuerpo                               → sácame de rotación
//
// TRES COSAS QUE NO PUEDEN CAMBIAR AQUÍ:
//
//  1. Devuelve 503 de verdad cuando Postgres no responde. Un endpoint de salud
//     que siempre contesta 200 le dice al balanceador que mantenga vivo un
//     proceso incapaz de hablar con la base: alarga la caída en vez de acortarla.
//
//  2. Una sola consulta y menos de 50 ms en el caso bueno. Una comprobación de
//     salud cara es carga que uno mismo se inflige cada 30 s, y encima es la
//     primera que empieza a fallar cuando el sistema va justo — generando
//     falsas alarmas exactamente durante el pico.
//
//  3. El cuerpo es deliberadamente pobre: estado, versión y nombre + estado +
//     latencia de cada dependencia. Ni host, ni versión de Postgres, ni mensaje
//     del driver. Todo eso va al log, que sí es privado.
//
// Esta ruta ya está en PUBLIC_ROUTES de proxy.ts (a diferencia de /api/metrics).
// ============================================================================

import { NextResponse } from 'next/server'

import { comprobarSuperficial } from '@/lib/observability/dependencias.ts'
import { crearLogger, requestIdDe } from '@/lib/observability/logger.ts'
import { contarPeticion, observarLatencia } from '@/lib/observability/metricas.ts'
import { construirSalud } from '@/lib/observability/salud.ts'

/** Nunca cacheada: una salud cacheada es una salud de hace cinco minutos. */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RUTA = '/api/health'

export async function GET(peticion: Request): Promise<NextResponse> {
  const t0 = performance.now()
  const requestId = requestIdDe(peticion.headers)
  const log = crearLogger(requestId, RUTA)

  const comprobaciones = await comprobarSuperficial()
  const { status, cuerpo } = construirSalud(comprobaciones)

  const ms = Math.round(performance.now() - t0)
  observarLatencia(RUTA, ms)
  contarPeticion(RUTA, status)

  if (cuerpo.ok && cuerpo.data.estado !== 'ok') {
    // El `detalle` interno se registra AQUÍ y solo aquí. En la respuesta no
    // viaja (construirSalud lo descarta con un map explícito).
    log.error('salud_degradada', {
      estado: cuerpo.data.estado,
      ms,
      detalle: comprobaciones
        .filter((c) => c.estado !== 'ok')
        .map((c) => `${c.nombre}=${c.estado}:${c.detalle ?? ''}`)
        .join(' '),
    })
  }

  return NextResponse.json(cuerpo, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'x-request-id': requestId,
    },
  })
}
