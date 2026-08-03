// ============================================================================
// El traductor y el catálogo — SIN NADA DE SERVIDOR.
//
// Este archivo existe separado del barril `i18n/index.ts` por un motivo que
// costó encontrar: el barril reexporta `resolverLocale()` y `resolverPais()`,
// que importan `next/headers`. Un componente de cliente que hiciera
// `import { obtenerTraductor } from '@/i18n'` se llevaba `next/headers` al
// bundle del navegador, donde lanza — y el síntoma no era un error visible sino
// una pantalla congelada en «Cargando…»: la hidratación moría en silencio y el
// componente se quedaba para siempre en su estado previo.
//
// Regla: todo lo que pueda necesitar un componente de cliente vive AQUÍ. El
// barril sigue reexportándolo, así que el código de servidor no cambia.
// ============================================================================

import mensajesEs from '../messages/es.json' with { type: 'json' }
import mensajesEn from '../messages/en.json' with { type: 'json' }

import type { CodigoError } from '../lib/auth/errores.ts'
import { LOCALE_POR_DEFECTO, esLocale, type Locale } from './routing.ts'
import { formatearIcu, type ParametrosMensaje } from './icu.ts'
import { aplanar, type Catalogo } from './catalogo.ts'

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
 * Subárbol de mensajes para una ruta concreta: solo los dominios que esa
 * pantalla usa, nunca el JSON entero.
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
  es: aplanar(MENSAJES.es),
  en: aplanar(MENSAJES.en),
})

export type Traductor = (clave: string, params?: ParametrosMensaje) => string

/**
 * Traductor propio, con ICU básico.
 *
 * Es la vía oficial, no un puente: se evaluó `next-intl` y se descartó. Su
 * aportación aquí habría sido mandar el catálogo por el cable, y el nuestro ya
 * viaja en el bundle como JSON importado estáticamente — el provider solo tiene
 * que decir CUÁL de los dos idiomas usar (ver `i18n/Proveedor.tsx`). Además esto
 * formatea sin arrancar Next, que es lo que permite que los guards de CI y las
 * pruebas lo usen tal cual.
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
 * Los códigos de error de CONTRATOS §4, con una copia en tiempo de ejecución
 * para validar lo que llega por el cable.
 *
 * Va como `Record` sobre `CodigoError` y no como array suelto para que el
 * compilador exija las DOS direcciones: si el servidor gana un código y aquí no
 * se añade, esto no compila; si aquí sobra uno que el servidor no emite,
 * tampoco. La tercera pata —que exista la traducción en los dos idiomas— la
 * cubre el guard de paridad de `i18n/claves.test.ts`.
 *
 * El import es SOLO de tipo, así que no arrastra nada de `lib/auth` al bundle
 * del navegador. Ver la cabecera de este archivo: aquí eso importa.
 */
const DECLARADOS: Readonly<Record<CodigoError, true>> = {
  no_autenticado: true,
  sin_permiso: true,
  reciprocidad: true,
  no_encontrado: true,
  entrada_invalida: true,
  demasiadas_peticiones: true,
  contenido_bloqueado: true,
  saldo_insuficiente: true,
  error_interno: true,
}

export const CODIGOS_DE_ERROR = Object.keys(DECLARADOS) as readonly CodigoError[]

export type CodigoDeError = CodigoError

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
