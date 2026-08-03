// ============================================================================
// Cliente de Supabase para el SERVIDOR (Server Components, Route Handlers,
// Server Actions) — Next 16, donde `cookies()` es asíncrono.
//
// Sigue llevando la anon key: el cliente de servidor NO es un cliente
// privilegiado. Lo que hace es leer la cookie de sesión y presentarse ante
// Postgres como ESE usuario, de modo que RLS sigue aplicándose igual que en el
// navegador. El cliente que salta RLS es lib/supabase/admin.ts, y es otro
// archivo a propósito: la separación física hace que "usar el admin" sea
// siempre una decisión consciente y visible en el diff.
//
// SOBRE EL try/catch AL ESCRIBIR COOKIES: en un Server Component la respuesta
// puede estar ya en streaming, y Next lanza al intentar escribir cabeceras.
// Ese caso es benigno *siempre que exista middleware refrescando la sesión*,
// porque el refresh de token ocurre allí. Tragamos el error a propósito y
// documentamos la condición; sin middleware, la sesión no se renovaría y el
// usuario acabaría deslogueado sin explicación.
//
// ALTERNATIVA DESCARTADA: cachear el cliente por petición con `React.cache`.
// Tienta (evita construirlo N veces por render), pero acopla el cliente al
// ciclo de vida de React y no funciona en Route Handlers ni en Server Actions,
// que es donde más se usa. Construirlo es barato: no abre conexiones, es un
// wrapper sobre fetch.
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

function requirePublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = name === 'NEXT_PUBLIC_SUPABASE_URL'
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!value) {
    throw new Error(`[darma] Falta ${name} en el entorno del servidor.`)
  }
  return value
}

/**
 * Cliente de servidor ligado a las cookies de la petición en curso.
 * Respeta RLS: ve exactamente lo que el usuario autenticado puede ver.
 *
 * Hay que llamarlo DENTRO del handler/componente, nunca a nivel de módulo:
 * `cookies()` depende del contexto de la petición.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies()

  return createServerClient(
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Llamado desde un Server Component: las cabeceras ya salieron.
            // Es esperado y seguro SIEMPRE que el middleware refresque la
            // sesión. Ver cabecera del archivo.
          }
        },
      },
    },
  )
}

/**
 * Devuelve el usuario autenticado, o `null`.
 *
 * Usa SIEMPRE `getUser()` y NUNCA `getSession()` en el servidor: `getSession()`
 * devuelve lo que venga en la cookie sin validarlo contra el servidor de auth,
 * y la cookie la controla el cliente. `getUser()` verifica el JWT contra
 * Supabase. La diferencia entre ambos es, literalmente, la diferencia entre
 * autenticar y creerse lo que te cuentan.
 */
export async function getCurrentUser(): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return { id: data.user.id }
}
