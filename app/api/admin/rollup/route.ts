// ============================================================================
// POST /api/admin/rollup — recalcular a mano el rollup de un día.
//
// ── POR QUÉ EXIGE SESIÓN DE ADMIN Y NO UN SECRETO DE CRON ─────────────────
// La ejecución AUTOMÁTICA va por `pg_cron`, dentro de la base (§10 de la
// migración). Este endpoint es para recalcular a mano cuando alguien corrige
// un caso de crisis antiguo o cuando se arregla un bug del rollup.
//
// Y sobre todo: `proxy.ts` solo exime de sesión al prefijo `/api/cron/*`, que
// es de B08. Un endpoint admin autenticado con un secreto compartido sería un
// permiso que no aparece en `admin_roles`, que no se revoca y que no deja
// rastro de quién lo usó — justo las tres cosas que este bloque existe para
// evitar.
//
// Rol mínimo `operaciones`: es la operación más cara del panel.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../_guard.ts'
import { ACCIONES, auditar } from '@/app/(admin)/_lib/acceso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Cuerpo = z
  .object({
    /** `YYYY-MM-DD` en UTC. Sin él, el día de hoy. */
    dia: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  // `.strict()`: un campo de más es una petición que no entendemos, y una
  // petición que no entendemos no se ejecuta a medias.
  .strict()

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const contexto = await requireAdmin('operaciones', {
      limite: 'rollup',
      accion: ACCIONES.rollup,
    })

    let cuerpo: unknown = {}
    if (request.headers.get('content-length') !== '0') {
      try {
        cuerpo = await request.json()
      } catch {
        cuerpo = {}
      }
    }

    const analisis = Cuerpo.safeParse(cuerpo)
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    const dia = analisis.data.dia ?? new Date().toISOString().slice(0, 10)

    // Comprobación de fecha real: la expresión regular acepta 2026-02-31.
    const comprobacion = new Date(`${dia}T00:00:00Z`)
    if (Number.isNaN(comprobacion.getTime()) || comprobacion.toISOString().slice(0, 10) !== dia) {
      throw new ErrorApi('entrada_invalida')
    }

    const admin = createAdminClient()
    const { error } = await admin.rpc('admin_rollup_dia', { p_dia: dia })
    // El error de Postgres NO sale de aquí: se traduce a un código del contrato.
    if (error) throw new ErrorApi('error_interno', { causa: error })

    // Auditoría del EFECTO, además de la del acceso: el guard registra que
    // entró; esto registra qué día tocó.
    await auditar({
      actorId: contexto.userId,
      action: ACCIONES.rollup,
      targetType: 'dia',
      targetId: dia,
      params: { rol: contexto.rol },
    })

    return sobreOk({ dia, recalculado: true as const })
  })
}
