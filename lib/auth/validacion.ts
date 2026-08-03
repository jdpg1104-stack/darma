// ============================================================================
// Validación de las entradas de B01 (zod) y traducción a mensajes humanos
//
// ── POR QUÉ NO SE DEVUELVE EL MENSAJE DE ZOD ───────────────────────────────
// `error.issues[0].message` de un `regex()` incluye la expresión regular
// entera. Devolverla al cliente es contarle a quien está probando el formulario
// exactamente qué caracteres acepta la base de datos, y ese patrón es el mismo
// CHECK que protege `profiles.alias`. Además es un mensaje escrito para quien
// programa, no para quien acaba de llegar a una app de salud mental a las tres
// de la mañana.
//
// Así que cada campo tiene UN mensaje nuestro, escrito una vez, que dice qué
// hacer y no qué falló.
//
// ── EL PATRÓN DEL ALIAS ES UNA COPIA LITERAL DEL CHECK DE 0001 ─────────────
// Si divergen, la app acepta un alias que Postgres rechaza y la persona ve un
// error genérico al final del onboarding, después de haberlo elegido. La copia
// está aquí porque es la frontera entre las dos y no hay forma de importarla.
// ============================================================================

import { z } from 'zod'
import { ErrorApi } from './errores.ts'
import type { Disponibilidad, NivelEntrada } from './session.ts'

/** Copia LITERAL del CHECK de `profiles.alias` en 0001_core.sql. */
export const PATRON_ALIAS = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$/
export const ALIAS_MIN = 3
export const ALIAS_MAX = 24

/** Longitud máxima de un email según RFC 5321. Cortar aquí evita que un cuerpo
 *  de 10 MB llegue a la función de hash. */
export const EMAIL_MAX = 254

const esquemaEmail = z.string().trim().toLowerCase().min(6).max(EMAIL_MAX).email()

const esquemaAlias = z
  .string()
  .trim()
  .min(ALIAS_MIN)
  .max(ALIAS_MAX)
  .regex(PATRON_ALIAS)

const esquemaSemillaAvatar = z.string().trim().regex(/^[0-9a-f]{16}$/)

const esquemaNivelEntrada = z.enum(['animo', 'escucha', 'apoyo'])
const esquemaDisponibilidad = z.enum(['disponible', 'necesito_hablar', 'ausente'])
const esquemaCodigoTotp = z.string().trim().regex(/^\d{6}$/)
const esquemaCodigoRecuperacion = z.string().trim().min(8).max(20)

/** Mensajes de cara a la persona. Explican qué hacer; no regañan y no filtran
 *  ni el patrón ni el nombre de la columna. */
const MENSAJES = {
  email: 'Escribe un correo válido, sin espacios.',
  alias: 'El alias tiene entre 3 y 24 caracteres y admite letras, números, espacios y guion bajo.',
  semillaAvatar: 'Ese avatar no es válido. Vuelve a generarlo.',
  nivelEntrada: 'Elige una de las tres formas de empezar.',
  disponibilidad: 'Ese estado no existe.',
  codigoTotp: 'El código son 6 dígitos.',
  codigoRecuperacion: 'Ese no es un código de recuperación válido.',
  json: 'No hemos podido leer lo que has enviado.',
} as const

function aplicar<T>(esquema: z.ZodType<T>, valor: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(valor)
  if (!resultado.success) {
    // La causa (con el detalle de zod) se queda dentro del ErrorApi para el
    // log; el cuerpo de la respuesta solo lleva `mensaje`.
    throw new ErrorApi('entrada_invalida', { mensaje, causa: resultado.error })
  }
  return resultado.data
}

export function validarEmail(valor: unknown): string {
  return aplicar(esquemaEmail, valor, MENSAJES.email)
}

export function validarAlias(valor: unknown): string {
  return aplicar(esquemaAlias, valor, MENSAJES.alias)
}

export function validarSemillaAvatar(valor: unknown): string {
  return aplicar(esquemaSemillaAvatar, valor, MENSAJES.semillaAvatar)
}

export function validarNivelEntrada(valor: unknown): NivelEntrada {
  return aplicar(esquemaNivelEntrada, valor, MENSAJES.nivelEntrada)
}

export function validarDisponibilidad(valor: unknown): Disponibilidad {
  return aplicar(esquemaDisponibilidad, valor, MENSAJES.disponibilidad)
}

export function validarCodigoTotp(valor: unknown): string {
  return aplicar(esquemaCodigoTotp, valor, MENSAJES.codigoTotp)
}

export function validarCodigoRecuperacion(valor: unknown): string {
  return aplicar(esquemaCodigoRecuperacion, valor, MENSAJES.codigoRecuperacion)
}

/** Cuerpo de PATCH /api/me. Los dos campos son opcionales, pero al menos uno
 *  debe venir: un PATCH vacío que devolviera 200 haría creer a la UI que se
 *  guardó algo. */
export interface ParcheMe {
  disponibilidad?: Disponibilidad
  entryLevel?: NivelEntrada
}

export function validarParcheMe(cuerpo: unknown): ParcheMe {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    throw new ErrorApi('entrada_invalida', { mensaje: MENSAJES.json })
  }
  const entrada = cuerpo as Record<string, unknown>
  const parche: ParcheMe = {}

  if (entrada.disponibilidad !== undefined) {
    parche.disponibilidad = validarDisponibilidad(entrada.disponibilidad)
  }
  if (entrada.entryLevel !== undefined) {
    parche.entryLevel = validarNivelEntrada(entrada.entryLevel)
  }

  if (parche.disponibilidad === undefined && parche.entryLevel === undefined) {
    throw new ErrorApi('entrada_invalida', {
      mensaje: 'No has cambiado nada.',
    })
  }

  // Cualquier otra clave se IGNORA en silencio, no se rechaza: aceptar
  // `alias` o `karmaSpendable` aquí sería la vulnerabilidad de asignación
  // masiva, y rechazar la petición entera rompería a un cliente antiguo que
  // envíe un campo de más.
  return parche
}

/** Lee el cuerpo JSON de una petición sin dejar que un JSON roto se convierta
 *  en un 500. */
export async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { mensaje: MENSAJES.json, causa })
  }
}
