// ============================================================================
// B17 · Barril público de i18n. Lo que consumen los demás bloques.
//
// Importa SIEMPRE desde aquí (`@/i18n`), no desde los módulos internos: así, si
// mañana `obtenerTraductor()` se sustituye por `getTranslations` de next-intl,
// no hay que tocar catorce archivos de otros bloques.
// ============================================================================

import mensajesEs from '../messages/es.json' with { type: 'json' }
import mensajesEn from '../messages/en.json' with { type: 'json' }

import { LOCALE_POR_DEFECTO, esLocale, type Locale } from './routing.ts'
import { formatearIcu, type ParametrosMensaje } from './icu.ts'
import { aplanar, type Catalogo } from './catalogo.ts'

export type { Locale } from './routing.ts'
export type { CodigoPais } from './pais.ts'
export type {
  RecursoCrisis,
  RecursosPais,
  TipoRecurso,
  EntradaDeVerificacion,
} from './recursosCrisis.ts'

export {
  LOCALES,
  LOCALE_POR_DEFECTO,
  COOKIE_IDIOMA,
  COOKIE_PAIS,
  esLocale,
  idiomaBase,
  opcionesCookiePreferencia,
} from './routing.ts'

export { negociarLocale, resolverLocale, resolverLocaleDesde, LOCALES_SOPORTADOS } from './deteccion.ts'
export { resolverPais, resolverPaisDesde, normalizarPais, CABECERA_PAIS_EDGE } from './pais.ts'

export {
  recursosParaPais,
  RECURSOS_POR_PAIS,
  PAISES_SOPORTADOS,
  CLAVE_EMERGENCIAS_LOCALES,
  VENTANA_VERIFICACION_DIAS,
  recursosPendientesDeVerificacion,
  recursosCaducados,
  tablaListaParaProduccion,
  todosLosRecursos,
} from './recursosCrisis.ts'

export { formatearIcu } from './icu.ts'

// ── Catálogos ───────────────────────────────────────────────────────────────

/**
 * Los dos catálogos, en el SERVIDOR. No mandes esto entero al cliente: cuando
 * el catálogo crezca se come él solo el presupuesto de 120 KB por ruta
 * (CONTRATOS §11). Usa `subarbolDeMensajes()`.
 */
export const MENSAJES: Readonly<Record<Locale, Catalogo>> = Object.freeze({
  es: mensajesEs as Catalogo,
  en: mensajesEn as Catalogo,
})

/** Raíces de dominio del catálogo. Estructura por DOMINIO, no por pantalla. */
export const RAICES_DE_DOMINIO = [
  'comun',
  'auth',
  'feed',
  'publicar',
  'hilo',
  'perfil',
  'karma',
  'refugios',
  'ranking',
  'contenido',
  'crisis',
  'moderacion',
  'admin',
  'legal',
  'errores',
] as const

export type RaizDeDominio = (typeof RAICES_DE_DOMINIO)[number]

/**
 * Subárbol de mensajes para una ruta concreta. Es lo que se le pasa a
 * `<NextIntlClientProvider messages={…}>`: solo los dominios que esa pantalla
 * usa, nunca el JSON entero.
 *
 * @example subarbolDeMensajes('es', ['feed', 'comun', 'crisis'])
 */
export function subarbolDeMensajes(
  locale: Locale,
  raices: readonly RaizDeDominio[],
): Catalogo {
  const completo = MENSAJES[locale]
  const salida: Catalogo = {}
  for (const raiz of raices) {
    if (Object.hasOwn(completo, raiz)) salida[raiz] = completo[raiz]
  }
  return salida
}

// ── Traductor ───────────────────────────────────────────────────────────────

const PLANOS: Readonly<Record<Locale, Map<string, string>>> = Object.freeze({
  es: aplanar(mensajesEs as Catalogo),
  en: aplanar(mensajesEn as Catalogo),
})

export type Traductor = (clave: string, params?: ParametrosMensaje) => string

/**
 * Traductor propio, con ICU básico.
 *
 * ⚠️ PROVISIONAL Y A PROPÓSITO. La vía oficial en componentes será
 * `useTranslations` / `getTranslations` de next-intl en cuanto F4 aplique los
 * dos cambios pedidos en HANDOFF/PEDIDOS.md (el plugin en `next.config.ts` y el
 * provider en `app/layout.tsx`). Existe para que B17 cierre en verde sin
 * depender de otra sesión, y para que los guards puedan formatear sin arrancar
 * Next.
 *
 * Una clave que no existe se devuelve TAL CUAL en vez de caer al español: un
 * fallback silencioso deja media app sin traducir para siempre y nadie se
 * entera. Aquí se ve.
 */
export function obtenerTraductor(locale: Locale = LOCALE_POR_DEFECTO): Traductor {
  const plano = PLANOS[esLocale(locale) ? locale : LOCALE_POR_DEFECTO]

  return (clave, params = {}) => {
    const plantilla = plano.get(clave)
    if (plantilla === undefined) return clave
    try {
      return formatearIcu(plantilla, params, locale)
    } catch {
      // Un ICU roto no puede tumbar una pantalla: se pinta la plantilla cruda y
      // el guard de paridad lo caza en CI.
      return plantilla
    }
  }
}

// ── Errores traducibles ─────────────────────────────────────────────────────

/**
 * Códigos de error de CONTRATOS §4. Se declara aquí como tipo LOCAL (CONTRATOS
 * §12.1) porque `lib/apiErrors.ts` —dueño F3— hoy exporta OTRO juego de códigos
 * (`unauthorized`, `pii_detected`, …). Esa divergencia está anotada en
 * HANDOFF/PEDIDOS.md para que la resuelvan B00/F3; mientras tanto, la fuente de
 * verdad para las claves de `messages/*.json` es CONTRATOS, no el código.
 */
export const CODIGOS_DE_ERROR = [
  'no_autenticado',
  'sin_permiso',
  'reciprocidad',
  'no_encontrado',
  'entrada_invalida',
  'demasiadas_peticiones',
  'contenido_bloqueado',
  'saldo_insuficiente',
  'error_interno',
] as const

export type CodigoDeError = (typeof CODIGOS_DE_ERROR)[number]

export function esCodigoDeError(v: unknown): v is CodigoDeError {
  return typeof v === 'string' && (CODIGOS_DE_ERROR as readonly string[]).includes(v)
}

/**
 * Traduce un error de API POR CÓDIGO, nunca por `message`.
 *
 * El `message` del servidor puede llevar detalle que no debe verse (CONTRATOS
 * §4) y además está en un solo idioma. La UI pinta siempre `errores.<code>`.
 *
 * @example traducirCodigoError(cuerpo.code, t, { retryAfter: cuerpo.retryAfter })
 */
export function traducirCodigoError(
  codigo: unknown,
  t: Traductor,
  params: ParametrosMensaje = {},
): string {
  const clave = esCodigoDeError(codigo) ? codigo : 'error_interno'
  return t(`errores.${clave}`, params)
}
