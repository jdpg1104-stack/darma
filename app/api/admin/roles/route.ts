// ============================================================================
// /api/admin/roles — conceder, revocar y listar. Solo `superadmin`.
//
// ── LAS DOS REGLAS DE NEGOCIO NO ESTÁN AQUÍ ───────────────────────────────
// «Nadie cambia su propio rol» y «no se puede revocar al último superadmin
// activo» viven dentro de `admin_conceder_rol()` y `admin_revocar_rol()`, en
// Postgres. Esta ruta solo las TRADUCE a códigos del contrato.
//
// El motivo es ARCHITECTURE §0: cualquier ruta de este bloque tiene el cliente
// `service_role` en la mano, así que una regla que solo viva en un `if` de
// TypeScript se salta escribiendo otro `if`. En la base no.
//
// ── POR QUÉ REVOCAR ES UN UPDATE Y NUNCA UN DELETE ────────────────────────
// Quién tuvo acceso y cuándo lo perdió es parte del registro. Borrar la fila
// borra la respuesta a «¿quién podía ver esto el día del incidente?», que es
// exactamente la pregunta que se hace después de un incidente.
//
// ── ANONIMATO ──────────────────────────────────────────────────────────────
// La lista devuelve uuids y fechas. Ni alias, ni nada de `identity_vault`.
// ============================================================================

import { z } from 'zod'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../_guard.ts'
import { ACCIONES, auditar, ORDEN_ROLES } from '@/app/(admin)/_lib/acceso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Uuid = z.string().uuid()
const Rol = z.enum(ORDEN_ROLES as unknown as [string, ...string[]])

const CuerpoAlta = z.object({ userId: Uuid, rol: Rol }).strict()
const CuerpoBaja = z.object({ userId: Uuid }).strict()

/**
 * Traduce el error de una de las dos funciones de Postgres.
 *
 * Es el único punto donde se mira un mensaje de plpgsql, y ese mensaje NO sale
 * de aquí: entra un error de Postgres, sale un código del contrato. Los textos
 * comparados son los que lanzan nuestras propias funciones en la migración
 * 0191, no mensajes del motor.
 */
function traducir(error: { message?: string; code?: string } | null): never {
  const mensaje = error?.message ?? ''
  if (mensaje.includes('rol_propio')) {
    // Cambiarse el rol a uno mismo NO es un error de validación: es una acción
    // prohibida, y como tal se devuelve 403.
    throw new ErrorApi('sin_permiso')
  }
  if (mensaje.includes('ultimo_superadmin')) {
    // Se lanza tanto al revocar al último superadmin como al DEGRADARLO, que
    // deja el sistema igual de muerto por otro camino.
    throw new ErrorApi('entrada_invalida', {
      mensaje: 'No se puede dejar el sistema sin ningún superadministrador activo.',
    })
  }
  if (mensaje.includes('sujeto_inexistente')) throw new ErrorApi('no_encontrado')
  if (mensaje.includes('rol_inexistente')) throw new ErrorApi('no_encontrado')
  if (mensaje.includes('sin_permiso')) throw new ErrorApi('sin_permiso')
  throw new ErrorApi('error_interno', { causa: error })
}

async function leerCuerpo(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ErrorApi('entrada_invalida')
  }
}

// ── GET · lista de roles vigentes y revocados ───────────────────────────────
export async function GET() {
  return manejarRuta(async () => {
    await requireAdmin('superadmin', { limite: 'lectura', accion: ACCIONES.rolesLista })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('admin_roles')
      .select('user_id, role, granted_by, granted_at, revoked_at')
      .order('granted_at', { ascending: false })
      .limit(200)

    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk({
      roles: (data ?? []).map((f) => ({
        userId: f.user_id as string,
        rol: f.role as string,
        concedidoPor: (f.granted_by as string | null) ?? null,
        concedidoEn: f.granted_at as string,
        revocadoEn: (f.revoked_at as string | null) ?? null,
      })),
    })
  })
}

// ── POST · conceder o cambiar ───────────────────────────────────────────────
export async function POST(request: Request) {
  return manejarRuta(async () => {
    const contexto = await requireAdmin('superadmin', {
      limite: 'roles',
      accion: ACCIONES.rolesConceder,
    })

    const analisis = CuerpoAlta.safeParse(await leerCuerpo(request))
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    const admin = createAdminClient()
    const { error } = await admin.rpc('admin_conceder_rol', {
      p_actor: contexto.userId,
      p_sujeto: analisis.data.userId,
      p_rol: analisis.data.rol,
    })

    if (error) {
      // Un intento fallido de repartir permisos es exactamente lo que hay que
      // poder ver luego. Se audita antes de traducir el error.
      await auditar({
        actorId: contexto.userId,
        action: ACCIONES.denegado,
        targetType: 'usuario',
        targetId: analisis.data.userId,
        params: { intento: ACCIONES.rolesConceder, rol: analisis.data.rol },
      })
      traducir(error)
    }

    await auditar({
      actorId: contexto.userId,
      action: ACCIONES.rolesConceder,
      targetType: 'usuario',
      targetId: analisis.data.userId,
      params: { rol: analisis.data.rol },
    })

    return sobreOk({ userId: analisis.data.userId, rol: analisis.data.rol })
  })
}

// ── DELETE · revocar (update de revoked_at, nunca delete) ───────────────────
export async function DELETE(request: Request) {
  return manejarRuta(async () => {
    const contexto = await requireAdmin('superadmin', {
      limite: 'roles',
      accion: ACCIONES.rolesRevocar,
    })

    const analisis = CuerpoBaja.safeParse(await leerCuerpo(request))
    if (!analisis.success) throw new ErrorApi('entrada_invalida')

    const admin = createAdminClient()
    const { error } = await admin.rpc('admin_revocar_rol', {
      p_actor: contexto.userId,
      p_sujeto: analisis.data.userId,
    })

    if (error) {
      await auditar({
        actorId: contexto.userId,
        action: ACCIONES.denegado,
        targetType: 'usuario',
        targetId: analisis.data.userId,
        params: { intento: ACCIONES.rolesRevocar },
      })
      traducir(error)
    }

    await auditar({
      actorId: contexto.userId,
      action: ACCIONES.rolesRevocar,
      targetType: 'usuario',
      targetId: analisis.data.userId,
    })

    return sobreOk({ userId: analisis.data.userId, revocado: true as const })
  })
}
