// ============================================================================
// Hash de contacto — el puente entre una persona real y su cuenta anónima
//
// ⛔ SOLO SERVIDOR. Este módulo lee `IDENTITY_PEPPER`, un secreto que jamás
// puede acabar en un bundle de navegador. No lleva `import 'server-only'`
// porque ese paquete no está entre las dependencias del proyecto (ver
// HANDOFF/PEDIDOS.md); en su lugar hay una guarda de runtime, igual que en
// lib/supabase/admin.ts.
//
// ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
// `identity_vault` guarda un hash del contacto, nunca el contacto. Sirve para
// UNA cosa: detectar que dos cuentas pertenecen a la misma persona. Y para eso
// el hash tiene que colisionar exactamente donde el proveedor de correo
// colisiona, porque si no, crear una segunda cuenta es tan fácil como escribir
// un punto de más.
//
// Por eso se normaliza ANTES de hashear:
//   1. trim + toLowerCase          → "  Ana@Gmail.com " ≡ "ana@gmail.com"
//   2. fuera el +tag del local     → "ana+darma@x.com"  ≡ "ana@x.com"
//   3. fuera los puntos del local, SOLO en dominios de Google
//                                  → "a.na@gmail.com"   ≡ "ana@gmail.com"
//
// El punto 3 es el que más se equivoca: Gmail ignora los puntos, pero la
// inmensa mayoría de servidores NO. Aplicar el punto 3 a todos los dominios
// haría colisionar a dos personas distintas de la misma empresa
// ("a.perez@empresa.com" y "aperez@empresa.com"), y esa colisión se traduce en
// una señal de multicuenta contra alguien que no ha hecho nada. En una app de
// salud mental, acusar a la persona equivocada es peor que no detectar nada.
//
// ── ROTACIÓN DE IDENTITY_PEPPER ────────────────────────────────────────────
// ⚠️ LA PIMIENTA NO SE ROTA SIN PLAN DE RE-HASH. El hash es irreversible: si se
// cambia `IDENTITY_PEPPER`, TODOS los `contact_hash` guardados en
// `identity_vault` dejan de corresponder con nada calculable, la detección de
// multicuenta se pone a cero y no hay forma de recomputarlos (no guardamos el
// email, que es justo el objetivo del diseño). Rotarla exige un periodo de
// doble escritura: nueva columna `contact_hash_v2`, rellenada en el siguiente
// inicio de sesión de cada persona —cuando el contacto vuelve a pasar por
// aquí—, y retirada de la vieja cuando la cobertura sea suficiente. Cambiarla
// "porque tocaba rotar secretos" es perder la detección entera en silencio.
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Dominios que ignoran los puntos del local-part. Lista cerrada a propósito:
 *  ampliarla sin comprobarlo en la documentación del proveedor crea colisiones
 *  entre personas distintas. */
const DOMINIOS_SIN_PUNTOS = new Set(['gmail.com', 'googlemail.com'])

function guardaDeServidor(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[darma][SEGURIDAD] lib/auth/identidad.ts se ha cargado en el NAVEGADOR. ' +
      'Este módulo lee IDENTITY_PEPPER. Alguien lo ha importado desde un ' +
      "componente con 'use client': revisa la cadena de imports.",
    )
  }
}

/**
 * Forma canónica de un contacto, para que dos escrituras del mismo buzón
 * produzcan el mismo hash.
 *
 * Exportada porque es la parte comprobable: el hash no se puede verificar a
 * ojo, la normalización sí.
 */
export function normalizarContacto(valorCrudo: string): string {
  const base = valorCrudo.trim().toLowerCase()

  const arroba = base.lastIndexOf('@')
  if (arroba <= 0 || arroba === base.length - 1) {
    // No tiene forma de email (un teléfono, o basura). Se quitan los separadores
    // habituales para que "+34 600 11 22 33" y "+34600112233" coincidan, y se
    // devuelve tal cual: aquí no hay reglas de proveedor que aplicar.
    return base.replace(/[\s.\-()]/g, '')
  }

  let local = base.slice(0, arroba)
  const dominio = base.slice(arroba + 1)

  // El +tag es una convención de subdirección soportada por todos los grandes
  // proveedores: lo que va detrás del + no cambia el buzón de destino.
  const mas = local.indexOf('+')
  if (mas > 0) local = local.slice(0, mas)
  // `mas === 0` (el local empieza por +) se deja intacto: quitarlo dejaría el
  // local vacío y colapsaría cuentas distintas del mismo dominio en un mismo
  // hash, que es exactamente el falso positivo que queremos evitar.

  if (DOMINIOS_SIN_PUNTOS.has(dominio)) {
    local = local.replaceAll('.', '')
  }

  return `${local}@${dominio}`
}

function pimienta(): string {
  // Se lee en cada llamada, no al cargar el módulo: así un test puede cambiarla
  // y comprobar que el hash cambia, y así un despliegue que inyecte la variable
  // tarde no se queda con una cadena vacía congelada en memoria.
  const valor = process.env.IDENTITY_PEPPER
  if (!valor) {
    throw new Error(
      '[darma] Falta IDENTITY_PEPPER. Sin pimienta, el contact_hash sería un ' +
      'SHA-256 de un email: un diccionario de correos comunes lo revierte en ' +
      'segundos y el anonimato de identity_vault deja de existir.',
    )
  }
  return valor
}

/**
 * Hash con pimienta del contacto. 64 caracteres hex (HMAC-SHA256).
 *
 * HMAC y no `sha256(pepper + valor)`: la construcción ingenua es vulnerable a
 * extensión de longitud y, más importante, HMAC es la primitiva que todo el
 * mundo sabe leer sin tener que razonar si está bien construida.
 *
 * Esto NO es una función de derivación de contraseñas (no lleva coste de
 * cómputo) y no debe serlo: se ejecuta en el camino de inicio de sesión y el
 * secreto que protege el valor es la pimienta, no la lentitud.
 */
export function hashContacto(valorCrudo: string): string {
  guardaDeServidor()
  return createHmac('sha256', pimienta()).update(normalizarContacto(valorCrudo), 'utf8').digest('hex')
}

/**
 * Hash de una IP, para claves de rate limit por origen.
 *
 * La IP es un dato personal (CONTRATOS §2 la prohíbe en cualquier respuesta) y
 * además identifica bastante bien a una persona. Como clave de contador no hace
 * falta el valor: basta con que sea estable y no reversible. Se recorta a 32
 * hex porque una clave de `rate_limits` más larga solo ocupa espacio.
 */
export function hashIp(ip: string | null | undefined): string {
  guardaDeServidor()
  const base = (ip ?? 'desconocida').trim().toLowerCase()
  return createHmac('sha256', pimienta()).update(`ip:${base}`, 'utf8').digest('hex').slice(0, 32)
}

/** Comparación en tiempo constante de dos hexadecimales del mismo largo. */
export function hashesIguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Versión enmascarada del contacto para la pantalla de "te hemos enviado el
 * enlace a a***@gmail.com".
 *
 * ⚠️ Se calcula EN MEMORIA a partir de lo que la persona acaba de teclear y se
 * descarta con la respuesta. No se guarda en `profiles`, ni en una cookie, ni
 * en el estado de la sesión: una columna de email en `profiles` rompe el
 * principio 1 de la app entera (ver HANDOFF/README.md).
 */
export function enmascararContacto(valorCrudo: string): string {
  const base = valorCrudo.trim()
  const arroba = base.lastIndexOf('@')
  if (arroba <= 0) return '***'

  const local = base.slice(0, arroba)
  const dominio = base.slice(arroba + 1)
  const visible = local.slice(0, 1)
  return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${dominio}`
}
