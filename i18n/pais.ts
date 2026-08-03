// ============================================================================
// B17 · Resolución del PAÍS — deliberadamente separada del idioma
//
// Orden:
//   1. Cookie `darma_pais`, si la persona lo eligió a mano. Va primero porque
//      quien está de viaje o detrás de una VPN sabe mejor que el edge dónde
//      está, y en una pantalla de crisis el que manda es el humano.
//   2. Cabecera geográfica del edge (`x-vercel-ip-country`).
//   3. `null` → recursos INTERNACIONALES. Nunca el número de otro país.
//
// ── EL PAÍS ES DATO SENSIBLE EN UNA APP ANÓNIMA ────────────────────────────
// (CONTRATOS §2, ficha B17 §Seguridad). Se resuelve, se usa y se descarta en la
// misma petición:
//   · NO se escribe en ningún log.
//   · NO sale en ninguna respuesta de API.
//   · NO viaja como prop a un componente cliente.
//   · NO se asocia al userId en ningún sitio que no sea `crisis_events.
//     country_code` (que es de B11 y está protegido por ausencia de RLS).
// `identity_vault.country_code` existe pero solo lo ve `service_role`: no lo
// leas desde aquí ni desde ninguna ruta de API.
// ============================================================================

import { COOKIE_PAIS } from './routing.ts'

/** ISO-3166-1 alfa-2 en MAYÚSCULAS. */
export type CodigoPais = string

/** Cabecera geográfica del edge de Vercel. La pone la plataforma, no el cliente. */
export const CABECERA_PAIS_EDGE = 'x-vercel-ip-country'

/**
 * Normaliza y VALIDA un candidato a código de país.
 *
 * La forma (`^[A-Za-z]{2}$`) es lista blanca por construcción: `__proto__`,
 * `constructor` y cualquier otra cosa larga o rara caen aquí, antes de acercarse
 * a un índice de objeto. El mapa de recursos vuelve a comprobarlo con
 * `Object.hasOwn`, porque una sola defensa es una defensa que alguien quita.
 */
export function normalizarPais(valor: unknown): CodigoPais | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  if (!/^[A-Za-z]{2}$/.test(limpio)) return null

  const mayus = limpio.toUpperCase()
  // `ZZ` es el "desconocido" de ISO-3166 y lo que devuelve el edge cuando no
  // sabe. Tratarlo como país daría una tarjeta vacía; se prefiere el fallback.
  if (mayus === 'ZZ') return null
  return mayus
}

/**
 * Núcleo puro: cookie → cabecera → null. Sin `next/headers`, para poder
 * probarlo y para que una ruta que ya tiene la petición no reimplemente esto.
 */
export function resolverPaisDesde(
  cookiePais: string | null | undefined,
  cabeceraPais: string | null | undefined,
): CodigoPais | null {
  return normalizarPais(cookiePais) ?? normalizarPais(cabeceraPais)
}

/**
 * Resolución completa en servidor. Funciona sin sesión.
 *
 * Devuelve `null` cuando no se puede saber: quien llame debe pasárselo tal cual
 * a `recursosParaPais()`, que ya sabe qué hacer con un `null`. No inventes un
 * país "razonable" a partir del idioma: ese es EL bug que este bloque existe
 * para impedir.
 */
export async function resolverPais(): Promise<CodigoPais | null> {
  const { cookies, headers } = await import('next/headers')
  const [almacenCookies, cabeceras] = await Promise.all([cookies(), headers()])
  return resolverPaisDesde(
    almacenCookies.get(COOKIE_PAIS)?.value,
    cabeceras.get(CABECERA_PAIS_EDGE),
  )
}
