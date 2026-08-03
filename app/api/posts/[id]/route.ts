// ============================================================================
// PATCH /api/posts/[id]   — editar cuerpo y tema
// DELETE /api/posts/[id]  — retirada LÓGICA (state = 'removed')
//
// ── POR QUÉ EL PATCH REEVALÚA EL RIESGO ────────────────────────────────────
// Porque si no, editar es la puerta trasera de todo el protocolo de crisis:
// publicas «hoy hace buen día» (riesgo `none`, ninguna cola, ningún recurso) y
// acto seguido lo editas para poner lo que de verdad querías decir. Sin
// `evaluarRiesgo()` en esta ruta, ese texto no lo ve nadie. Con él, la fila de
// `crisis_events` se escribe igual y la tarjeta de recursos viaja en la misma
// respuesta que confirma la edición.
//
// El riesgo solo puede SUBIR: lo impone `greatest(risk, p_risk)` dentro de
// `b03_editar_post()`, espejo en SQL de `escalate()` de lib/crisis.ts. Editar un
// post crítico para dejarlo inocuo no lo saca de la cola humana; sacarlo es una
// decisión de un moderador, no un efecto secundario de un PATCH.
//
// ── POR QUÉ DELETE NO BORRA ────────────────────────────────────────────────
// `comments.post_id` tiene `on delete cascade`. Un borrado físico se llevaría
// por delante los comentarios de otras personas — y con ellos el hilo donde
// alguien fue escuchado y el crédito de escucha que se ganó ahí. Se marca
// `state = 'removed'`: desaparece del feed y de la vista, y el histórico queda.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import { assertNoPii, PiiDetectedError } from '@/lib/anonymity'
import { logCrisisEvent } from '@/lib/logger'
import type { RespuestaEditar, PostCreado } from '@/components/composer/contrato'
import type { TipoPost } from '@/components/composer/temas'
import {
  codigoDesdeErrorDePost,
  construirTarjetaRecursos,
  esquemaEditarPost,
  evaluarRiesgo,
  mensajeDeValidacion,
  nombresDeRecursos,
} from '../_dominio/publicar.ts'
import { adminOFallar, limitarB03, paisParaRecursos } from '../_dominio/servidor.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FilaPostEditado {
  id: string
  kind: TipoPost
  body: string
  topic: string | null
  created_at: string
}

/** Un id que no es un uuid no se manda a Postgres: ahorra un viaje y evita que
 *  el 22P02 de «uuid inválido» acabe traducido a un error que no toca. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function idValido(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params
  if (!RE_UUID.test(id)) throw new ErrorApi('no_encontrado')
  return id
}

export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta<RespuestaEditar>(async () => {
    const sesion = await requirePerfil()
    const id = await idValido(contexto.params)
    const admin = adminOFallar()

    let entrada
    try {
      entrada = esquemaEditarPost.parse(await request.json())
    } catch (causa) {
      throw new ErrorApi('entrada_invalida', {
        mensaje:
          causa instanceof Error && 'issues' in causa
            ? mensajeDeValidacion(causa as Parameters<typeof mensajeDeValidacion>[0])
            : 'No hemos podido leer lo que has enviado.',
        causa,
      })
    }

    await limitarB03('editar', sesion.userId, admin)

    // Las mismas dos barreras que en el POST, y por el mismo motivo: nadie
    // publica un teléfono en el insert, lo publica en la edición.
    try {
      assertNoPii(entrada.body)
    } catch (causa) {
      throw new ErrorApi('contenido_bloqueado', {
        mensaje: causa instanceof PiiDetectedError ? causa.message : undefined,
        causa,
      })
    }

    const riesgo = await evaluarRiesgo(entrada.body)
    const pais = riesgo.requiereIntervencion ? await paisParaRecursos(admin, sesion.userId) : null
    const tarjeta = construirTarjetaRecursos(riesgo.nivel, pais)

    const { data, error } = await admin.rpc('b03_editar_post', {
      p_author: sesion.userId,
      p_id: id,
      p_body: entrada.body,
      p_topic: entrada.topic,
      p_risk: riesgo.nivel,
      p_recursos: nombresDeRecursos(tarjeta),
      p_pais: pais,
    })

    if (error) throw new ErrorApi(codigoDesdeErrorDePost(error), { causa: error })

    const fila = (Array.isArray(data) ? data[0] : data) as FilaPostEditado | undefined
    // Cero filas = no existe, no es tuyo o ya está retirado. Los tres casos dan
    // la MISMA respuesta: distinguirlos le confirma a un desconocido que un id
    // concreto corresponde a un post real y de quién es.
    if (!fila) throw new ErrorApi('no_encontrado')

    if (riesgo.requiereIntervencion) {
      logCrisisEvent({
        postId: fila.id,
        userId: sesion.userId,
        riskLevel: riesgo.nivel,
        signalIds: riesgo.senales,
      })
    }

    const post: PostCreado = {
      id: fila.id,
      kind: fila.kind,
      body: fila.body,
      topic: fila.topic,
      creadoEn: new Date(fila.created_at).toISOString(),
    }

    return sobreOk<RespuestaEditar>({ post, recursos: tarjeta })
  })
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  return manejarRuta<{ retirado: true }>(async () => {
    const sesion = await requirePerfil()
    const id = await idValido(contexto.params)
    const admin = adminOFallar()

    await limitarB03('editar', sesion.userId, admin)

    const { data, error } = await admin.rpc('b03_retirar_post', {
      p_author: sesion.userId,
      p_id: id,
    })

    if (error) throw new ErrorApi(codigoDesdeErrorDePost(error), { causa: error })
    if (data !== true) throw new ErrorApi('no_encontrado')

    return sobreOk<{ retirado: true }>({ retirado: true })
  })
}
