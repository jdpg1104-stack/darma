// ============================================================================
// B19 · Qué pestañas ve cada rol
//
// Copia la FORMA de `adminNav.ts`/`adminAccess.ts` del proyecto hermano —una
// tabla declarativa de tabs con rol mínimo, resuelta por una función pura— y no
// su fondo: allí el rol sale de un correo, aquí de `admin_roles` en Postgres.
//
// ⚠️ ESTO ES COSMÉTICA. Ocultar una pestaña no protege nada: la ruta se puede
// teclear a mano y la API se puede llamar con `curl`. La comprobación real
// vuelve a ocurrir en `requireAdmin()` en cada ruta y en cada página. Si alguna
// vez alguien borra este archivo entero, el sistema sigue siendo seguro; solo
// se vuelve incómodo.
// ============================================================================

import type { RolAdmin } from './acceso.ts'
import { cumpleRol } from './acceso.ts'

export interface TabAdmin {
  id: string
  ruta: string
  /**
   * CLAVE del catálogo (`messages/*.json`), no el texto. La navegación la pinta
   * un Server Component que ya tiene el traductor; si aquí viviera la cadena en
   * español, la pestaña seguiría en español con la app en inglés y este archivo
   * —que es una tabla de permisos— se convertiría en un archivo de copy.
   */
  etiquetaKey: string
  rolMinimo: RolAdmin
}

/**
 * El reparto de la ficha B19, §7:
 *
 *   soporte     → activación y reciprocidad, solo lectura. NO ve economía ni
 *                 nada individual.
 *   moderador   → lo anterior + crisis + el enlace a /moderacion (de B11).
 *   operaciones → + economía.
 *   superadmin  → + gestión de roles.
 *
 * El orden del array ES el orden visual, y no es alfabético a propósito: la
 * portada primero, y dentro de las secciones el KPI que manda (reciprocidad)
 * antes que lo demás.
 */
export const TABS_ADMIN: readonly TabAdmin[] = [
  { id: 'panel',        ruta: '/panel',              etiquetaKey: 'admin.nav.panel',        rolMinimo: 'soporte' },
  { id: 'reciprocidad', ruta: '/panel/reciprocidad', etiquetaKey: 'admin.nav.reciprocidad', rolMinimo: 'soporte' },
  { id: 'activacion',   ruta: '/panel/activacion',   etiquetaKey: 'admin.nav.activacion',   rolMinimo: 'soporte' },
  { id: 'crisis',       ruta: '/panel/crisis',       etiquetaKey: 'admin.nav.crisis',       rolMinimo: 'moderador' },
  // Propiedad de B11. Este bloque solo enlaza la ruta; no toca su código.
  { id: 'moderacion',   ruta: '/moderacion',         etiquetaKey: 'admin.nav.moderacion',   rolMinimo: 'moderador' },
  // Redacción de encuestas del feed. Sin esta entrada la página no es que
  // estuviera oculta: `puedeVerRuta()` falla cerrado ante rutas desconocidas,
  // así que estaba INACCESIBLE incluso para un superadmin. Es el comportamiento
  // correcto del guard —una página que se olvida de registrarse queda cerrada,
  // no abierta— y por eso registrarla es el paso obligatorio, no un adorno.
  { id: 'encuestas',    ruta: '/encuestas',          etiquetaKey: 'admin.nav.encuestas',    rolMinimo: 'moderador' },
  { id: 'economia',     ruta: '/panel/economia',     etiquetaKey: 'admin.nav.economia',     rolMinimo: 'operaciones' },
  { id: 'roles',        ruta: '/panel/roles',        etiquetaKey: 'admin.nav.roles',        rolMinimo: 'superadmin' },
] as const

/** Pestañas visibles para un rol. PURA. */
export function tabsVisibles(rol: RolAdmin): TabAdmin[] {
  return TABS_ADMIN.filter((tab) => cumpleRol(rol, tab.rolMinimo))
}

/** ¿Puede este rol abrir esta ruta? Se usa en las páginas, no solo en el menú. */
export function puedeVerRuta(rol: RolAdmin, ruta: string): boolean {
  const tab = TABS_ADMIN.find((t) => t.ruta === ruta)
  // Ruta desconocida → NO. Falla cerrado: una página nueva que se olvide de
  // registrarse aquí queda cerrada, no abierta a todo el mundo.
  if (!tab) return false
  return cumpleRol(rol, tab.rolMinimo)
}
