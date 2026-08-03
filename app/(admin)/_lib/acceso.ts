// ============================================================================
// B19 · Quién entra al centro de mando, y el registro de que lo intentó
//
// ── LA REGLA QUE NO SE NEGOCIA ─────────────────────────────────────────────
// El rol se lee de `public.admin_roles` en Postgres, a través de la función
// `security definer` `tiene_rol_admin()`. NO hay lista de correos, ni de
// dominios, ni de uuids, ni aquí ni en ninguna variable de entorno.
//
// El proyecto hermano (Pod_PilotSimulator) resuelve esto con `isAdminEmail`.
// Aquí eso es imposible y además sería peligroso:
//
//   · En Darma un correo NO identifica a nadie. Vive en `identity_vault`, la
//     tabla sin ninguna política RLS, y ni siquiera este bloque debe mirarla.
//     Una allowlist de correos exigiría des-anonimizar para autorizar.
//   · Una lista en código convierte cada cambio de permisos en un DESPLIEGUE,
//     y un despliegue no deja registro de auditoría: no hay forma de responder
//     «¿quién tenía acceso el martes?» leyendo un git log de otra persona.
//   · Una lista en una variable de entorno es peor todavía: se cambia desde un
//     panel, sin revisión, sin registro y sin que nadie se entere.
//
// ── POR QUÉ ESTE MÓDULO NO DECIDE NADA POR SÍ MISMO ────────────────────────
// `cumpleRol()` es PURA y existe para pintar la interfaz (qué pestañas se ven).
// La decisión REAL la toma Postgres dentro de `tiene_rol_admin()`, con el
// cliente `service_role`, en `app/api/admin/_guard.ts`. Ocultar una pestaña es
// cosmética; la comprobación vuelve a ocurrir en cada ruta y en cada página.
// ============================================================================

// Ruta relativa y no el alias `@/` (CONTRATOS §1) por el mismo motivo que en
// `dashboard.ts`: `node --test --experimental-strip-types` no resuelve el
// alias, y las pruebas de la jerarquía de roles tienen que poder importar este
// módulo sin arrancar Next. Importarlo NO construye ningún cliente ni lee
// ninguna variable de entorno: `createAdminClient()` es una función y no hace
// nada hasta que alguien la llama (ver la cabecera de ese archivo).
import { createAdminClient } from '../../../lib/supabase/admin.ts'

/** Los cuatro roles, en orden ASCENDENTE de poder. */
export type RolAdmin = 'soporte' | 'moderador' | 'operaciones' | 'superadmin'

/**
 * La jerarquía, en el mismo orden que el enum `public.admin_role`.
 *
 * ⚠️ Este array y el enum de Postgres tienen que decir lo mismo. Postgres
 * compara los enum por posición de declaración, así que `role >= p_minimo`
 * dentro de `tiene_rol_admin()` usa exactamente este orden. Si se añade un rol
 * en la base hay que añadirlo aquí, en la misma posición.
 */
export const ORDEN_ROLES: readonly RolAdmin[] = [
  'soporte',
  'moderador',
  'operaciones',
  'superadmin',
] as const

export interface ContextoAdmin {
  userId: string
  rol: RolAdmin
}

/** ¿Es este valor uno de los cuatro roles? Guarda de tipo para lo que vuelve de la base. */
export function esRolAdmin(valor: unknown): valor is RolAdmin {
  return typeof valor === 'string' && (ORDEN_ROLES as readonly string[]).includes(valor)
}

/**
 * ¿`rol` alcanza el mínimo `minimo`? PURA — aquí viven las pruebas.
 *
 * Espejo exacto de `ar.role >= p_minimo` en `tiene_rol_admin()`.
 */
export function cumpleRol(rol: RolAdmin, minimo: RolAdmin): boolean {
  return ORDEN_ROLES.indexOf(rol) >= ORDEN_ROLES.indexOf(minimo)
}

/**
 * Rol efectivo de una persona, o `null`.
 *
 * Un rol con `revoked_at` no nulo NO cuenta: eso lo filtra la propia función de
 * Postgres, no este código, para que la regla siga valiendo aunque alguien
 * consulte la tabla desde otro sitio.
 */
export async function obtenerRolAdmin(userId: string): Promise<RolAdmin | null> {
  if (typeof userId !== 'string' || userId.trim() === '') return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rol_admin_actual', { p_user: userId })

  // Falla CERRADO. Si la base no contesta, nadie es admin: un panel que se
  // abriera porque la consulta de permisos falló es exactamente el fallo que
  // este archivo existe para evitar.
  if (error) return null

  return esRolAdmin(data) ? data : null
}

/**
 * Comprobación de acceso REAL, dentro de Postgres.
 *
 * Se usa además de `cumpleRol()` —que ya tendría la respuesta— porque la
 * autoridad está en la base (ARCHITECTURE §0) y porque así el camino de
 * decisión es el mismo que auditaría cualquiera leyendo solo el esquema.
 */
export async function tieneRolAdmin(userId: string, minimo: RolAdmin): Promise<boolean> {
  if (typeof userId !== 'string' || userId.trim() === '') return false

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('tiene_rol_admin', {
    p_user: userId,
    p_minimo: minimo,
  })

  if (error) return false
  return data === true
}

export interface EntradaAuditoria {
  actorId: string
  action: string
  targetType?: string
  targetId?: string
  params?: Record<string, string | number | boolean | null>
}

/**
 * Escribe una línea en `admin_audit_log`.
 *
 * ── QUÉ NO PUEDE LLEVAR `params` ──────────────────────────────────────────
 * Ni el cuerpo de un post, ni un alias, ni un país, ni nada de
 * `identity_vault`. Son los PARÁMETROS de la acción administrativa (qué día se
 * recalculó, qué rol se concedió), no el contenido sobre el que se actuó.
 *
 * ── POR QUÉ NO LANZA ───────────────────────────────────────────────────────
 * Si la auditoría falla, el acceso NO debe abrirse ni cerrarse por eso: el
 * guard ya decidió. Lanzar aquí convertiría un fallo de escritura del registro
 * en un 500 que le dice a quien lo provocó que algo interno se ha roto. Se
 * registra en el log del servidor y se sigue. La contrapartida —una acción sin
 * su línea de auditoría— es real, y por eso la escritura va por
 * `admin_auditar()`, que valida y levanta excepción dentro de Postgres en vez
 * de fallar en silencio.
 */
export async function auditar(entrada: EntradaAuditoria): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc('admin_auditar', {
      p_actor: entrada.actorId,
      p_action: entrada.action,
      p_target_type: entrada.targetType ?? null,
      p_target_id: entrada.targetId ?? null,
      p_params: entrada.params ?? {},
    })
    if (error) {
      console.error('[darma][admin] no se pudo auditar', {
        action: entrada.action,
        code: error.code,
      })
    }
  } catch (causa) {
    console.error('[darma][admin] no se pudo auditar', {
      action: entrada.action,
      causa: causa instanceof Error ? causa.name : 'desconocida',
    })
  }
}

/** Acciones auditadas. Constantes para que no haya dos escrituras del mismo
 *  nombre con distinta ortografía y la consulta forense se pierda una. */
export const ACCIONES = {
  panel: 'admin.panel',
  metricas: 'admin.metricas',
  rollup: 'admin.rollup',
  rolesLista: 'admin.roles.lista',
  rolesConceder: 'admin.roles.conceder',
  rolesRevocar: 'admin.roles.revocar',
  /** El que de verdad importa: alguien intentó entrar y no pudo. */
  denegado: 'admin.denegado',
} as const
