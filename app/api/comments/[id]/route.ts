// ============================================================================
// PATCH / DELETE /api/comments/[id] — editar y retirar tu propia respuesta
//
// Las dos escriben con el cliente RLS. La política `comments_update_own`
// (migración `0104_1_hilo.sql`) decide la FILA —la tuya, y mientras siga
// activa— y el `grant update (body, state)` de 0001 decide las COLUMNAS. Ni
// `is_validated`, ni `quality_score`, ni `is_helpful`, ni `upvote_count` están
// al alcance de este camino: no hace falta acordarse de no tocarlos.
//
// DELETE es un borrado BLANDO (`state = 'removed'`). Un hilo de apoyo con
// huecos donde había respuestas es una conversación que deja de entenderse, y
// además la señal de moderación sobre un autor debe sobrevivir al contenido.
//
// ── EL VECTOR DE FARMEO QUE VIGILA PATCH ───────────────────────────────────
// Escribir algo bueno, cobrar los +10 y el crédito, y sustituirlo después por
// «ánimo». No se bloquea la edición (eso obligaría a elegir entre corregir una
// errata y conservar la escucha) y tampoco se retira el karma desde aquí:
// quitar reputación es una decisión de moderación, no de una heurística de
// longitud —el mismo criterio que la ficha fija para `spam_penalty`—. Lo que sí
// se hace es dejar constancia: si el texto nuevo ya no validaría y el
// comentario estaba validado, se escribe una señal en `moderation_flags`.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirPerfil, getContextoSesion } from '@/lib/auth/session'
import { assertNoPii, PiiDetectedError } from '@/lib/anonymity'
import { paisDePeticion } from '@/lib/auth/peticion'

import { limitarHilo } from '../limites.ts'
import { evaluar, registrar } from '../crisisHilo.ts'
import { validadorPorDefecto } from '../validador.ts'
import { esquemaEditarComentario, esquemaUuid, leerJson, validar } from '../validacion.ts'
import type { TarjetaRecursosDatos } from '../tipos.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function userIdConPerfil(): Promise<string> {
  const contexto = await getContextoSesion()
  if (!contexto) throw new ErrorApi('no_autenticado')
  exigirPerfil(contexto.sesion)
  return contexto.sesion.userId
}

export interface RespuestaEditar {
  id: string
  body: string
  /** No null ⇒ pinta la tarjeta de recursos en esta misma pantalla. */
  recursos: TarjetaRecursosDatos | null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejarRuta(async () => {
    const userId = await userIdConPerfil()

    const admin = createAdminClient()
    await limitarHilo('editar', userId, admin)

    const comentarioId = validar(esquemaUuid, (await params).id)
    const entrada = validar(esquemaEditarComentario, await leerJson(request))

    // PII y crisis también en PATCH: si solo se comprobaran en el POST, editar
    // sería la puerta trasera para publicar un teléfono.
    try {
      assertNoPii(entrada.body)
    } catch (causa) {
      if (causa instanceof PiiDetectedError) {
        throw new ErrorApi('contenido_bloqueado', { mensaje: causa.message })
      }
      throw causa
    }

    const pais = paisDePeticion(request)
    const evaluacion = evaluar(entrada.body, pais)

    const supabase = await createClient()

    const { data: actual, error: errorLectura } = await supabase
      .from('comments')
      .select('id, author_id, is_validated')
      .eq('id', comentarioId)
      .eq('state', 'active')
      .maybeSingle()

    if (errorLectura) throw new ErrorApi('error_interno', { causa: errorLectura })
    if (!actual) throw new ErrorApi('no_encontrado')
    if (actual.author_id !== userId) throw new ErrorApi('sin_permiso')

    const { data: editado, error } = await supabase
      .from('comments')
      .update({ body: entrada.body })
      .eq('id', comentarioId)
      .select('id, body')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })
    // Sin fila devuelta la política no dejó escribir: no se distingue de «no
    // existe» de cara al cliente.
    if (!editado) throw new ErrorApi('sin_permiso')

    await registrar(admin, evaluacion, userId, comentarioId, pais)

    // ── La vigilancia del vector de farmeo (ver cabecera).
    if (actual.is_validated) {
      const veredicto = await validadorPorDefecto.validar(entrada.body)
      if (!veredicto.valido) {
        const { error: errorSenal } = await admin.from('moderation_flags').insert({
          ref_type: 'comment',
          ref_id: comentarioId,
          subject_id: userId,
          signal: 'edited_after_validation',
          // Severidad 3 y no 1: a diferencia de un comentario flojo, esto tiene
          // una lectura deliberada y ya se ha cobrado por ello.
          severity: 3,
          detail: `score=${veredicto.score}`,
        })
        if (errorSenal) {
          console.error('[darma][b04] no se pudo registrar moderation_flags', { code: errorSenal.code })
        }
      }
    }

    return sobreOk<RespuestaEditar>({
      id: editado.id,
      body: editado.body,
      recursos: evaluacion.tarjeta,
    })
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return manejarRuta(async () => {
    const userId = await userIdConPerfil()
    const comentarioId = validar(esquemaUuid, (await params).id)

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('comments')
      .update({ state: 'removed' })
      .eq('id', comentarioId)
      .eq('author_id', userId)
      .select('id')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })
    if (!data) throw new ErrorApi('no_encontrado')

    // `posts.reply_count` NO se decrementa: el trigger de 0001 solo suma al
    // validar y no hay ninguno para el borrado blando. Es una divergencia
    // conocida del contador y está anotada en HANDOFF/PEDIDOS.md; corregirla
    // significa tocar 0001, que no es de este bloque.
    return sobreOk<{ id: string }>({ id: data.id })
  })
}
