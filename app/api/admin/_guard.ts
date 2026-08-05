// ============================================================================
// B19 · El ÚNICO sitio donde se decide si alguien entra al centro de mando
//
// El orden de los pasos no es casual:
//
//   1. `requireSesion()` — sin sesión no hay actor y no hay nada que auditar
//      salvo el intento anónimo, que se registra igual pero sin actor.
//   2. `check_rate_limit` — ANTES de tocar `admin_roles`. Sin esto, alguien sin
//      permiso puede hacer que cada una de sus peticiones ejecute una consulta
//      a la tabla de roles y una escritura en la auditoría: la propia auditoría
//      se convierte en el vector de la denegación de servicio. El límite se
//      aplica a todo el mundo, con permiso o sin él.
//   3. `tiene_rol_admin()` con el cliente `service_role` — la decisión REAL,
//      dentro de Postgres.
//   4. Auditoría — SIEMPRE, concedida o DENEGADA.
//   5. Contexto.
//
// ── POR QUÉ SE AUDITA TAMBIÉN LO DENEGADO ─────────────────────────────────
// Porque es lo único que responde a «¿alguien está probando la puerta?». Un
// `admin.denegado` suelto es una persona que se equivocó de enlace; veinte en
// una hora desde la misma cuenta es un incidente, y sin registro no existe.
//
// ── QUÉ NO DICE EL ERROR ───────────────────────────────────────────────────
// `sin_permiso` es el mismo 403 con el mismo texto para todos los casos: no
// tienes rol, tienes uno insuficiente, tu rol está revocado. Nunca menciona qué
// rol falta, ni que exista una tabla `admin_roles`, ni que el panel exista.
// Quien no puede entrar no debe poder deducir el mapa del sistema por el
// mensaje de error.
// ============================================================================

import { requireSesion } from '@/lib/auth/session'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import {
  ACCIONES,
  auditar,
  obtenerRolAdmin,
  tieneRolAdmin,
  type ContextoAdmin,
  type RolAdmin,
} from '@/app/(admin)/_lib/acceso'

/**
 * Límites del panel. Generosos para el uso humano (un panel se refresca, se
 * navega, se comparte una pestaña) y estrechos para el bucle en la consola.
 */
export const LIMITES_ADMIN = {
  /** Lectura del panel y de las métricas. */
  lectura: { limite: 120, ventanaSegundos: 60 },
  /** Recalcular un día. Es la operación CARA: agrega un día entero de posts,
   *  comentarios y karma. Sin límite, un admin con un `for` en la consola
   *  satura la base para toda la red. */
  rollup: { limite: 10, ventanaSegundos: 300 },
  /** Cambios de rol. Bajo a propósito: son raros y cada uno debería doler un
   *  poco antes de hacerse. */
  roles: { limite: 20, ventanaSegundos: 3600 },
  /**
   * Curar un ítem de contenido. Generoso porque vaciar una cola de 40 es
   * exactamente el uso previsto, y un límite bajo empujaría a la gente de vuelta
   * al SQL a mano — que es el atajo que la pantalla de curación viene a cerrar.
   * Sigue habiendo techo: 200/hora no lo alcanza nadie mirando vídeos, pero sí
   * un script.
   */
  curacion: { limite: 200, ventanaSegundos: 3600 },
} as const

export type AccionAdminLimitada = keyof typeof LIMITES_ADMIN

export interface OpcionesGuard {
  /** Clave del preset de rate limiting. Por defecto, `lectura`. */
  limite?: AccionAdminLimitada
  /** Qué se está haciendo, para la auditoría. */
  accion?: string
}

/**
 * Exige sesión Y rol admin de al menos `minimo`. Audita SIEMPRE.
 *
 * @throws ErrorApi('no_autenticado')        401 — sin sesión
 * @throws ErrorApi('demasiadas_peticiones') 429
 * @throws ErrorApi('sin_permiso')           403 — sin rol, insuficiente o revocado
 */
export async function requireAdmin(
  minimo: RolAdmin,
  opciones: OpcionesGuard = {},
): Promise<ContextoAdmin> {
  const accion = opciones.accion ?? ACCIONES.panel

  // ── 1. Sesión ────────────────────────────────────────────────────────────
  // `requireSesion()` lanza `no_autenticado`. No se audita el intento anónimo
  // con un actor inventado: `admin_audit_log.actor_id` referencia a `profiles`
  // y una fila con actor falso ensucia el registro justo donde tiene que ser
  // fiable. Un anónimo ni siquiera pasa el proxy (ARCHITECTURE §8).
  const sesion = await requireSesion()

  // ── 2. Rate limit, ANTES de mirar el rol ─────────────────────────────────
  const preset = LIMITES_ADMIN[opciones.limite ?? 'lectura']
  const admin = createAdminClient()
  const resultado = await rateLimit({
    key: `admin_${opciones.limite ?? 'lectura'}:${sesion.userId}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: admin,
    // Fail-closed: si la capa distribuida no contesta, se deniega. Es una
    // superficie administrativa; que se caiga por prudencia es aceptable.
    failClosed: true,
  })

  if (!resultado.ok) {
    await auditar({
      actorId: sesion.userId,
      action: ACCIONES.denegado,
      targetType: 'ruta',
      targetId: accion,
      params: { motivo: 'rate_limit', minimo },
    })
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }

  // ── 3. La decisión REAL, en Postgres ─────────────────────────────────────
  const autorizado = await tieneRolAdmin(sesion.userId, minimo)

  if (!autorizado) {
    // ── 4a. Auditoría del DENEGADO ─────────────────────────────────────────
    await auditar({
      actorId: sesion.userId,
      action: ACCIONES.denegado,
      targetType: 'ruta',
      targetId: accion,
      params: { motivo: 'sin_rol', minimo },
    })
    // Mismo mensaje genérico para los tres casos posibles. A propósito.
    throw new ErrorApi('sin_permiso')
  }

  // El rol EFECTIVO se lee después de autorizar: hace falta para recortar la
  // respuesta y pintar las pestañas, pero no para decidir.
  const rol = await obtenerRolAdmin(sesion.userId)
  if (!rol) {
    // Carrera: le revocaron el rol entre las dos consultas. Se deniega.
    await auditar({
      actorId: sesion.userId,
      action: ACCIONES.denegado,
      targetType: 'ruta',
      targetId: accion,
      params: { motivo: 'rol_desaparecido', minimo },
    })
    throw new ErrorApi('sin_permiso')
  }

  // ── 4b. Auditoría del CONCEDIDO ──────────────────────────────────────────
  await auditar({
    actorId: sesion.userId,
    action: accion,
    targetType: 'ruta',
    targetId: accion,
    params: { rol, minimo },
  })

  return { userId: sesion.userId, rol }
}
