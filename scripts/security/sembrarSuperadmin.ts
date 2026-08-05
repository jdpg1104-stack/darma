// ============================================================================
// El primer superadministrador — el arranque que faltaba
//
//   node --experimental-strip-types scripts/security/sembrarSuperadmin.ts --seco
//   node --experimental-strip-types scripts/security/sembrarSuperadmin.ts
//
// ── EL PROBLEMA DE ARRANQUE, Y POR QUÉ NO ES UN DESCUIDO ──────────────────
// `admin_conceder_rol()` exige ser YA `superadmin` para conceder un rol
// (0191_1_b19_admin.sql). Eso es correcto y deliberado: sin esa regla,
// cualquiera con `service_role` se autoconcede permisos y la tabla de roles deja
// de significar nada. Pero deja `admin_roles` VACÍA el día 1, y con ella vacía
// `/moderacion` y `/panel` devuelven 403 a todo el mundo — incluido quien tiene
// que atender la cola de crisis.
//
// `lib/ai/acceso.ts` describe la solución: «un script de bootstrap ejecutado a
// mano con service_role, que lee esta variable, inserta el superadmin inicial y
// deja su línea en admin_audit_log». Ese script es este. Hasta hoy no existía,
// así que la descripción hablaba de algo que nadie podía ejecutar.
//
// ── POR QUÉ SIGUE SIENDO UN SCRIPT A MANO Y NO UN CRON ────────────────────
// Porque conceder el primer permiso total sobre una red de salud mental no debe
// poder ocurrir sin que una persona lo teclee. Automatizarlo convertiría una
// variable de entorno mal puesta en una escalada de privilegios silenciosa.
//
// ── IDEMPOTENTE, Y NO CONCEDE A CIEGAS ────────────────────────────────────
// Si ya existe algún `superadmin` activo, NO hace nada y lo dice: el arranque
// ocurre una vez, y volver a ejecutarlo no debe poder ampliar el círculo.
// ============================================================================

import { createClient } from '@supabase/supabase-js'

import { parsearSemillaSuperadmin } from '../../lib/ai/acceso.ts'

const seco = new Set(process.argv.slice(2)).has('--seco')

async function principal(): Promise<void> {
  const semilla = parsearSemillaSuperadmin(process.env.SUPERADMIN_SEED_IDS)

  if (semilla.size === 0) {
    console.error(
      'Falta SUPERADMIN_SEED_IDS. Pon el uuid del perfil que será el primer\n' +
        'superadministrador (el `id` de public.profiles, que es el mismo que el\n' +
        'de auth.users). Se admiten varios separados por coma o espacio.',
    )
    process.exitCode = 1
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
    process.exitCode = 1
    return
  }

  const db = createClient(url, clave, { auth: { persistSession: false } })

  // ── ¿Ya hay alguien? ──
  const { data: yaHay, error: errorConsulta } = await db
    .from('admin_roles')
    .select('user_id')
    .eq('role', 'superadmin')
    .is('revoked_at', null)
    .limit(1)

  if (errorConsulta) {
    console.error('No se pudo leer admin_roles:', errorConsulta.code ?? 'error')
    process.exitCode = 1
    return
  }

  if ((yaHay ?? []).length > 0) {
    console.warn(
      'Ya existe al menos un superadministrador ACTIVO. No se hace nada.\n' +
        'El arranque ocurre una sola vez; los demás roles se conceden desde /panel/roles,\n' +
        'que es donde quedan auditados.',
    )
    return
  }

  // ── Que los perfiles existan de verdad ──
  const ids = [...semilla]
  const { data: perfiles } = await db.from('profiles').select('id, alias').in('id', ids)
  const encontrados = new Map((perfiles ?? []).map((p) => [p.id as string, p.alias as string]))

  const fantasmas = ids.filter((id) => !encontrados.has(id))
  if (fantasmas.length > 0) {
    // No se concede a un uuid que no existe: sería una fila muerta en la tabla
    // que decide quién manda, y nadie la revisaría después.
    console.error('Estos ids NO existen en profiles y no se concede nada:')
    for (const id of fantasmas) console.error(`  · ${id}`)
    process.exitCode = 1
    return
  }

  console.warn(`Se concederá 'superadmin' a ${ids.length} perfil(es):`)
  for (const id of ids) console.warn(`  · ${id}  ${encontrados.get(id) ?? ''}`)

  if (seco) {
    console.warn('\n--seco: no se ha escrito nada.')
    return
  }

  // `granted_by` apunta al propio concedido: es la verdad —nadie se lo dio— y
  // deja el arranque distinguible de una concesión normal en la auditoría.
  const filas = ids.map((id) => ({ user_id: id, role: 'superadmin', granted_by: id }))
  const { error: errorInsert } = await db.from('admin_roles').insert(filas)
  if (errorInsert) {
    console.error('No se pudo conceder:', errorInsert.code ?? 'error')
    process.exitCode = 1
    return
  }

  const auditoria = ids.map((id) => ({
    actor_id: id,
    action: 'admin.bootstrap.superadmin',
    target_type: 'admin_role',
    target_id: id,
  }))
  const { error: errorAuditoria } = await db.from('admin_audit_log').insert(auditoria)
  if (errorAuditoria) {
    // El rol YA está concedido. Que falle la auditoría es grave y hay que
    // decirlo, pero revertir dejaría el sistema otra vez sin nadie que modere.
    console.error(
      '⚠️ Rol concedido, pero la línea de auditoría NO se escribió:',
      errorAuditoria.code ?? 'error',
      '\nAnótalo a mano: hay una concesión de superadmin sin rastro.',
    )
    process.exitCode = 1
    return
  }

  console.warn('\nHecho. A partir de aquí, los roles se conceden desde /panel/roles.')
}

await principal()
