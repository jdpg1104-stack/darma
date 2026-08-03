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
import { ACCIONES, auditar } from '@/app/(admin)/_lib/acceso'
import { esModerador, ROL_MINIMO_MODERACION } from './acceso'

export interface ContextoModerador {
  sesion: Sesion
  admin: SupabaseClient
}

/**
 * Exige sesión Y rol de moderador.
 *
 * El permiso lo decide `tiene_rol_admin()` en Postgres, el mismo camino que usa
 * el guard del centro de mando (`app/api/admin/_guard.ts`). Ya no hay dos
 * sistemas: ver la cabecera de `lib/ai/acceso.ts`.
 *
 * `sin_permiso` es un 403 con un mensaje genérico: no menciona `admin_roles`,
 * ni qué rol falta, ni que el panel exista. Quien no es moderador no debe poder
 * deducir el mapa del sistema por el mensaje de error.
 */
export async function exigirModerador(): Promise<ContextoModerador> {
  const sesion = await requireSesion()

  if (!(await esModerador(sesion.userId))) {
    // Se audita el DENEGADO, igual que en el panel. Es lo único que responde a
    // «¿alguien está probando la puerta?»: un `admin.denegado` suelto es quien
    // se equivocó de enlace; veinte en una hora desde la misma cuenta es un
    // incidente, y sin registro no existe. `auditar()` no lanza a propósito —el
    // permiso ya está decidido y un fallo del registro no debe convertirse en
    // un 500 que le confirme a quien lo provocó que algo interno se ha roto.
    await auditar({
      actorId: sesion.userId,
      action: ACCIONES.denegado,
      targetType: 'ruta',
      targetId: 'moderacion',
      params: { motivo: 'sin_rol', minimo: ROL_MINIMO_MODERACION },
    })
    throw new ErrorApi('sin_permiso')
  }
  // El cliente admin se construye DESPUÉS de comprobar el permiso. Al revés,
  // un fallo de configuración de la service key se convertiría en un 500 que
  // le confirma a un curioso que ha llegado a la ruta correcta.
  return { sesion, admin: createAdminClient() }
}
