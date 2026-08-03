// ============================================================================
// GET /api/metrics — exposición Prometheus (solo máquina, con token)
//
// POR QUÉ NUNCA ES PÚBLICA. Las métricas de Darma no son números neutros: el
// volumen por hora dibuja cuándo hay gente sola de madrugada, el ratio de
// errores dice dónde apretar para tirar el servicio, y `crisis_sin_atender`
// publica cuántas personas en riesgo están esperando revisión humana. Es
// información operativa y también información sensible sobre la comunidad. Va
// siempre detrás de `Authorization: Bearer $METRICS_TOKEN`, y sin token el
// cuerpo es literalmente vacío (ni siquiera los NOMBRES de las métricas).
//
// CERO CONSULTAS A POSTGRES. Todo sale del Map en memoria del proceso. Un
// scrape cada 15 s que golpease la base sería una carga sostenida introducida
// por el propio sistema de medida — exactamente lo que este bloque existe para
// evitar.
//
// ⚠️ LOS CONTADORES SON POR INSTANCIA SERVERLESS. Cada proceso tiene su propio
// Map; el agregado lo hace el recolector sumando los scrapes. Está escrito en
// el `# HELP` de cada métrica. Quien monte una alerta creyendo que el número es
// global la montará mal en las dos direcciones.
//
// ⚠️ PENDIENTE (HANDOFF/PEDIDOS.md): `/api/metrics` NO está en PUBLIC_ROUTES de
// proxy.ts (que es de F4). Mientras no lo esté, el scraper llega sin cookie y
// el proxy responde 401 antes de que este handler se ejecute. La comprobación
// del token de aquí no sobra cuando se añada: el proxy dejará pasar, y el token
// seguirá siendo la única puerta.
// ============================================================================

import { NextResponse } from 'next/server'

import { crearLogger, requestIdDe } from '@/lib/observability/logger.ts'
import { contarPeticion, exportarPrometheus } from '@/lib/observability/metricas.ts'
import { construirMetricas } from '@/lib/observability/salud.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RUTA = '/api/metrics'

export async function GET(peticion: Request): Promise<NextResponse> {
  const requestId = requestIdDe(peticion.headers)

  const { status, cuerpo, contentType } = construirMetricas(
    peticion.headers.get('authorization'),
    exportarPrometheus,
  )

  // Se cuenta ANTES de responder, así que el propio scrape aparece en el
  // siguiente scrape. Es deliberado: si /api/metrics deja de contarse, deja de
  // haber señal de que el recolector sigue vivo.
  contarPeticion(RUTA, status)

  if (status === 401) {
    crearLogger(requestId, RUTA).warn('metricas_no_autorizadas')
  }

  return new NextResponse(cuerpo, {
    status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, max-age=0',
      'x-request-id': requestId,
    },
  })
}
