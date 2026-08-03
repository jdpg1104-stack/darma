// ============================================================================
// Configuración de idioma de la petición (servidor)
//
// `next-intl` se evaluó y se descartó: el catálogo ya viaja en el bundle como
// JSON importado estáticamente, así que su provider solo habría añadido mandarlo
// otra vez por el cable contra el presupuesto de 120 KB por ruta de CONTRATOS
// §11. El razonamiento completo está en `i18n/Proveedor.tsx`, que es lo que se
// montó en su lugar.
//
// Esto es la fuente de verdad del par (idioma, mensajes) para el servidor: lo
// consumen `app/layout.tsx` y cualquier Server Component que necesite el
// subárbol de su pantalla.
// ============================================================================

import { resolverLocale } from './deteccion.ts'
import { MENSAJES, RAICES_DE_DOMINIO, subarbolDeMensajes, type RaizDeDominio } from './index.ts'
import type { Catalogo } from './catalogo.ts'
import type { Locale } from './routing.ts'

export interface ConfiguracionDePeticion {
  locale: Locale
  messages: Catalogo
  /** Fijo: las fechas se muestran siempre en la zona del servidor de destino
   *  (`fra1`, ver ARCHITECTURE §10) para que dos personas vean lo mismo. */
  timeZone: string
}

/**
 * Resuelve idioma y mensajes para la petición en curso.
 *
 * NO resuelve el país: eso es `resolverPais()` y va por otro camino a propósito
 * (los recursos de crisis se indexan por país, nunca por idioma).
 */
export async function configuracionDePeticion(): Promise<ConfiguracionDePeticion> {
  const locale = await resolverLocale()
  return {
    locale,
    messages: MENSAJES[locale],
    timeZone: 'Europe/Madrid',
  }
}

/**
 * Variante para pantallas que solo necesitan parte del catálogo: mandar los dos
 * JSON enteros al cliente se come el presupuesto de 120 KB por ruta de
 * CONTRATOS §11 él solo en cuanto el catálogo crezca.
 */
export async function configuracionDePeticionParcial(
  raices: readonly RaizDeDominio[] = RAICES_DE_DOMINIO,
): Promise<ConfiguracionDePeticion> {
  const locale = await resolverLocale()
  return {
    locale,
    messages: subarbolDeMensajes(locale, raices),
    timeZone: 'Europe/Madrid',
  }
}
