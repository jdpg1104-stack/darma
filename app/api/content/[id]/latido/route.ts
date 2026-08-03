// ============================================================================
// POST /api/content/[id]/latido — el pulso de la reproducción.
//
// El cliente late cada 5 s MIENTRAS el reproductor está en «reproduciendo» y la
// pestaña es visible. El cuerpo lleva solo el `sesionId`: ni segundos, ni
// instantes, ni "he visto hasta el minuto 2". Todo eso lo mediría el reloj de
// quien puede mentir.
//
// El servidor acredita `min(now() - last_beat_at, 7 s)` y topa el acumulado por
// `duration_seconds`. Los dos topes son la defensa: sin el primero, un cliente
// que retiene los latidos y los descarga de golpe acredita minutos en un
// segundo; sin el segundo, una pestaña abierta toda la noche acredita horas.
//
// El límite es por (usuario, CONTENIDO), no por usuario: 12 latidos/min es el
// ritmo de un vídeo, y con la clave solo por usuario alguien que ve tres vídeos
// a la vez en tres pestañas se comería su propio cupo.
//
// `failClosed: true` — es la ruta que acumula el tiempo que acaba pagando
// karma. Si Postgres se cae, la respuesta correcta es «ahora no», no «adelante».
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { limitarVideo } from '@/lib/video/limites'
import { leerCuerpo, validarIdContenido, validarSesionId } from '@/lib/video/validacion'
import { barrerSesiones, latir } from '@/lib/video/servidor'
import type { EstadoLatido } from '@/lib/video/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  peticion: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const { id } = await contexto.params
    const contentId = validarIdContenido(id)
    const sesionId = validarSesionId(await leerCuerpo(peticion))

    const admin = createAdminClient()
    await limitarVideo('latido', `${sesion.userId}:${contentId}`, {
      supabase: admin,
      failClosed: true,
    })

    const estado = await latir(admin, sesion.userId, contentId, sesionId)

    // Mantenimiento oportunista (2 % de las llamadas): cierra las sesiones
    // abandonadas hace más de 6 h. Sin esto, `idx_content_sessions_open` deja
    // de ser un índice pequeño. No se espera y no puede hacer fallar el latido.
    void barrerSesiones(admin)

    // `acreditados` sale porque la barra de progreso lo necesita; el bruto de
    // la sesión (beats, opened_at, si está cerrada) no sale nunca.
    return sobreOk<EstadoLatido>(estado)
  })
}
