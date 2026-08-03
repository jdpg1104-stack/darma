// ============================================================================
// GET /api/ranking?periodo=semana|mes|historico&cursor=<opaco>&limite=20
//
// El camino caliente del bloque. Lee SOLO `ranking_snapshots` —la foto ya
// construida— con el cliente RLS. Cero agregación en tiempo de lectura, cero
// `count(*)`, cero `OFFSET`, cero N+1: un index scan de `:limite` filas sobre
// `idx_ranking_board` y un lookup por PK a `profiles` por cada una.
//
// Rate limit a 60/min y persona. Es una lectura, sí, pero es la lista completa
// de quién ayuda más en una red de apoyo emocional: un bucle sobre el cursor la
// descarga entera. 60/min deja holgura a alguien pulsando «cargar más» y corta
// a un script.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rateLimit'
import { consultarTablero } from '@/lib/ranking/consulta'
import { inicioPeriodo } from '@/lib/ranking/periodos'
import { createClient } from '@/lib/supabase/server'

import { CACHE_TABLERO, manejarRankingRuta } from './respuesta'
import { parsearParametrosTablero } from './validacion'

// `nodejs` y no `edge`: el cliente de Supabase para servidor lee cookies con
// `next/headers` y el cursor se codifica con `Buffer`.
export const runtime = 'nodejs'
// La ruta se ejecuta siempre; lo que se comparte es la RESPUESTA, vía la
// cabecera `s-maxage` que pone `manejarRankingRuta` (ver respuesta.ts).
export const dynamic = 'force-dynamic'

const LIMITE_PETICIONES = 60
const VENTANA_SEGUNDOS = 60

export async function GET(request: NextRequest) {
  return manejarRankingRuta(async () => {
    // Sesión PRIMERO. El tablero no es público: es una pantalla donde alguien
    // se compara con los demás, y no tiene por qué ser indexable ni raspable
    // por quien no forma parte de la comunidad.
    const sesion = await requireSesion()
    const supabase = await createClient()

    // `failClosed` a false, igual que el feed: si Postgres se cae, preferimos
    // servir el tablero a devolver una puerta cerrada. El daño de un limitador
    // caído unos minutos es scraping de datos que ya son públicos dentro de la
    // app; el de fallar cerrado es una pantalla rota.
    const permitido = await rateLimit({
      key: `ranking:${sesion.userId}`,
      limit: LIMITE_PETICIONES,
      windowSeconds: VENTANA_SEGUNDOS,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { periodo, limite, cursor } = parsearParametrosTablero(request.nextUrl.searchParams)

    // El corte lo decide el SERVIDOR con el reloj de negocio, nunca el cliente.
    // Aceptar un `corte` por query string dejaría espiar cortes arbitrarios y,
    // peor, permitiría enlazar a un tablero congelado haciéndolo pasar por el
    // actual.
    const tablero = await consultarTablero(supabase, {
      periodo,
      corte: inicioPeriodo(periodo),
      cursor,
      limite,
    })

    return sobreOk(tablero)
  }, CACHE_TABLERO)
}
