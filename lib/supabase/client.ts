// ============================================================================
// Cliente de Supabase para el NAVEGADOR.
//
// Este es el único cliente que puede viajar dentro de un bundle de cliente.
// Lleva la anon key, que es pública por diseño: lo que protege los datos NO es
// el secreto de la clave, es RLS (ver supabase/migrations/0001_core.sql). Si
// alguien extrae esta clave del bundle, lo máximo que consigue es hablar con
// PostgREST *como un usuario anónimo* — exactamente lo mismo que puede hacer
// desde la propia app.
//
// Corolario que hay que tener presente al escribir cualquier feature de Darma:
// cualquier regla que solo viva en el servidor de Next se salta con un curl a
// PostgREST usando esta clave. Por eso el gate de reciprocidad 3:1 y el tope
// diario de karma son un trigger y una función SECURITY DEFINER en Postgres, y
// lib/reciprocity.ts es solo pintura de UI.
//
// ALTERNATIVA DESCARTADA: un singleton perezoso compartido a nivel de módulo.
// `createBrowserClient` de @supabase/ssr ya memoiza internamente por par
// (url, key), así que llamarlo en cada render devuelve la misma instancia y el
// singleton manual solo añadiría una variable de módulo que sobrevive al Fast
// Refresh con estado de auth viejo.
// ============================================================================

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lee una variable de entorno pública fallando RUIDOSAMENTE si falta.
 *
 * NEXT_PUBLIC_* se inlinea en build time: si falta, `process.env.X` es
 * `undefined` y el cliente se construiría con la URL "undefined", produciendo
 * un fallo de red opaco en runtime. Preferimos el error explícito.
 */
function requirePublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = name === 'NEXT_PUBLIC_SUPABASE_URL'
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!value) {
    throw new Error(
      `[darma] Falta ${name}. Es una variable pública y se inlinea en build: ` +
      'defínela en .env.local y reinicia el servidor de desarrollo.',
    )
  }
  return value
}

/**
 * Cliente de navegador. Úsalo SOLO en componentes con "use client".
 * Todas las lecturas y escrituras pasan por RLS como el usuario autenticado.
 */
export function createClient(): SupabaseClient {
  return createBrowserClient(
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )
}
