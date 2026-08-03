// ============================================================================
// POST /api/moderation/report — la ÚNICA ruta de este prefijo abierta a
// cualquier persona con sesión.
//
// ── NUNCA DICE SI EL REPORTE PROSPERÓ ──────────────────────────────────────
// La respuesta es siempre `{ recibido: true }`. Da igual si el contenido ya
// estaba reportado, si el uuid no existe o si el flag se abrió: contar lo
// contrario le diría al reportante quién está bajo revisión, y eso convierte
// el reporte en una herramienta de vigilancia entre usuarios.
//
// ── RATE LIMIT ─────────────────────────────────────────────────────────────
// 10/hora. Sin él, el reporte masivo coordinado es acoso con nuestra propia
// interfaz.
// ============================================================================

import { z } from 'zod'
import { requireSesion } from '@/lib/auth/session'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { abrirFlag } from '@/lib/ai/auditoria'
import { LIMITE_REPORTE } from '@/lib/ai/modelo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El motivo es una CATEGORÍA cerrada, no texto libre.
 *
 * Un campo libre en un reporte acaba conteniendo (a) el contenido reportado
 * copiado y (b) insultos hacia la persona reportada. Lo primero duplica el
 * desahogo en una tabla de moderación; lo segundo convierte el formulario en
 * un canal de acoso indirecto. Con un enum no pasa ninguna de las dos.
 */
const Cuerpo = z.object({
  refType: z.enum(['post', 'comment', 'refuge_message', 'profile', 'content_item']),
  refId: z.string().uuid(),
  motivo: z.enum(['acoso', 'spam', 'odio', 'autolesion', 'sexual', 'suplantacion', 'otro']),
})

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    const admin = createAdminClient()
    const limite = await rateLimit({
      key: `report:${sesion.userId}`,
      limit: LIMITE_REPORTE.limite,
      windowSeconds: LIMITE_REPORTE.ventanaSegundos,
      supabase: admin,
      // Fail-closed: si el contador no responde, es preferible que un reporte
      // legítimo espere a que un acosador tenga barra libre.
      failClosed: true,
    })
    if (!limite.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: limite.retryAfter })
    }

    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      throw new ErrorApi('entrada_invalida')
    }

    const analisis = Cuerpo.safeParse(cuerpo)
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    await abrirFlag(
      {
        refTipo: analisis.data.refType,
        refId: analisis.data.refId,
        // ⚠️ El reportante SÍ se guarda (para detectar reportes en cadena),
        // pero no sale nunca en ninguna respuesta de API fuera del panel.
        reporterId: sesion.userId,
        senal: 'user_report',
        // Autolesión sube a la cabeza de la cola: es la única categoría en la
        // que un retraso puede ser irreversible.
        severidad: analisis.data.motivo === 'autolesion' ? 5 : 3,
        detalle: JSON.stringify({ motivo: analisis.data.motivo }),
      },
      { admin },
    )

    // Respuesta constante. No revela nada.
    return sobreOk({ recibido: true as const })
  })
}
