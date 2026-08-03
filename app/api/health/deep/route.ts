// ============================================================================
// GET /api/health/deep — comprobación cara (solo máquina)
//
// La ejecuta el cron horario de Vercel con `Authorization: Bearer $CRON_SECRET`,
// igual que las rutas de /api/cron/. Se autentica ELLA MISMA porque el cron
// llega sin cookie y el proxy no puede distinguirla de un anónimo.
//
// Comprueba lo que /api/health no puede permitirse:
//   · la consulta REAL del feed (keyset sobre idx_posts_hot),
//   · que el clasificador de riesgo responde, o que está apagado a propósito,
//   · que `crystal_ledger` cuadra con `profiles.crystals`,
//   · cuántos eventos de crisis de riesgo alto siguen SIN ATENDER.
//
// Y evalúa los presupuestos (lib/observability/presupuestos.ts). La violación
// de `crisis_sin_atender_max` se registra en una línea APARTE, con su propio
// mensaje: mezclarla con "el p95 del feed va alto" en la misma alerta garantiza
// que algún día se silencien las dos juntas, y una de las dos significa que hay
// personas esperando a que alguien lea lo que escribieron.
//
// PENDIENTE (anotado en HANDOFF/PEDIDOS.md): que F4 añada a vercel.json
//   { "path": "/api/health/deep", "schedule": "0 * * * *" }
// El orden correcto es "primero se despliega la ruta, luego se activa el cron":
// un cron apuntando a un endpoint inexistente rompe el despliegue entero.
// ============================================================================

import { NextResponse } from 'next/server'

import { comprobarProfundo } from '@/lib/observability/dependencias.ts'
import { crearLogger, requestIdDe } from '@/lib/observability/logger.ts'
import { contarPeticion, instantanea, observarLatencia } from '@/lib/observability/metricas.ts'
import { hayViolacionDeCrisis } from '@/lib/observability/presupuestos.ts'
import {
  bearerValido,
  construirSaludProfunda,
  respuestaNoAutenticado,
} from '@/lib/observability/salud.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** El sondeo profundo hace varias consultas reales; el límite por defecto de
 *  Vercel (10 s) no le llega en una base grande. */
export const maxDuration = 60

const RUTA = '/api/health/deep'

export async function GET(peticion: Request): Promise<NextResponse> {
  const t0 = performance.now()
  const requestId = requestIdDe(peticion.headers)
  const log = crearLogger(requestId, RUTA)

  if (!bearerValido(peticion.headers.get('authorization'), process.env.CRON_SECRET)) {
    const { status, cuerpo } = respuestaNoAutenticado()
    contarPeticion(RUTA, status)
    // Se registra el intento, no la credencial recibida: un secreto fallido en
    // un log sigue siendo un secreto en un log.
    log.warn('salud_profunda_no_autorizada', { ms: Math.round(performance.now() - t0) })
    return NextResponse.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store' } })
  }

  const comprobaciones = await comprobarProfundo()
  const { status, cuerpo } = construirSaludProfunda(comprobaciones, instantanea())

  const ms = Math.round(performance.now() - t0)
  observarLatencia(RUTA, ms)
  contarPeticion(RUTA, status)

  if (cuerpo.ok) {
    const violaciones = cuerpo.data.violaciones

    if (hayViolacionDeCrisis(violaciones)) {
      // Canal aparte, mensaje aparte, severidad aparte. Ver la cabecera.
      const crisis = violaciones.find((v) => v.severidad === 'crisis')
      log.error('ALERTA_COLA_DE_CRISIS', {
        pendientes: crisis?.valor ?? -1,
        limite: crisis?.limite ?? -1,
      })
    }

    const otras = violaciones.filter((v) => v.severidad !== 'crisis')
    if (otras.length > 0) {
      log.warn('presupuestos_incumplidos', {
        claves: otras.map((v) => `${v.clave}=${Math.round(v.valor * 1000) / 1000}/${v.limite}`).join(' '),
        ms,
      })
    }

    if (cuerpo.data.estado !== 'ok') {
      log.error('salud_profunda_degradada', {
        estado: cuerpo.data.estado,
        detalle: comprobaciones
          .filter((c) => c.estado !== 'ok')
          .map((c) => `${c.nombre}=${c.estado}:${c.detalle ?? ''}`)
          .join(' '),
      })
    }
  }

  return NextResponse.json(cuerpo, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', 'x-request-id': requestId },
  })
}
