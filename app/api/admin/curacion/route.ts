// ============================================================================
// /api/admin/curacion — vaciar la cola de contenido pendiente
//
// ── POR QUÉ ESTA RUTA EXISTE ───────────────────────────────────────────────
// Hasta hoy, aprobar contenido solo se podía hacer con SQL a mano. No es una
// carencia de comodidad: `scripts/ingest/revisar-pendientes.ts` LISTA la cola y
// dice explícitamente que no aprueba nada, porque «aprobar es una decisión
// humana y se toma con el vídeo delante». Sin pantalla, esa frase describía algo
// que no se podía hacer — y lo que de verdad pasó fue una aprobación en bloque
// por SQL de 30 vídeos que nadie miró. Esta ruta es lo que convierte esa regla
// en algo cumplible.
//
// ── SE AUDITA CADA DECISIÓN, UNA POR UNA ──────────────────────────────────
// No hay endpoint de «aprobar todo». Es deliberado: un botón que aprueba en
// bloque reproduce exactamente el atajo que esta pantalla viene a cerrar, y la
// auditoría diría «aprobó 30» cuando la pregunta tras un incidente es «¿quién
// dejó pasar ESTE?».
//
// ── ROL MÍNIMO: `moderador` ────────────────────────────────────────────────
// Es la decisión de contenido más parecida a la que ya toma `/moderacion`, y
// pedir `operaciones` obligaría a dar permisos de más a quien solo cura.
// ============================================================================

import { z } from 'zod'

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../_guard.ts'
import { ACCIONES, auditar } from '@/app/(admin)/_lib/acceso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Techo de la cola que se sirve de una vez. Una pantalla no es un volcado. */
const LIMITE_COLA = 40

/**
 * Lo que se enseña de cada candidato.
 *
 * `url` va porque SIN ELLA no se puede curar: la regla es mirar el vídeo, y para
 * eso hay que poder abrirlo. Es también la única ruta de admin que devuelve
 * texto de contenido, y puede hacerlo porque `content_items` es catálogo
 * público en curso — NO hay nada de una persona aquí, ni alias, ni país.
 */
const CAMPOS = 'id, source, platform, title, summary, url, thumbnail_url, language, topic, published_at, created_at'

const CuerpoDecision = z.object({
  id: z.string().uuid(),
  decision: z.enum(['aprobar', 'rechazar']),
  /** Obligatorio al rechazar: un descarte sin motivo no se puede revisar después. */
  motivo: z.string().trim().min(3).max(200).optional(),
})

/** La cola, del más antiguo al más nuevo: lo que lleva más esperando se cura antes. */
export async function GET() {
  return manejarRuta(async () => {
    await requireAdmin('moderador', { limite: 'lectura', accion: ACCIONES.curacionCola })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('content_items')
      .select(CAMPOS)
      .eq('state', 'pending')
      .order('created_at', { ascending: true })
      .limit(LIMITE_COLA)

    if (error) throw new ErrorApi('error_interno', { causa: error })

    // El total se pide aparte y con `head`: sin él, la pantalla no puede decir
    // si quedan 3 o 300, que es la diferencia entre «ya casi» y «esto no lo
    // vacía una persona».
    const { count } = await admin
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending')

    return sobreOk({ items: data ?? [], total: count ?? 0, limite: LIMITE_COLA })
  })
}

/** Una decisión, sobre UN ítem. Ver la cabecera: no hay aprobación en bloque. */
export async function POST(request: Request) {
  return manejarRuta(async () => {
    const ctx = await requireAdmin('moderador', {
      limite: 'curacion',
      accion: ACCIONES.curacionAprobar,
    })

    const cuerpo = CuerpoDecision.parse(await request.json())
    const aprobar = cuerpo.decision === 'aprobar'

    if (!aprobar && !cuerpo.motivo) {
      throw new ErrorApi('entrada_invalida', { mensajeClave: 'curacion.motivoObligatorio' })
    }

    const admin = createAdminClient()

    // `.eq('state', 'pending')` no es redundante: si dos moderadores abren la
    // misma cola, el segundo no debe poder re-decidir lo que el primero ya
    // cerró. Sin esa condición, la última pulsación gana en silencio.
    const { data, error } = await admin
      .from('content_items')
      .update({
        state: aprobar ? 'approved' : 'rejected',
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', cuerpo.id)
      .eq('state', 'pending')
      .select('id')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })
    if (!data) {
      // Ni 404 ni 500: alguien llegó antes. La pantalla lo trata recargando.
      throw new ErrorApi('no_encontrado', { mensajeClave: 'curacion.yaDecidido' })
    }

    await auditar({
      actorId: ctx.userId,
      action: aprobar ? ACCIONES.curacionAprobar : ACCIONES.curacionRechazar,
      // El id del ítem, NUNCA su título ni su URL: el registro de auditoría no
      // es el sitio donde acumular copias del catálogo.
      targetType: 'content_item',
      targetId: cuerpo.id,
      ...(aprobar ? {} : { params: { motivo: cuerpo.motivo ?? '' } }),
    })

    return sobreOk({ id: data.id as string, estado: aprobar ? 'approved' : 'rejected' })
  })
}
