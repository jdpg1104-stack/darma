// ============================================================================
// GET /api/ranking/yo?periodo=semana|mes|historico
//
// Tu fila, aunque estés en el puesto 40 000. Lectura por clave primaria
// `(period, period_start, auth.uid())`: nunca se pagina hasta ti.
//
// Sin esta ruta, «tu posición» solo existiría para quien ya está arriba — es
// decir, para la gente que menos necesita saberla. Y en una pantalla donde
// alguien se compara con los demás, ver un hueco donde debería estar tu nombre
// es exactamente el mensaje que no queremos dar.
//
// NO ESTAR EN LA FOTO NO ES UN ERROR. Devuelve `data: null`, jamás
// `no_encontrado`: quien no ha escuchado a nadie esta semana simplemente no
// aparece todavía, y un 404 convierte «aún no has empezado» en «algo ha
// fallado».
//
// Respuesta SIEMPRE `private, no-store`: depende de `auth.uid()`. La cabecera
// cacheable de `/api/ranking` no llega hasta aquí, y no debe.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rateLimit'
import { consultarMiFila } from '@/lib/ranking/consulta'
import { inicioPeriodo } from '@/lib/ranking/periodos'
import { createClient } from '@/lib/supabase/server'

import { manejarRankingRuta } from '../respuesta'
import { parsearPeriodo } from '../validacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const LIMITE_PETICIONES = 60
const VENTANA_SEGUNDOS = 60

export async function GET(request: NextRequest) {
  return manejarRankingRuta(async () => {
    const sesion = await requireSesion()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `ranking:${sesion.userId}`,
      limit: LIMITE_PETICIONES,
      windowSeconds: VENTANA_SEGUNDOS,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const periodo = parsearPeriodo(request.nextUrl.searchParams)

    // Sin `p_usuario`: la función SQL resuelve `auth.uid()` por su cuenta. El
    // userId NUNCA viene del cliente (CONTRATOS §6), y aquí ni siquiera se pasa
    // el de la sesión — cuanto menos viaje, menos hay que auditar.
    const fila = await consultarMiFila(supabase, periodo, inicioPeriodo(periodo))

    return sobreOk(fila)
  })
}
