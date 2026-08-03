// ============================================================================
// GET /api/karma/insignias[?userId=<uuid>] — insignias derivadas
//
// Dos respuestas distintas según a quién se pregunte, y la diferencia NO es una
// política de producto que se pueda relajar desde aquí:
//
//  · SIN `userId`, o con el propio → las diez, conseguidas y no conseguidas.
//    Se derivan de contadores privados (`listens_given`, `posts_published`,
//    `streak_days`, «me ayudó») que solo salen por RPCs filtradas por
//    `auth.uid()`.
//
//  · Con el `userId` de OTRA persona → solo las de nivel, y solo las
//    conseguidas. Es todo lo que se puede derivar de datos públicos: sus
//    contadores de escuchas y publicaciones no son legibles (`42501 permission
//    denied`, verificado contra Postgres con dos sesiones reales).
//
// Enseñar las que le FALTAN a otra persona se descartó aparte de por lo
// anterior: la lista de lo que a alguien le falta es un retrato de su actividad
// —o de su ausencia— que esa persona no ha elegido publicar.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import { limitarPerfil } from '@/components/perfil/limites'
import { leerPerfilAjeno, leerPerfilPropio } from '@/components/perfil/consultas'
import { esquemaConsultaInsignias } from '@/components/perfil/validacion'
import type { Insignia } from '@/components/perfil/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return manejarRuta<Insignia[]>(async () => {
    const sesion = await requirePerfil()
    await limitarPerfil('resumen', sesion.userId)

    const query = new URL(request.url).searchParams
    const analizado = esquemaConsultaInsignias.safeParse({
      userId: query.get('userId') ?? undefined,
    })
    if (!analizado.success) throw new ErrorApi('entrada_invalida')

    const objetivo = analizado.data.userId
    if (!objetivo || objetivo === sesion.userId) {
      const propio = await leerPerfilPropio(sesion.userId)
      return sobreOk(propio.insignias)
    }

    const ajeno = await leerPerfilAjeno(objetivo)
    // 404 tanto si no existe como si RLS no lo devuelve: distinguir los dos
    // casos convierte la ruta en un oráculo de "¿existe esta cuenta?".
    if (!ajeno) throw new ErrorApi('no_encontrado')

    return sobreOk(ajeno.insignias)
  })
}
