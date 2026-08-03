// ============================================================================
// GET /api/karma/historial — el ledger propio, paginado por keyset
//
// ── EL `userId` DEL QUERY NO SE IGNORA: NO EXISTE ──────────────────────────
// Un atacante que pruebe `?userId=<otra-persona>` no recibe el ledger de nadie
// más, y no porque esta ruta se acuerde de descartar el parámetro. Hay tres
// barreras independientes, y las tres tendrían que caer a la vez:
//
//   1. Esta ruta no lee `userId` del query. `argumentosHistorial()` es una
//      función pura sin ese parámetro y hay un test que lo afirma.
//   2. `mi_historial_karma()` no tiene un argumento de usuario: filtra por
//      `(select auth.uid())` dentro de la propia función SQL.
//   3. La función es SECURITY INVOKER, así que la política
//      `karma_events_read_own` sigue aplicándose. Aunque alguien borrase el
//      `where` de la función, Postgres seguiría devolviendo solo el ledger
//      propio. Verificado con dos sesiones reales: un usuario pidiendo
//      `karma_events?user_id=eq.<otro>` por PostgREST recibe `[]`.
//
// El `id` bigint del ledger NO sale en la respuesta (CONTRATOS §1). Viaja solo
// dentro del cursor opaco, que el cliente devuelve sin leerlo.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import { limitarPerfil } from '@/components/perfil/limites'
import { leerHistorial } from '@/components/perfil/consultas'
import { esquemaConsultaHistorial } from '@/components/perfil/validacion'
import type { EventoKarma, PaginaCursor } from '@/components/perfil/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return manejarRuta<PaginaCursor<EventoKarma>>(async () => {
    const sesion = await requirePerfil()
    await limitarPerfil('historial', sesion.userId)

    const query = new URL(request.url).searchParams
    const analizado = esquemaConsultaHistorial.safeParse({
      // `?? undefined` para que zod aplique el `.default(20)`: un `null` no
      // dispara el default y acabaría en `entrada_invalida` por un query vacío.
      limite: query.get('limite') ?? undefined,
      cursor: query.get('cursor') ?? undefined,
    })

    // `limite=200` o `limite=abc` → 422. El detalle de zod NO viaja: diría qué
    // campo y qué regla, que es esquema gratis para quien sondea la API.
    if (!analizado.success) throw new ErrorApi('entrada_invalida')

    return sobreOk(
      await leerHistorial({
        limite: analizado.data.limite,
        cursor: analizado.data.cursor,
      }),
    )
  })
}
