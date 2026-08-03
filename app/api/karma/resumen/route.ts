// ============================================================================
// GET /api/karma/resumen — nivel, progreso, tope diario, racha y desglose 30 d
//
// UNA consulta. `mi_resumen_karma()` (migración 0105) fusiona en una sola RPC
// lo que si no serían tres viajes: las columnas de `profiles` que no se pueden
// leer con un `select` (la racha), el contador del tope diario y la agregación
// del ledger, que PostgREST no sabe expresar sin una función.
//
// La agregación es la ÚNICA de todo el bloque y está acotada por diseño: un
// usuario, treinta días, con el tope de 120 puntos al día limitando cuántos
// eventos pueden ser. No es un `count(*)` sobre una tabla que crece sin freno.
//
// El progreso al siguiente nivel sale TAL CUAL de `progressToNextLevel()`. Los
// umbrales 500/2000/5000 no aparecen ni aquí ni en ningún componente: viven en
// `lib/karma.ts` y en la columna generada `profiles.level`, y hay un test que
// vigila que los dos coincidan.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { limitarPerfil } from '@/components/perfil/limites'
import { leerResumen } from '@/components/perfil/consultas'
import type { ResumenKarma } from '@/components/perfil/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return manejarRuta<ResumenKarma>(async () => {
    const sesion = await requirePerfil()
    await limitarPerfil('resumen', sesion.userId)

    return sobreOk(await leerResumen())
  })
}
