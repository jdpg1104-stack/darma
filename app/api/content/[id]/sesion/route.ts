// ============================================================================
// POST /api/content/[id]/sesion — abre la sesión de reproducción.
//
// El cuerpo está VACÍO a propósito: no hay ni un dato del cliente que merezca
// entrar aquí. El `userId` sale de la sesión (CONTRATOS §6) y el `contentId`
// del segmento de la ruta, validado como uuid antes de tocar la base.
//
// La RPC reutiliza la sesión abierta si ya existe, así que reabrir el mismo
// vídeo no crea filas nuevas ni reinicia el progreso: alguien que sale y vuelve
// a la pestaña sigue donde estaba.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { limitarVideo } from '@/lib/video/limites'
import { validarIdContenido } from '@/lib/video/validacion'
import { abrirSesion } from '@/lib/video/servidor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _peticion: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const { id } = await contexto.params
    const contentId = validarIdContenido(id)

    const admin = createAdminClient()
    await limitarVideo('sesion', sesion.userId, { supabase: admin })

    const sesionId = await abrirSesion(admin, sesion.userId, contentId)

    return sobreOk<{ sesionId: string }>({ sesionId })
  })
}
