// ============================================================================
// POST /api/polls/reponer  (Bearer CRON_SECRET)
//   → { ok: true, data: { activadas, cerradas } }
//
// Vive bajo `/api/polls/*` y no bajo `/api/cron/*` porque ese prefijo es de B08
// (CONTRATOS §7). La entrada en `vercel.json` la pide B09 a F4 en PEDIDOS.md:
//   {"path":"/api/polls/reponer","schedule":"41 3 * * *"}
//
// ── AUTENTICACIÓN: FAIL-CLOSED Y EN TIEMPO CONSTANTE ───────────────────────
// El disparo llega de una máquina, sin cookie, así que el proxy no puede
// autenticarlo y este handler se autentica solo. `esCronAutorizado()` (B08,
// `lib/ingest/cronAuth.ts`) hace las dos cosas que importan:
//   · sin `CRON_SECRET` en el entorno → 401 SIEMPRE. La tentación de «si no hay
//     secreto configurado, deja pasar, que estamos en local» es exactamente lo
//     que convierte un despliegue con una variable olvidada en un endpoint
//     abierto;
//   · comparación con `timingSafeEqual`: `a === b` sobre cadenas sale en el
//     primer byte distinto, y ese tiempo se mide por red con suficientes
//     muestras.
//
// Se reutiliza el helper de B08 en vez de escribir el cuarto: la comprobación
// es idéntica y una copia es una copia que alguien arreglará solo en un sitio.
// Si algún día B08 lo mueve, esto es un import roto en compilación, que es
// justo donde se quiere que aparezca.
//
// El 401 es el MISMO en los tres casos de fallo (sin cabecera, cabecera
// errónea, secreto sin definir). Distinguirlos le diría a quien prueba si el
// endpoint está configurado.
//
// `runtime = 'nodejs'`: `timingSafeEqual` viene de `node:crypto` y el cliente
// admin no puede vivir en el edge.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { esCronAutorizado, secretoCron } from '@/lib/ingest/cronAuth'
import { LIMITES_PETICION } from '@/lib/polls/limites'
import { reponerBanco } from '@/lib/polls/reponer'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    if (!esCronAutorizado(request.headers.get('authorization'), secretoCron())) {
      throw new ErrorApi('no_autenticado')
    }

    // Límite GLOBAL y no por usuario: aquí no hay usuario. Dos disparos por
    // minuto sobran para un cron diario, y la reposición es idempotente de todos
    // modos (`uq_polls_bank_key`), así que esto es contra el bucle accidental,
    // no contra el abuso.
    //
    // Solo capa de memoria: la capa 2 necesita un cliente de Supabase, y el
    // único disponible aquí sería el admin. Usarlo para contar peticiones
    // ampliaría la superficie que salta RLS por una comodidad.
    const permitido = await rateLimit({
      key: 'polls:reponer',
      limit: LIMITES_PETICION.reponer.limite,
      windowSeconds: LIMITES_PETICION.reponer.ventanaSegundos,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    return sobreOk(await reponerBanco())
  })
}
