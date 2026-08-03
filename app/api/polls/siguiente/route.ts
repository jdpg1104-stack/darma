// ============================================================================
// GET /api/polls/siguiente?posicion=<int>  →  { ok: true, data: EncuestaFeed | null }
//
// Devuelve la encuesta que le toca a esta persona AHORA, o `null`. El `null` no
// es un error ni un caso raro: es la respuesta correcta la mayoría de las veces,
// porque la cadencia existe justamente para que una encuesta aparezca cuando
// aporta y no cuando satura.
//
// `dynamic = 'force-dynamic'` y `revalidate = 0` NO son ajustes de rendimiento.
// La respuesta depende de `auth.uid()` —qué has votado, qué has descartado,
// cuántas llevas hoy—, así que una respuesta cacheada por el CDN se le serviría
// a la siguiente persona. En una app anónima eso es servirle a alguien el
// historial de otro: una fuga de datos disfrazada de optimización.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { siguienteEncuestaPara } from '@/lib/polls/consulta'
import { LIMITES_PETICION } from '@/lib/polls/limites'
import { idiomaDeEncuestas, parsearSiguiente } from '@/lib/polls/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  return manejarRuta(async () => {
    // `requirePerfil` y no `requireSesion`: la cadencia y el descarte cuelgan de
    // `profiles`, así que sin onboarding no hay fila que escribir y la inserción
    // fallaría con una violación de FK en vez de con un mensaje entendible.
    const sesion = await requirePerfil()
    const supabase = await createClient()

    // `failClosed` a false (ver lib/rateLimit.ts): es una lectura de adorno del
    // feed. Si el limitador se cae, servir una encuesta de más es menos daño
    // que romper el feed de alguien.
    const permitido = await rateLimit({
      key: `polls:siguiente:${sesion.userId}`,
      limit: LIMITES_PETICION.siguiente.limite,
      windowSeconds: LIMITES_PETICION.siguiente.ventanaSegundos,
      supabase,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    const { posicion } = parsearSiguiente(request.nextUrl.searchParams)

    const { encuesta } = await siguienteEncuestaPara(supabase, {
      userId: sesion.userId,
      posicion,
      idioma: idiomaDeEncuestas(request.headers.get('accept-language')),
    })

    // El `motivo` de la decisión NO sale en la respuesta. «tope_diario» le
    // contaría al cliente cómo funciona la cadencia y cómo esquivarla; y a la
    // persona no le aporta nada saber que hoy ya vio dos.
    return sobreOk(encuesta)
  })
}
