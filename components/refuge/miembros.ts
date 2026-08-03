// ============================================================================
// B10 · Quién está en una sala
//
// Se lee con el cliente de NAVEGADOR contra PostgREST, no con una ruta propia,
// y es seguro precisamente por lo mismo que hace inseguro el resto de atajos:
// la política `refuge_members_read` de 0002 solo devuelve filas de salas de las
// que quien pregunta es miembro. Un no miembro obtiene una lista vacía, igual
// que si la sala no existiera.
//
// Se hace desde el cliente porque quien necesita esta lista es la criptografía
// del navegador (para saber contra qué claves públicas probar un sobre), y
// pasarla por el servidor solo añadiría un salto sin añadir ninguna barrera:
// la barrera ya está en la política.
// ============================================================================

import { createClient } from '@/lib/supabase/client'

/** uuids de quienes siguen dentro de la sala. Nunca alias ni nada más. */
export async function obtenerMiembros(refugeId: string): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('refuge_members')
    .select('user_id')
    .eq('refuge_id', refugeId)
    .is('left_at', null)

  if (error) return []
  return ((data ?? []) as Array<{ user_id: string }>).map((f) => f.user_id)
}
