'use server'

// ============================================================================
// B17 · Server Actions del selector de idioma y del selector de país
//
// Por qué cookie y no `profiles`: el idioma es una preferencia de DISPOSITIVO,
// no un dato de la persona. Guardarlo en la base sería un atributo más colgando
// de un seudónimo (CONTRATOS §2 mira mal cada campo nuevo del perfil), y encima
// obligaría a una consulta por render para algo que ya viaja en la petición.
//
// El país va en cookie por la misma razón y por una más: es dato SENSIBLE. Se
// escribe porque la persona lo eligió a mano —quien viaja o usa VPN necesita
// corregir lo que dice el edge— y no se asocia a nadie ni se registra en ningún
// log. Ver ficha B17 §Seguridad 1.
// ============================================================================

import { cookies } from 'next/headers'

import {
  COOKIE_IDIOMA,
  COOKIE_PAIS,
  esLocale,
  opcionesCookiePreferencia,
  type Locale,
} from './routing.ts'
import { normalizarPais } from './pais.ts'

/**
 * Fija el idioma de la interfaz.
 *
 * El valor llega de un `<form>` del cliente, así que se valida CONTRA LA LISTA
 * BLANCA antes de escribirlo. La cookie no es `httpOnly` (el selector la lee
 * para pintar su estado), y por eso mismo el servidor no puede confiar en ella:
 * se valida al escribir y se vuelve a validar al leer.
 */
export async function establecerIdioma(valor: unknown): Promise<{ ok: boolean; locale?: Locale }> {
  if (!esLocale(valor)) return { ok: false }
  const almacen = await cookies()
  almacen.set(COOKIE_IDIOMA, valor, opcionesCookiePreferencia())
  return { ok: true, locale: valor }
}

/**
 * Fija a mano el país del que se muestran los recursos de ayuda.
 *
 * `null` borra la preferencia y devuelve el control a la cabecera del edge.
 * Un valor que no sea ISO-3166 alfa-2 se rechaza en silencio: nunca llega a un
 * índice de objeto (`__proto__`, `constructor`) y nunca se registra. La acción
 * NO devuelve el país: no hace falta (el cliente acaba de mandarlo) y así no hay
 * ni una respuesta del servidor que lo lleve dentro.
 */
export async function establecerPais(valor: unknown): Promise<{ ok: boolean }> {
  const almacen = await cookies()

  if (valor === null || valor === '') {
    almacen.delete(COOKIE_PAIS)
    return { ok: true }
  }

  const pais = normalizarPais(valor)
  if (pais === null) return { ok: false }

  almacen.set(COOKIE_PAIS, pais, opcionesCookiePreferencia())
  return { ok: true }
}
