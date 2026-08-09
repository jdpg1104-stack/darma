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
//
// ── EL FRAGMENTO (2026-08-08) ──────────────────────────────────────────────
// Aprobar ya no es solo un sí: para una pieza LARGA es además elegir QUÉ minuto
// se enseña. La regla dura está abajo, en `exigeFragmento()`, y sale de medir
// el catálogo real: las 26 piezas aprobadas duran 55 minutos de media y el +1
// se concede al 90 % — es decir, `/animo` llevaba semanas siendo un feed que no
// pagaba karma a nadie y que enseñaba una charla de una hora en una interfaz de
// deslizar. Ver `supabase/migrations/0224_1_b07_clips.sql`.
//
// Y la segunda cola, `recorte`: los ítems que YA se aprobaron sin fragmento
// cuando esto no existía. No se les revoca la aprobación —eso vaciaría `/animo`
// de golpe— pero se les pone delante para encuadrarlos.
// ============================================================================

import { z } from 'zod'

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { createAdminClient } from '@/lib/supabase/admin'
import { CLIP_MAX_S, CLIP_MIN_S } from '@/lib/video/acreditacion'
import { requireAdmin } from '../_guard.ts'
import { ACCIONES, auditar } from '@/app/(admin)/_lib/acceso'
import { estadoDePartida, estadoResultante, motivoDeRechazo } from './decision.ts'

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
 *
 * `duration_seconds` va desde que existe el fragmento: sin ella, la pantalla no
 * puede saber si este ítem NECESITA recorte ni validar que el fin cabe dentro.
 */
const CAMPOS =
  'id, source, platform, title, summary, url, thumbnail_url, language, topic, duration_seconds, clip_start_seconds, clip_end_seconds, published_at, created_at'

const CuerpoDecision = z.object({
  id: z.string().uuid(),
  decision: z.enum(['aprobar', 'rechazar', 'recortar']),
  /** Obligatorio al rechazar: un descarte sin motivo no se puede revisar después. */
  motivo: z.string().trim().min(3).max(200).optional(),
  /**
   * El fragmento. Enteros y no `number` a secas: `start=12.5` en la URL del
   * embed lo ignora el reproductor en silencio, que es la peor forma de fallar.
   * Los topes de aquí son un filtro barato — la barrera real es el CHECK.
   */
  inicioSegundos: z.number().int().min(0).max(86_400).optional(),
  finSegundos: z.number().int().min(1).max(86_400).optional(),
})

/** Las dos colas. `recorte` solo tiene sentido desde que existe el fragmento. */
const Cola = z.enum(['pendientes', 'recorte']).catch('pendientes')

/** La cola, del más antiguo al más nuevo: lo que lleva más esperando se cura antes. */
export async function GET(request: Request) {
  return manejarRuta(async () => {
    await requireAdmin('moderador', { limite: 'lectura', accion: ACCIONES.curacionCola })

    const cola = Cola.parse(new URL(request.url).searchParams.get('cola'))
    const admin = createAdminClient()

    // Dos colas sobre la misma tabla, escritas enteras cada una. Se probó a
    // compartir el encadenado con un helper genérico y sale peor: los tipos del
    // constructor de consultas de supabase-js cambian con cada `.eq()`, y el
    // helper acaba pidiendo un `as never` que apaga justo la comprobación que
    // haría falta si mañana cambia una columna.
    const seleccion =
      cola === 'recorte'
        ? admin
            .from('content_items')
            .select(CAMPOS)
            // Lo que YA pasó la curación humana pero sigue enseñándose entero
            // pese a ser largo: la deuda que dejó aprobar antes de que el
            // fragmento existiera.
            .eq('state', 'approved')
            .is('clip_start_seconds', null)
            .gt('duration_seconds', CLIP_MAX_S)
        : admin.from('content_items').select(CAMPOS).eq('state', 'pending')

    const { data, error } = await seleccion
      .order('created_at', { ascending: true })
      .limit(LIMITE_COLA)

    if (error) throw new ErrorApi('error_interno', { causa: error })

    // El total se pide aparte y con `head`: sin él, la pantalla no puede decir
    // si quedan 3 o 300, que es la diferencia entre «ya casi» y «esto no lo
    // vacía una persona».
    const conteo =
      cola === 'recorte'
        ? admin
            .from('content_items')
            .select('id', { count: 'exact', head: true })
            .eq('state', 'approved')
            .is('clip_start_seconds', null)
            .gt('duration_seconds', CLIP_MAX_S)
        : admin.from('content_items').select('id', { count: 'exact', head: true }).eq('state', 'pending')

    const { count } = await conteo

    return sobreOk({
      cola,
      items: data ?? [],
      total: count ?? 0,
      limite: LIMITE_COLA,
      // Los topes viajan con la cola en vez de estar escritos en la pantalla:
      // son los mismos que aplican el CHECK del esquema y `clipValido()`, y una
      // cuarta copia en el cliente sería la que un día dijera 120 mientras la
      // base sigue rechazando a los 180.
      fragmento: { minSegundos: CLIP_MIN_S, maxSegundos: CLIP_MAX_S },
    })
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
    const { decision } = cuerpo
    const recortar = decision === 'recortar'
    const inicio = cuerpo.inicioSegundos ?? null
    const fin = cuerpo.finSegundos ?? null
    const conFragmento = inicio !== null || fin !== null

    const admin = createAdminClient()

    // La duración se LEE de la base, nunca se acepta del cliente. Es lo que
    // decide si el fragmento es obligatorio y contra lo que se valida que el
    // fin cabe: aceptarla del cuerpo dejaría que quien cura se saltase las dos
    // cosas declarando una duración cómoda.
    const { data: fila, error: errorLectura } = await admin
      .from('content_items')
      .select('id, state, duration_seconds')
      .eq('id', cuerpo.id)
      .maybeSingle()

    if (errorLectura) throw new ErrorApi('error_interno', { causa: errorLectura })
    if (!fila) throw new ErrorApi('no_encontrado', { mensajeClave: 'admin.curacion.yaDecidido' })

    // Las seis combinaciones que no se aceptan viven en `decision.ts`, sin
    // base de datos, y se prueban ahí.
    const rechazo = motivoDeRechazo({
      decision,
      inicioSegundos: inicio,
      finSegundos: fin,
      motivo: cuerpo.motivo,
      duracionSegundos: fila.duration_seconds,
    })
    if (rechazo) throw new ErrorApi('entrada_invalida', { mensajeClave: rechazo })

    const cambios: Record<string, unknown> = {
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    }
    const nuevoEstado = estadoResultante(decision)
    if (nuevoEstado) cambios.state = nuevoEstado
    if (decision !== 'rechazar') {
      cambios.clip_start_seconds = inicio
      cambios.clip_end_seconds = fin
    }

    // `.eq('state', …)` no es redundante con la lectura de arriba: si dos
    // moderadores abren la misma cola, el segundo no debe poder re-decidir lo
    // que el primero ya cerró. Sin esa condición, la última pulsación gana en
    // silencio.
    const { data, error } = await admin
      .from('content_items')
      .update(cambios)
      .eq('id', cuerpo.id)
      .eq('state', estadoDePartida(decision))
      .select('id, state, clip_start_seconds, clip_end_seconds')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })
    if (!data) {
      // Ni 404 ni 500: alguien llegó antes. La pantalla lo trata recargando.
      throw new ErrorApi('no_encontrado', { mensajeClave: 'admin.curacion.yaDecidido' })
    }

    const accion =
      decision === 'aprobar'
        ? ACCIONES.curacionAprobar
        : recortar
          ? ACCIONES.curacionRecortar
          : ACCIONES.curacionRechazar

    await auditar({
      actorId: ctx.userId,
      action: accion,
      // El id del ítem, NUNCA su título ni su URL: el registro de auditoría no
      // es el sitio donde acumular copias del catálogo.
      targetType: 'content_item',
      targetId: cuerpo.id,
      // El encuadre SÍ se audita: dos segundos no son datos de nadie, y la
      // pregunta tras un incidente es «¿quién eligió este minuto?».
      ...(decision === 'rechazar'
        ? { params: { motivo: cuerpo.motivo ?? '' } }
        : conFragmento
          ? { params: { inicio: String(inicio), fin: String(fin) } }
          : {}),
    })

    return sobreOk({
      id: data.id as string,
      estado: data.state as string,
      inicioSegundos: data.clip_start_seconds as number | null,
      finSegundos: data.clip_end_seconds as number | null,
    })
  })
}
