// ============================================================================
// /panel/roles — quién tiene acceso al centro de mando. SERVER COMPONENT.
// Rol mínimo: `superadmin`.
//
// SOLO LECTURA a propósito. Conceder y revocar se hacen por `/api/admin/roles`,
// que valida con zod, aplica rate limiting y audita. Un formulario aquí sería
// un cuarto camino para cambiar permisos, y cuantos menos caminos tenga eso,
// mejor.
//
// ── LO QUE SE VE Y LO QUE NO ───────────────────────────────────────────────
// uuids y fechas. Ni alias, ni nada de `identity_vault`. Un panel de permisos
// no necesita saber cómo se llama nadie: necesita saber quién puede entrar.
//
// ── POR QUÉ SE MUESTRAN TAMBIÉN LOS REVOCADOS ──────────────────────────────
// Porque la pregunta que se hace después de un incidente no es «¿quién tiene
// acceso?», es «¿quién LO TENÍA el martes?». Revocar es un `update` de
// `revoked_at`, nunca un `delete`, justo para poder contestarla.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { fecha } from '../../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface FilaRol {
  user_id: string
  role: string
  granted_by: string | null
  granted_at: string
  revoked_at: string | null
}

export default async function PaginaRoles() {
  await requireAdmin('superadmin', { accion: ACCIONES.rolesLista })

  const admin = createAdminClient()
  const { data } = await admin
    .from('admin_roles')
    .select('user_id, role, granted_by, granted_at, revoked_at')
    .order('granted_at', { ascending: false })
    .limit(200)

  const filas = (data ?? []) as FilaRol[]

  return (
    <section>
      <h1>Roles del centro de mando</h1>
      <p>
        La única fuente de verdad es la tabla <code>admin_roles</code> en Postgres. No hay
        ninguna lista de correos ni de uuids en el código ni en el entorno, y no debe haberla:
        una lista en código convierte cada cambio de permisos en un despliegue sin registro.
      </p>
      <p>
        Para conceder o revocar, <code>POST</code> y <code>DELETE</code> sobre{' '}
        <code>/api/admin/roles</code>. Nadie puede cambiar su propio rol, y el sistema no se
        deja quedar sin ningún superadministrador activo: las dos reglas se aplican dentro de
        la base de datos, no en esta pantalla.
      </p>

      <TablaSerie
        titulo="Roles concedidos (los revocados también se conservan)"
        columnas={[
          { clave: 'userId', etiqueta: 'Persona' },
          { clave: 'rol', etiqueta: 'Rol' },
          { clave: 'estado', etiqueta: 'Estado' },
          { clave: 'concedidoEn', etiqueta: 'Concedido' },
          { clave: 'concedidoPor', etiqueta: 'Por' },
        ]}
        filas={filas.map((f) => ({
          userId: f.user_id,
          rol: f.role,
          estado: f.revoked_at ? `Revocado el ${fecha(f.revoked_at)}` : 'Activo',
          concedidoEn: fecha(f.granted_at),
          concedidoPor: f.granted_by ?? '—',
        }))}
      />
    </section>
  )
}
