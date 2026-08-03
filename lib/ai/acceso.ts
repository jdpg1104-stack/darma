// ============================================================================
// B11 · Quién es moderador — LO DECIDE POSTGRES, igual que en B19
//
// El panel `/moderacion` y cuatro de las cinco rutas exigen rol de moderador
// comprobado EN EL SERVIDOR. Un flag en el cliente no es un permiso: la anon
// key de Supabase es pública y cualquiera puede hablar con PostgREST
// directamente (ARCHITECTURE §0).
//
// ── LO QUE HABÍA, Y POR QUÉ ESTABA MAL ─────────────────────────────────────
// Este módulo decidía quién era moderador con una allowlist de uuids en la
// variable de entorno `MODERATION_ADMIN_IDS`. B19 —el centro de mando— decide
// lo mismo leyendo `public.admin_roles` a través de `tiene_rol_admin()`. Dos
// sistemas de autorización para la misma pregunta, y la consecuencia no era
// teórica: alguien en la variable pero sin fila en la tabla podía moderar y
// recibía un 404 del panel, y al revés. La respuesta a «¿quién es moderador?»
// dependía de por qué puerta se entrase.
//
// Manda `tiene_rol_admin()`. Los tres motivos, escritos aquí para que nadie
// tenga que ir a buscarlos cuando le tiente volver a la variable:
//
//   · UNA LISTA EN EL ENTORNO NO SE PUEDE AUDITAR. Se cambia desde un panel de
//     Vercel, sin revisión, sin registro y sin que nadie se entere. No hay
//     forma de responder «¿quién tenía acceso el martes, y quién se lo dio?».
//     `admin_roles` guarda `granted_by` y `granted_at`, cada concesión pasa por
//     `admin_conceder_rol()`, y hasta los intentos DENEGADOS quedan en
//     `admin_audit_log`.
//   · NO SE PUEDE REVOCAR SIN DESPLEGAR. Quitar a alguien de la variable exige
//     un despliegue: minutos, en el peor momento posible, que es justo cuando
//     hay que retirarle el acceso a alguien deprisa. `revoked_at` surte efecto
//     en la siguiente petición.
//   · NO DISTINGUE NIVELES. La variable es un booleano disfrazado. La tabla
//     tiene cuatro roles ordenados (`soporte` < `moderador` < `operaciones` <
//     `superadmin`), y la moderación exige `moderador`, no «estar en la lista».
//
// Y uno más, propio de Darma: una allowlist de identificadores invita a que un
// día alguien la rellene con correos, y en Darma un correo vive en
// `identity_vault`. Autorizar por correo obligaría a des-anonimizar para
// autorizar.
//
// ── LA VARIABLE DE ENTORNO: SOLO SEMILLA ───────────────────────────────────
// Sobrevive `parsearSemillaSuperadmin()`, y solo para arrancar el primer
// superadministrador. NO la consulta nadie para autorizar, y no debe hacerlo.
//
// ── POR QUÉ ESTE MÓDULO SIGUE EXISTIENDO ───────────────────────────────────
// Como punto único donde se dice QUÉ ROL MÍNIMO exige la moderación. La
// comprobación en sí es la de B19, no una segunda: reimplementar aquí la
// llamada a la RPC nos devolvería a tener dos sistemas.
//
// Ruta relativa y no el alias `@/` a propósito: `node --test
// --experimental-strip-types` no resuelve el alias, y las pruebas de B11 tienen
// que poder importar este módulo sin arrancar Next. Importar
// `app/(admin)/_lib/acceso.ts` NO construye ningún cliente ni lee ninguna
// variable de entorno: `createAdminClient()` es una función y no hace nada
// hasta que alguien la llama.
// ============================================================================

import { tieneRolAdmin, type RolAdmin } from '../../app/(admin)/_lib/acceso.ts'

/**
 * El rol mínimo que exige la moderación.
 *
 * `operaciones` y `superadmin` lo alcanzan por jerarquía —`cumpleRol()` y
 * `tiene_rol_admin()` comparan `>=`, no `=`—. `soporte` no: puede mirar el
 * panel, no puede resolver un flag ni atender una crisis.
 */
export const ROL_MINIMO_MODERACION: RolAdmin = 'moderador'

/**
 * ¿Puede esta persona moderar? La decisión la toma Postgres.
 *
 * ASÍNCRONA, y no puede no serlo: la fuente de verdad es una tabla. Es el
 * precio de que el permiso sea auditable y revocable en caliente, y es el
 * precio correcto.
 *
 * FALLA CERRADO en todos los casos: sin userId, con el rol revocado, o si la
 * base no contesta (`tieneRolAdmin()` devuelve false ante un error de la RPC).
 * Un panel que se abriera porque la consulta de permisos falló es exactamente
 * el fallo que este archivo existe para evitar.
 */
export async function esModerador(userId: string): Promise<boolean> {
  return tieneRolAdmin(userId, ROL_MINIMO_MODERACION)
}

/**
 * Parsea `MODERATION_ADMIN_IDS`. PURA.
 *
 * ⚠️ ESTO NO AUTORIZA A NADIE Y NO DEBE USARSE PARA AUTORIZAR. No lo llama
 * `esModerador()`, ni el guard de B19, ni ninguna ruta. Si algún día vuelve a
 * aparecer en un camino de decisión, es una regresión.
 *
 * Su único uso legítimo es la SEMILLA DEL PRIMER SUPERADMINISTRADOR.
 * `admin_roles` tiene un problema de arranque —`admin_conceder_rol()` exige ser
 * ya `superadmin` para conceder— y la primera fila tiene que entrar por algún
 * sitio. Ese sitio es un script de bootstrap ejecutado a mano con
 * `service_role`, que lee esta variable, inserta el `superadmin` inicial y deja
 * su línea en `admin_audit_log`. A partir de ahí la variable es irrelevante:
 * los demás roles se conceden desde el panel y quedan registrados.
 *
 * Se conserva la función —y no solo la variable— para que ese script no vuelva
 * a escribir el parseo por su cuenta con otras reglas de separadores.
 */
export function parsearSemillaSuperadmin(valor: string | undefined): ReadonlySet<string> {
  if (!valor) return new Set<string>()
  return new Set(
    valor
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  )
}
