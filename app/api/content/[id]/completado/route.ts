// ============================================================================
// POST /api/content/[id]/completado — el punto donde se concede el +1.
//
// ── ESTA RUTA NO OTORGA NADA ───────────────────────────────────────────────
// Lo único que hace es llamar a `completar_contenido()`. Quien decide es
// Postgres: la RPC comprueba, en la misma transacción, que la sesión es de esta
// persona, que sigue abierta y que el tiempo acumulado EN EL SERVIDOR llega al
// 90 % de `duration_seconds`. Si pasa, marca `content_views.completed`, y es el
// trigger `content_views_sync()` quien llama a `award_karma()`. Esta ruta no
// escribe karma ni podría: `award_karma()` está revocada a `authenticated` y
// `content_views.completed` no tiene privilegio de UPDATE para nadie salvo el
// dueño de la función.
//
// ── POR QUÉ CASI TODO ES 200 ───────────────────────────────────────────────
// `tiempo_insuficiente`, `ya_completado` y `tope_diario` salen con `ok: true` y
// `acreditado: false`. Dos razones:
//   1. Producto: «hoy ya llegaste al máximo» no es un error de la persona, y
//      pintarlo como un 4xx en rojo contradice el mensaje entero de Darma.
//   2. Seguridad: un status distinto por comprobación fallida le dice al
//      farmeador exactamente qué barrera ha tocado, que es justo lo que
//      necesita para ajustar el ataque. Un 200 uniforme no le dice nada que la
//      barra de progreso no le dijera ya.
//
// La única excepción es la sesión que no es suya: 403 `sin_permiso`, y sin
// revelar si esa sesión existe (la RPC devuelve el mismo motivo para "no
// existe", "está cerrada" y "es de otra persona").
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { limitarVideo } from '@/lib/video/limites'
import { leerCuerpo, validarIdContenido, validarSesionId } from '@/lib/video/validacion'
import { completar } from '@/lib/video/servidor'
import type { ResultadoCompletado } from '@/lib/video/tipos'

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
    await limitarVideo('completado', sesion.userId, { supabase: admin, failClosed: true })

    const resultado = await completar(admin, sesion.userId, contentId, sesionId)

    return sobreOk<ResultadoCompletado>(resultado)
  })
}
