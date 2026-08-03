// ============================================================================
// POST /api/ranking/snapshot — el constructor de la foto.
//
// Programado a `7 * * * *` (cada hora, en el minuto 7). El 7 y no el 0 es
// deliberado: a la hora exacta compiten los crons de medio internet, y el
// arranque de una función que va a hablar mucho con Postgres es justo donde se
// nota. Anotado en PEDIDOS.md para que F4 lo añada a `vercel.json` — ese
// archivo no es de B06.
//
// ── AUTENTICACIÓN: SOLO `Authorization: Bearer <CRON_SECRET>` ──────────────
// Sin sesión y sin cookie, porque el disparo llega de una máquina. Fail-closed:
// si `CRON_SECRET` no está en el entorno, 401 SIEMPRE. Comparación en tiempo
// constante con `timingSafeEqual` (ver lib/ranking/cronAuth.ts).
//
// ⚠️ La comprobación del Bearer va ANTES del `try` del envoltorio y antes de
// tocar nada: un 401 no debe costar ni una consulta ni una lectura de entorno
// extra, y sobre todo no debe poder distinguirse por tiempo del caso «secreto
// correcto pero base caída».
//
// ── EL CLIENTE ADMIN, JUSTIFICADO (CONTRATOS §6) ───────────────────────────
// La agregación necesita leer `profiles.shadow_banned` y `profiles.banned_until`
// para excluir a quien no debe salir en el tablero. `authenticated` no puede
// leer esas columnas y no debe poder: si el troll consulta si está silenciado,
// se crea otra cuenta. No hay política que dé este acceso sin romper el
// shadow-ban, así que aquí el `service_role` no es un atajo, es la única vía.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { sobreOk } from '@/lib/auth/respuestas'
import { rateLimit } from '@/lib/rateLimit'
import { construirSnapshot } from '@/lib/ranking/construirSnapshot'
import { esCronRankingAutorizado, secretoCronRanking } from '@/lib/ranking/cronAuth'
import { createAdminClient } from '@/lib/supabase/admin'

import type { ResultadoSnapshot } from '@/lib/ranking/tipos'

import { manejarRankingRuta } from '../respuesta'
import { parsearCuerpoSnapshot } from '../validacion'

/**
 * Lo que devuelve la ruta. Es una unión y no un tipo suelto porque el disparo
 * del cron (sin body) reconstruye los TRES periodos y necesita informar de cada
 * uno por separado: un solo `completado` agregado escondería que el histórico
 * se quedó a medias mientras la semana terminó bien.
 */
type RespuestaSnapshot =
  | ResultadoSnapshot
  | {
      periodo: 'todos'
      corte: string
      filas: number
      completado: boolean
      ultimoUsuario: string | null
      detalle: Record<'semana' | 'mes' | 'historico', ResultadoSnapshot>
    }

// `nodejs` y no `edge`: `timingSafeEqual` viene de `node:crypto` y el cliente
// admin no funciona en el runtime del borde.
export const runtime = 'nodejs'
// Techo de 60 s; el presupuesto interno del constructor es de 50 y los 10
// restantes son el margen para devolver el cursor de continuación y salir.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** 2/min GLOBAL, no por usuario: aquí no hay usuario. Un cron duplicado —o un
 *  reintento de Vercel tras un timeout— no debe poder machacar la base con
 *  reconstrucciones solapadas de la misma foto. */
const LIMITE_PETICIONES = 2
const VENTANA_SEGUNDOS = 60

export async function POST(request: NextRequest) {
  if (!esCronRankingAutorizado(request.headers.get('authorization'), secretoCronRanking())) {
    // `no_autenticado` y no `sin_permiso`: quien llama sin Bearer válido no es
    // que no tenga permiso, es que no es nadie. Y el mensaje no distingue entre
    // «falta la cabecera», «el secreto no coincide» y «no hay secreto
    // configurado»: las tres son el mismo 401.
    return manejarRankingRuta(async () => {
      throw new ErrorApi('no_autenticado')
    })
  }

  return manejarRankingRuta<RespuestaSnapshot>(async () => {
    const admin = createAdminClient()

    // `failClosed: true`, al revés que las rutas de lectura. Aquí fallar abierto
    // significaría permitir reconstrucciones simultáneas cuando el limitador no
    // responde, que es exactamente el escenario en el que la base ya está mal.
    const permitido = await rateLimit({
      key: 'ranking-snap:global',
      limit: LIMITE_PETICIONES,
      windowSeconds: VENTANA_SEGUNDOS,
      supabase: admin,
      failClosed: true,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    // Body opcional: el cron dispara sin cuerpo. `{ periodo, corte }` existe
    // para reconstruir a mano un corte pasado tras un incidente.
    const crudo = await request.json().catch(() => null)
    const { periodo, corte } = parsearCuerpoSnapshot(crudo)

    if (periodo) {
      const data = await construirSnapshot(admin, { periodo, corte })
      return sobreOk(data)
    }

    // Sin periodo se reconstruyen los tres, en orden de volatilidad: la semana
    // es la que más cambia y la que más se mira, así que si el presupuesto se
    // agota, lo que queda a medias es el histórico y no el tablero de la
    // portada. Cada uno lleva su propio `completado`.
    const semana = await construirSnapshot(admin, { periodo: 'semana', corte })
    const mes = await construirSnapshot(admin, { periodo: 'mes', corte })
    const historico = await construirSnapshot(admin, { periodo: 'historico', corte })

    return sobreOk({
      periodo: 'todos' as const,
      corte: semana.corte,
      filas: semana.filas + mes.filas + historico.filas,
      completado: semana.completado && mes.completado && historico.completado,
      ultimoUsuario: historico.completado ? null : historico.ultimoUsuario,
      detalle: { semana, mes, historico },
    })
  })
}
