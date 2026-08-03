'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { LOCALE_POR_DEFECTO, type Locale } from './routing.ts'
import { obtenerTraductor, type Traductor } from './traductor.ts'

// ============================================================================
// El puente del idioma hacia los componentes de cliente.
//
// Un Server Component resuelve el locale de la petición y llama a
// `obtenerTraductor()` directamente. Un componente de cliente no puede: no tiene
// cabeceras ni cookies, y pasarle el locale por props desde cada padre acabaría
// atravesando media aplicación con un dato que no le importa a nadie por el
// camino.
//
// Este contexto lo resuelve con lo mínimo: el layout raíz —que ya conoce el
// locale porque lo necesita para el `lang` del `<html>`— lo publica una vez, y
// cualquier componente de cliente lo lee con `useTraductor()`.
//
// Por qué no `NextIntlClientProvider`: `next-intl` no está instalado, y su
// aportación aquí sería mandar el catálogo por el cable. El nuestro ya viaja en
// el bundle (es un JSON importado estáticamente), así que el proveedor solo
// tiene que decir CUÁL de los dos idiomas usar. Es una cadena de dos letras
// frente a un catálogo entero, y CONTRATOS §11 pone el presupuesto de JS por
// ruta en 120 KB.
// ============================================================================

const ContextoLocale = createContext<Locale>(LOCALE_POR_DEFECTO)

export function ProveedorIdioma({
  locale,
  children,
}: {
  locale: Locale
  children: ReactNode
}) {
  return <ContextoLocale.Provider value={locale}>{children}</ContextoLocale.Provider>
}

/** El locale activo. Para cuando hace falta el dato y no la traducción. */
export function useLocale(): Locale {
  return useContext(ContextoLocale)
}

/**
 * El traductor, memoizado por locale.
 *
 * Si el proveedor no está montado devuelve el traductor del idioma por defecto
 * en vez de lanzar: una pantalla en español es un fallo cosmético, y una pantalla
 * en blanco no. En Darma esa diferencia importa más que en otras apps — la
 * pantalla que se caiga puede ser la que alguien abrió en mal momento.
 */
export function useTraductor(): Traductor {
  const locale = useLocale()
  return useMemo(() => obtenerTraductor(locale), [locale])
}
