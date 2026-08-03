// ============================================================================
// GET /api/admin/metricas — el resumen del panel, RECORTADO al rol.
//
// El recorte se hace en el servidor: lo que un rol no puede ver, no se
// serializa. Ocultarlo en el cliente dejaría el JSON completo viajando por la
// red, y ahí lo lee cualquiera con la pestaña de red abierta.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../_guard.ts'
import { ACCIONES } from '@/app/(admin)/_lib/acceso'
import {
  DIAS_VENTANA_DETALLE,
  DIAS_VENTANA_KPI,
  getResumenPanel,
  recortarPorRol,
  ventanaDias,
} from '@/app/(admin)/_lib/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Consulta = z.object({
  // Máximo 90 días: es lo que guarda la serie de detalle. Un rango mayor no
  // devuelve más datos, solo hace trabajar de más a la base.
  dias: z.coerce.number().int().min(1).max(DIAS_VENTANA_DETALLE).default(DIAS_VENTANA_KPI),
})

export async function GET(request: Request) {
  return manejarRuta(async () => {
    const contexto = await requireAdmin('soporte', {
      limite: 'lectura',
      accion: ACCIONES.metricas,
    })

    const analisis = Consulta.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    const admin = createAdminClient()
    const resumen = await getResumenPanel(admin, ventanaDias(analisis.data.dias))

    return sobreOk(recortarPorRol(resumen, contexto.rol))
  })
}
