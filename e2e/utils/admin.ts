import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Cliente service_role para PRUEBAS, con fusible anti-producción.
//
// Esta suite CREA y BORRA usuarios saltándose RLS. Apuntada a producción,
// borra gente de verdad. Por eso el fusible es lo primero que se ejecuta y por
// eso tiene su propia prueba (e2e/specs/07-fusible-y-crisis-global.spec.ts).
//
// ⚠️ La service_role key vive SOLO en el proceso de Node de Playwright. Nunca
// en un archivo que importe `app/` o `components/`, nunca en un `NEXT_PUBLIC_*`
// y NUNCA dentro de un `page.evaluate()` — eso la metería en el navegador y, de
// rebote, en la traza que Playwright guarda como artefacto de CI.
// ============================================================================

/** Motivo por el que el fusible corta. Se afirma en la prueba del fusible. */
export class ErrorFusibleProduccion extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorFusibleProduccion'
  }
}

/** Referencia de proyecto extraída de una URL `https://<ref>.supabase.co`. */
export function refDeProyecto(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)(?::\d+)?\/?$/i.exec(url.trim())
  return m?.[1] ?? null
}

function esLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * El fusible, aislado de la creación del cliente para poder probarlo sin
 * credenciales.
 *
 * Deja pasar exactamente dos casos:
 *   1. Supabase local (`localhost` / `127.0.0.1`).
 *   2. El proyecto declarado EXPLÍCITAMENTE en `E2E_SUPABASE_PROJECT_REF`.
 *
 * El segundo caso exige una variable propia a propósito: si bastara con que la
 * URL fuera «la que hay en .env.local», apuntar la suite a producción sería
 * cambiar una variable que ya existe. Así hay que escribir el ref del proyecto
 * de pruebas a mano, y escribir el de producción es un acto deliberado.
 */
export function comprobarFusible(url: string | undefined, refDeclarado?: string): void {
  if (!url) {
    throw new ErrorFusibleProduccion(
      'NEXT_PUBLIC_SUPABASE_URL no está definida: no se sabe contra qué base se ejecuta.',
    )
  }

  if (esLocal(url)) return

  const ref = refDeProyecto(url)
  const declarado = (refDeclarado ?? '').trim()

  if (!declarado) {
    throw new ErrorFusibleProduccion(
      'La suite E2E apunta a una base REMOTA y E2E_SUPABASE_PROJECT_REF no está declarada. ' +
        'Declara el ref del proyecto de pruebas para confirmar que no es producción.',
    )
  }

  if (ref !== declarado) {
    throw new ErrorFusibleProduccion(
      `La suite E2E apunta a un proyecto que NO es el declarado (declarado: ${declarado}). ` +
        'Se aborta: esta suite crea y borra usuarios con service_role.',
    )
  }
}

let cache: SupabaseClient | null = null

/**
 * Cliente service_role. Lanza si la URL de Supabase no es local ni coincide con
 * `E2E_SUPABASE_PROJECT_REF`.
 */
export function clienteAdminE2E(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  comprobarFusible(url, process.env.E2E_SUPABASE_PROJECT_REF)

  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!clave) {
    // No es un fallo del fusible: es la clave que falta. Se distingue del
    // ErrorFusibleProduccion a propósito para que la prueba del fusible no dé
    // un verde falso por el motivo equivocado.
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY vacía. Los fixtures de B18 crean usuarios, siembran ' +
        'posts y validan comentarios con service_role; sin esa clave no hay E2E posible. ' +
        'Se copia a mano desde el panel de Supabase (Project Settings → API → service_role).',
    )
  }

  if (!cache) {
    cache = createClient(url!, clave, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return cache
}

/**
 * ¿Se puede administrar la base en este entorno?
 *
 * ⚠️ NO basta con que la variable exista. En este entorno hay una
 * `SUPABASE_SERVICE_ROLE_KEY` heredada del shell que `darma-dev` rechaza con
 * «Invalid API key … This API key might also be owned by another Supabase
 * project»: es una clave de OTRO proyecto. Si la suite se fiara de la simple
 * presencia de la variable, los seis recorridos se ejecutarían y fallarían con
 * un error de autenticación que no tiene nada que ver con lo que prueban —y
 * ese es exactamente el tipo de rojo que hace que un equipo deje de mirar la
 * suite.
 *
 * Por eso el veredicto lo decide `probarCredencialesAdmin()` UNA vez en el
 * global setup y se propaga a los workers por `E2E_ADMIN_OK`.
 */
export function hayCredencialesAdmin(): boolean {
  if (process.env.E2E_ADMIN_OK != null) return process.env.E2E_ADMIN_OK === '1'
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

/**
 * Comprueba de verdad que la clave administra ESTE proyecto: una lectura
 * mínima de `profiles` limitada a una columna privada, que solo `service_role`
 * puede ver. Barata, sin escribir nada y sin dejar rastro.
 */
export async function probarCredencialesAdmin(): Promise<{ ok: boolean; motivo?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, motivo: 'SUPABASE_SERVICE_ROLE_KEY no está definida.' }
  }

  try {
    const admin = clienteAdminE2E()
    const { error } = await admin.from('profiles').select('karma_spendable').limit(1)
    if (error) return { ok: false, motivo: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}
