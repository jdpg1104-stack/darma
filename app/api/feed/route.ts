// ============================================================================
// GET /api/feed?cursor=<opaco>&limite=20&carril=para_ti|nuevo
//
// La ruta que más veces se llama en toda la app: es el scroll infinito. Solo
// hace cuatro cosas, y ninguna es negociable:
//
//  1. `requireSesion()` PRIMERO. El feed no es público. Sin sesión devuelve
//     `no_autenticado`, no un feed vacío — un feed vacío hace pensar que la app
//     está rota y manda a la gente a cerrar sesión para «arreglarlo».
//  2. Rate limit `feed:<userId>` a 120/min. Es una lectura, sí, pero el scroll
//     infinito automatizado es el vector de scraping más barato que existe: un
//     bucle sobre el cursor descarga la comunidad entera. 120/min deja holgura a
//     un humano que scrollea rápido y corta a un script.
//  3. Validar con zod (limite 1–50, cursor ≤ 256, carril cerrado).
//  4. Delegar en `consultarFeed`, que usa el cliente RLS. Nunca el admin.
//
// `dynamic = 'force-dynamic'` y `revalidate = 0` NO son ajustes de rendimiento:
// el feed depende de `auth.uid()` a través de RLS, así que una respuesta
// cacheada por el CDN se le serviría a la siguiente persona. En una app anónima
// eso es servirle a alguien el feed de otro. Es una fuga de datos disfrazada de
// optimización.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

import { consultarFeed } from './consulta'
import { decodificarCursor } from './cursor'
import { idiomaDeContenido, parsearParametros } from './validacion'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** 120 lecturas por minuto y persona. Ver cabecera. */
const LIMITE_PETICIONES = 120
const VENTANA_SEGUNDOS = 60

export async function GET(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const supabase = await createClient()

    // `failClosed` a false a propósito (ver lib/rateLimit.ts): si Postgres se
    // cae, preferimos servir el feed a dejar a alguien sin su comunidad. El daño
    // de un limitador caído unos minutos es scraping; el de fallar cerrado es
    // una puerta cerrada en el peor momento.
    const permitido = await rateLimit({
      key: `feed:${sesion.userId}`,
      limit: LIMITE_PETICIONES,
      windowSeconds: VENTANA_SEGUNDOS,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { cursor, limite, carril } = parsearParametros(request.nextUrl.searchParams)

    const pagina = await consultarFeed(supabase, {
      carril,
      limite,
      // Un cursor corrupto NO es un error: devuelve el cursor vacío, o sea la
      // primera página. Mismo criterio que `decodeCursor` de lib/feedRanking.ts.
      cursor: decodificarCursor(cursor, carril),
      idioma: idiomaDeContenido(request.headers.get('accept-language')),
    })

    return sobreOk(pagina)
  })
}
