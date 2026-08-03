// ============================================================================
// B11 · Guardia de las rutas de moderación
//
// Se separa de `lib/ai/acceso.ts` (que es puro) porque esto arrastra la sesión
// de Next y el cliente admin: `acceso.ts` tiene que poder cargarse desde
// `node --test` sin traerse medio framework detrás.
//
// La comprobación es EN EL SERVIDOR. Un flag en el cliente no es un permiso:
// la anon key es pública y cualquiera puede hablar con PostgREST directamente.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSesion, type Sesion } from '@/lib/auth/session'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { esModerador } from './acceso'

export interface ContextoModerador {
  sesion: Sesion
  admin: SupabaseClient
}

/**
 * Exige sesión Y rol de moderador.
 *
 * `sin_permiso` es un 403 con un mensaje genérico: ni menciona la allowlist,
 * ni la variable de entorno, ni las tablas. Quien no es moderador no debe
 * poder deducir por el mensaje de error ni que el panel existe.
 */
export async function exigirModerador(): Promise<ContextoModerador> {
  const sesion = await requireSesion()
  if (!esModerador(sesion.userId)) throw new ErrorApi('sin_permiso')
  // El cliente admin se construye DESPUÉS de comprobar el permiso. Al revés,
  // un fallo de configuración de la service key se convertiría en un 500 que
  // le confirma a un curioso que ha llegado a la ruta correcta.
  return { sesion, admin: createAdminClient() }
}
