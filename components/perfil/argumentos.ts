// ============================================================================
// Argumentos de `mi_historial_karma()`. Módulo PURO y aparte de `consultas.ts`
// a propósito.
//
// `consultas.ts` importa `lib/supabase/server.ts`, que importa `next/headers` y
// no se puede cargar fuera del runtime de Next. Si esta función viviera allí, no
// habría forma de probar con `node --test` lo único que de verdad hay que
// afirmar sobre ella: **que no existe ningún parámetro de usuario**.
//
// `GET /api/karma/historial?userId=<otra-persona>` no devuelve el ledger de
// nadie más, y no porque la ruta se acuerde de descartar el parámetro. Es que
// no hay dónde ponerlo: ni aquí, ni en la firma de la función SQL, que filtra
// por `(select auth.uid())` por dentro. Y por si las dos cosas cambiaran algún
// día, la función es SECURITY INVOKER y la política `karma_events_read_own`
// sigue siendo la última barrera.
// ============================================================================

import { decodificarCursor } from './cursor.ts'

export interface ParametrosHistorial {
  limite: number
  cursor?: string | undefined
}

export interface ArgumentosHistorial {
  p_limite: number
  p_cursor_created: string | null
  p_cursor_id: string | null
}

export function argumentosHistorial(parametros: ParametrosHistorial): ArgumentosHistorial {
  // Un cursor corrupto NO es un error: se sirve la primera página. El keyset no
  // es un permiso —la RPC filtra por `auth.uid()` pase lo que pase en el
  // cursor—, así que lo peor que consigue quien lo manipule es saltar a otro
  // punto de SU historial. Ver la cabecera de cursor.ts.
  const cursor = decodificarCursor(parametros.cursor)

  return {
    p_limite: parametros.limite,
    p_cursor_created: cursor?.creadoEn ?? null,
    p_cursor_id: cursor?.id ?? null,
  }
}
