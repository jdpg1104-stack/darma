// ============================================================================
// B17 · Configuración de idioma — SIN prefijo de locale en la URL
//
// `/feed` es `/feed` en los dos idiomas. No hay carpeta `[locale]` ni redirección
// por idioma. Dos razones, y ninguna es estética:
//
//   1. Darma es anónima. Un `/es/` en la URL viaja en cada `Referer`, en cada
//      enlace compartido y en cada captura de pantalla. Es un atributo más sobre
//      la persona que lo comparte, gratis y para siempre.
//   2. `proxy.ts` (dueño F4) lista rutas públicas por prefijo. Un segmento de
//      locale duplicaría esa lista y la primera vez que alguien olvidara añadir
//      `/en/ayuda` a la lista, la pantalla de crisis pediría login. La ruta más
//      importante de la app no puede depender de que nadie se despiste.
//
// El idioma vive en una cookie; el PAÍS vive en otra y se resuelve aparte
// (`i18n/pais.ts`). Son dos ejes distintos y mezclarlos aquí mata gente.
// ============================================================================

/** Locales soportados. `es` es el idioma de origen: se escribe primero ahí. */
export const LOCALES = ['es', 'en'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * Fallback duro. No es "el idioma del proyecto": es lo que se sirve cuando la
 * negociación no da nada. Que sea `es` es una decisión de producto, no técnica.
 */
export const LOCALE_POR_DEFECTO: Locale = 'es'

/**
 * Cookie del idioma. NO es `httpOnly`: el selector la lee en cliente para
 * pintar su propio estado. Por eso el servidor la valida siempre antes de
 * usarla (`esLocale`), en las dos puntas.
 */
export const COOKIE_IDIOMA = 'darma_idioma'

/**
 * Cookie del país elegido a mano. Existe porque quien viaja o usa una VPN
 * necesita poder corregir lo que dice la cabecera del edge: enseñarle a alguien
 * en Madrid el 988 estadounidense es exactamente el fallo que este bloque
 * intenta hacer imposible.
 */
export const COOKIE_PAIS = 'darma_pais'

/** Un año. La preferencia de idioma de un dispositivo no caduca cada sesión. */
export const MAX_AGE_COOKIE_IDIOMA = 60 * 60 * 24 * 365

/**
 * Opciones con las que se escriben AMBAS cookies desde la Server Action.
 * `httpOnly: false` es deliberado y está justificado arriba; `sameSite: 'lax'`
 * porque no hay ningún flujo cross-site legítimo que necesite estas cookies.
 */
export function opcionesCookiePreferencia(): {
  httpOnly: false
  sameSite: 'lax'
  path: '/'
  maxAge: number
  secure: boolean
} {
  return {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_COOKIE_IDIOMA,
    secure: process.env.NODE_ENV === 'production',
  }
}

/**
 * Lista blanca de locales. Se usa sobre TODO valor que venga del cliente
 * (cookie, query, cabecera) antes de que toque un índice de objeto.
 */
export function esLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/**
 * Recorta a idioma base sin variante regional: `es-419`, `es_MX`, `EN-gb` → `es`
 * / `en`. Devuelve `null` si no parece un idioma.
 *
 * ⚠️ Importante para B07/B08: `content_items.language` tiene el check
 * `^[a-z]{2}$` en `0002_comunidad.sql`. Un `es-MX` en esa consulta no devuelve
 * nada y en la ingesta la rechaza el check. Recorta siempre antes de consultar.
 */
export function idiomaBase(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  const base = valor.trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2}$/.test(base) ? base : null
}
