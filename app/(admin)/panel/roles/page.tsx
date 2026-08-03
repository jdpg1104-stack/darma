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

import { obtenerTraductor, resolverLocale } from '@/i18n'
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

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const { data } = await admin
    .from('admin_roles')
    .select('user_id, role, granted_by, granted_at, revoked_at')
    .order('granted_at', { ascending: false })
    .limit(200)

  const filas = (data ?? []) as FilaRol[]

  return (
    <section>
      <h1>{t('admin.roles.titulo')}</h1>
      <p>
        {t('admin.roles.fuenteVerdad1')} <code>admin_roles</code>{' '}
        {t('admin.roles.fuenteVerdad2')}
      </p>
      <p>
        {t('admin.roles.concederRevocar1')} <code>POST</code>{' '}
        {t('admin.roles.concederRevocar2')} <code>DELETE</code>{' '}
        {t('admin.roles.concederRevocar3')} <code>/api/admin/roles</code>.{' '}
        {t('admin.roles.concederRevocar4')}
      </p>

      <TablaSerie
        titulo={t('admin.roles.tablaTitulo')}
        columnas={[
          { clave: 'userId', etiqueta: t('admin.roles.colPersona') },
          { clave: 'rol', etiqueta: t('admin.roles.colRol') },
          { clave: 'estado', etiqueta: t('admin.roles.colEstado') },
          { clave: 'concedidoEn', etiqueta: t('admin.roles.colConcedido') },
          { clave: 'concedidoPor', etiqueta: t('admin.roles.colPor') },
        ]}
        filas={filas.map((f) => ({
          userId: f.user_id,
          rol: f.role,
          estado: f.revoked_at
            ? t('admin.roles.revocadoEl', { fecha: fecha(f.revoked_at) })
            : t('admin.roles.activo'),
          concedidoEn: fecha(f.granted_at),
          concedidoPor: f.granted_by ?? '—',
        }))}
      />
    </section>
  )
}
