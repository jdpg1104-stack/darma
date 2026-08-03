// ============================================================================
// B17 · Barril público de i18n. Lo que consumen los demás bloques.
//
// Importa SIEMPRE desde aquí (`@/i18n`), no desde los módulos internos: así, si
// mañana `obtenerTraductor()` se sustituye por `getTranslations` de next-intl,
// no hay que tocar catorce archivos de otros bloques.
// ============================================================================

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

export {
  MENSAJES,
  RAICES_DE_DOMINIO,
  subarbolDeMensajes,
  obtenerTraductor,
  CODIGOS_DE_ERROR,
  esCodigoDeError,
  traducirCodigoError,
} from './traductor.ts'
export type { RaizDeDominio, Traductor, CodigoDeError } from './traductor.ts'
