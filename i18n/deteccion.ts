// ============================================================================
// B17 · Resolución del IDIOMA
//
// Orden, exacto y sin excepciones:
//   1. Cookie `darma_idioma`, si contiene un locale de la lista blanca.
//   2. `Accept-Language`, negociado respetando `q=` y recortando la variante
//      regional (`es-419`, `es-MX` → `es`).
//   3. `es`.
//
// ⚠️ ESTO NO DECIDE EL PAÍS. El país es otro eje y vive en `i18n/pais.ts`. Si
// algún día alguien deriva el país de aquí, un hispanohablante en Estados
// Unidos verá el 024 español en una pantalla de crisis. Ver Trampa #2 de la
// ficha B17.
//
// `/ayuda` y `/legal` son públicas en `proxy.ts`: nada de aquí puede asumir que
// hay sesión. No se toca la base de datos, no se lee el perfil.
// ============================================================================

import { LOCALE_POR_DEFECTO, LOCALES, COOKIE_IDIOMA, esLocale, idiomaBase, type Locale } from './routing.ts'

interface PreferenciaIdioma {
  readonly base: string
  readonly q: number
}

/**
 * Parsea `Accept-Language` a preferencias ordenadas por calidad descendente.
 * Tolerante a basura: una cabecera malformada da lista vacía, nunca una
 * excepción. Esta cabecera la controla el cliente entero.
 */
function parsearAcceptLanguage(cabecera: string): readonly PreferenciaIdioma[] {
  const prefs: PreferenciaIdioma[] = []

  for (const trozo of cabecera.split(',')) {
    const [etiquetaBruta, ...parametros] = trozo.split(';')
    const etiqueta = etiquetaBruta.trim()
    if (etiqueta.length === 0) continue

    // `*` significa "lo que sea". No es una preferencia: se ignora y se cae al
    // idioma por defecto, que ya es "lo que sea" desde nuestro lado.
    if (etiqueta === '*') continue

    const base = idiomaBase(etiqueta)
    if (base === null) continue

    let q = 1
    for (const p of parametros) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p)
      if (m) {
        const valor = Number.parseFloat(m[1])
        q = Number.isFinite(valor) ? Math.min(Math.max(valor, 0), 1) : 0
      }
    }
    if (q <= 0) continue // q=0 es un rechazo explícito de ese idioma.

    prefs.push({ base, q })
  }

  // Orden estable: a igual `q` gana el que aparece antes, que es lo que dice
  // RFC 9110. `sort` en V8 ya es estable, pero se deja explícito el porqué.
  return prefs.sort((a, b) => b.q - a.q)
}

/**
 * Negocia `Accept-Language` contra `LOCALES`. NUNCA lanza.
 *
 * @example negociarLocale('en-GB,en;q=0.9,es;q=0.8') // 'en'
 * @example negociarLocale('es-419,es;q=0.9')         // 'es'
 * @example negociarLocale(null)                      // 'es'
 */
export function negociarLocale(acceptLanguage: string | null | undefined): Locale {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.trim().length === 0) {
    return LOCALE_POR_DEFECTO
  }

  try {
    for (const pref of parsearAcceptLanguage(acceptLanguage)) {
      if (esLocale(pref.base)) return pref.base
    }
  } catch {
    // Una cabecera hostil no puede tumbar la pantalla de ayuda.
    return LOCALE_POR_DEFECTO
  }

  return LOCALE_POR_DEFECTO
}

/**
 * Núcleo puro de la resolución: cookie → cabecera → defecto.
 *
 * Se separa de `resolverLocale()` para poder probarlo sin `next/headers` y para
 * que cualquier bloque que ya tenga la petición a mano (una ruta de API, el
 * proxy) pueda reutilizar la MISMA lógica en vez de reimplementarla.
 */
export function resolverLocaleDesde(
  cookieIdioma: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (esLocale(cookieIdioma)) return cookieIdioma
  return negociarLocale(acceptLanguage)
}

/**
 * Resolución completa en servidor. Funciona SIN sesión (la ruta `/ayuda` es
 * pública y es la que más importa).
 *
 * `next/headers` se importa de forma perezosa a propósito: así este módulo se
 * puede cargar en `node --test` sin arrastrar el runtime de Next.
 */
export async function resolverLocale(): Promise<Locale> {
  const { cookies, headers } = await import('next/headers')
  const [almacenCookies, cabeceras] = await Promise.all([cookies(), headers()])
  return resolverLocaleDesde(
    almacenCookies.get(COOKIE_IDIOMA)?.value,
    cabeceras.get('accept-language'),
  )
}

/** Los locales soportados, para pintar el selector sin duplicar la lista. */
export const LOCALES_SOPORTADOS: readonly Locale[] = LOCALES
