// ============================================================================
// B17 · Configuración de petición para next-intl (servidor)
//
// ⚠️ ESTE ARCHIVO NO IMPORTA `next-intl` TODAVÍA, A PROPÓSITO.
//
// `next-intl` no está instalado: añadirlo tocaría `package.json`, que no es de
// B17 y que comparten otros cinco bloques trabajando ahora mismo. La dependencia
// está pedida en HANDOFF/PEDIDOS.md junto con los dos cambios de F4
// (`next.config.ts` y `app/layout.tsx`).
//
// Cuando lleguen, este archivo pasa a ser exactamente esto —dos líneas más, sin
// tocar nada de lo de abajo—:
//
//     import { getRequestConfig } from 'next-intl/server'
//     export default getRequestConfig(configuracionDePeticion)
//
// Y `next.config.ts` lo apunta con `createNextIntlPlugin('./i18n/request.ts')`.
// Mientras tanto, `configuracionDePeticion()` ya es la fuente de verdad y la usa
// `obtenerTraductor()` en pruebas y en cualquier Server Component que la
// necesite: el día de la integración no cambia el comportamiento, solo el
// consumidor.
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
 * Variante para rutas que solo necesitan parte del catálogo. Es la que debe
 * usarse al alimentar `<NextIntlClientProvider>`: mandar los dos JSON enteros al
 * cliente se come el presupuesto de 120 KB por ruta de CONTRATOS §11 él solo en
 * cuanto el catálogo crezca.
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
