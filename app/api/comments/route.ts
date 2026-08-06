// ============================================================================
// POST / GET /api/comments — el acto central de Darma
//
// ⚠️ UN APOYO («like») NO DA KARMA Y NO CUENTA COMO ESCUCHA. ⚠️
//
// Está escrito aquí, en mayúsculas y arriba del todo, porque es la invariante
// que sostiene el modelo entero: en Darma la moneda es la palabra escrita y
// validada, no el aplauso. El apoyo mueve `upvote_count` y nada más — el voto
// sobre el post lo gestiona B03 en `/api/posts/[id]/voto`. Si algún día alguien
// «arregla» esto dando karma por likes porque «así hay más señal», el sistema
// de reciprocidad deja de significar nada: farmear se vuelve gratis y quien
// viene a que le escuchen recibe emojis. Hay un test que lo vigila; no lo
// borres aunque parezca trivial.
//
// ── EL ORDEN DEL POST NO ES ARBITRARIO ─────────────────────────────────────
//  1. Sesión (y perfil creado).           7. Registrar la crisis (ya hay uuid).
//  2. Rate limit.                          8. Validación de calidad SÍNCRONA.
//  3. Zod `.strict()`.                     9. UPDATE con cliente ADMIN → el
//  4. PII.                                    trigger paga +10 y +1 crédito.
//  5. Riesgo de crisis (puro).            10. Leer del ledger lo REALMENTE
//  6. Post + historial (en paralelo)          pagado.
//     + INSERT.
//
// Lo importante del orden: nada caro ocurre antes del rate limit, nada se
// persiste antes de la comprobación de PII, y el karma se LEE en vez de
// asumirse. Y desde el enganche de B11, la crisis se registra UNA sola vez:
// la ruta O el pipeline, nunca ambos (ver `laRegistraElPipeline` abajo).
//
// ── POR QUÉ LA VALIDACIÓN ES SÍNCRONA Y NO UNA COLA ────────────────────────
// Porque la persona necesita saber AL MOMENTO si su escucha contó. Diferirlo a
// una cola convierte el crédito de reciprocidad en un número que aparece
// «cuando le da la gana», y con él la única explicación de por qué todavía no
// puede publicar. La validación por defecto es pura y sin I/O, así que ser
// síncrono no cuesta un solo salto de red.
//
// ── LOS TRES USOS DEL CLIENTE ADMIN EN TODO EL BLOQUE ──────────────────────
//  (1) `is_validated` + `quality_score`  ← aquí abajo.
//  (2) `is_helpful`                      ← `[id]/util/route.ts`.
//  (3) `crisis_events` y `moderation_flags` ← aquí, en `crisisHilo.ts` y,
//      desde el enganche de B11, dentro del pipeline al que este MISMO admin
//      viaja vía `ContextoValidacionIA` (presupuesto, auditoría y crisis):
//      es el uso (3) entrando por otra puerta.
// No hay una cuarta. (El cliente admin que reciben los límites no escribe en
// ninguna tabla de dominio; ver `limites.ts`.)
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { exigirPerfil, getContextoSesion } from '@/lib/auth/session'
import { perfilPublicoDesde } from '@/lib/auth/perfil'
import { assertNoPii, PiiDetectedError } from '@/lib/anonymity'
import { paisDePeticion } from '@/lib/auth/peticion'
import { hayClaveIA } from '@/lib/ai/cliente'

import { limitarHilo } from './limites.ts'
import { evaluar, registrar } from './crisisHilo.ts'
import { leerPreviosDelAutor } from './historial.ts'
import {
  ValidadorHeuristico,
  validadorPorDefecto,
  type ContextoValidacionIA,
} from './validador.ts'
import { leerHilo } from './consulta.ts'
import { decodificarCursor } from './cursor.ts'
import {
  esEscuchaDuplicada,
  karmaConcedido,
  validacionRepetida,
} from './dominio.ts'
import {
  esquemaCrearComentario,
  esquemaListado,
  leerJson,
  parametros,
  validar,
} from './validacion.ts'
import type {
  ComentarioHilo,
  PaginaCursor,
  RespuestaComentar,
  ResultadoValidacion,
} from './tipos.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Suelo heurístico con el que se decide QUIÉN registra la crisis (la ruta o el
 * pipeline de B11). Es la MISMA implementación que el validador usa por dentro:
 * pura, determinista y sin estado, así que instanciarla una vez es gratis.
 */
const sueloHeuristico = new ValidadorHeuristico()

/** Contexto de sesión con perfil ya creado. Una sola consulta, memoizada. */
async function contextoConPerfil() {
  const contexto = await getContextoSesion()
  if (!contexto) throw new ErrorApi('no_autenticado')
  exigirPerfil(contexto.sesion)
  if (!contexto.fila) throw new ErrorApi('sin_permiso')
  return { userId: contexto.sesion.userId, fila: contexto.fila }
}

/** Convierte `PiiDetectedError` en `contenido_bloqueado` conservando el copy. */
function comprobarPii(texto: string): void {
  try {
    assertNoPii(texto)
  } catch (causa) {
    if (causa instanceof PiiDetectedError) {
      // El mensaje de `PiiDetectedError` está escrito para la persona y explica
      // el porqué sin regañar; no se sustituye por el genérico.
      throw new ErrorApi('contenido_bloqueado', { mensaje: causa.message })
    }
    throw causa
  }
}

// ============================================================================
// POST /api/comments
// ============================================================================
export async function POST(request: Request) {
  return manejarRuta(async () => {
    const { userId, fila } = await contextoConPerfil()

    const admin = createAdminClient()
    await limitarHilo('comment', userId, admin)

    const entrada = validar(esquemaCrearComentario, await leerJson(request))
    comprobarPii(entrada.body)

    // Riesgo evaluado ANTES de persistir (CONTRATOS §9). Es una función pura;
    // el registro en `crisis_events` va después, cuando ya hay un uuid al que
    // apuntar. Nunca bloquea la publicación: se prioriza, no se censura.
    const pais = paisDePeticion(request)
    const evaluacion = evaluar(entrada.body, pais)

    const supabase = await createClient()

    // ── 1ª y 2ª consultas, A LA VEZ. Las dos alimentan la MISMA validación y
    // ninguna depende de la otra ni del INSERT, así que el historial viaja al
    // lado del post y no añade un solo salto de red al camino de comentar. Que
    // sea barato importa: si detectar la plantilla costara latencia a todo el
    // mundo, la siguiente persona que mire este archivo la quitaría.
    //
    //    · El post: `author_id` para impedir el autocomentario —el índice único
    //      `uq_comments_one_listen_per_post` impide 3 créditos en el mismo
    //      post, pero NO impide que alguien se gane el crédito comentando su
    //      propio desahogo, que es la vía de farmeo más obvia de todas— y
    //      `body` para que la validación pueda detectar el eco (copiar el post
    //      y devolvérselo no es escuchar).
    //      Si RLS lo oculta o no existe, `maybeSingle()` devuelve null y la
    //      respuesta es la MISMA en los dos casos: distinguir «retirado» de «no
    //      existe» le confirma a quien sondea que ese uuid existió.
    //    · El historial: los comentarios recientes de quien escribe, que es lo
    //      que enciende `self_repetition`. Sin esto, la misma plantilla pegada
    //      en doce posts distintos cobra doce veces. Ver `historial.ts` para
    //      cuántos, en qué ventana y qué pasa si la consulta falla.
    const [{ data: post, error: errorPost }, historial] = await Promise.all([
      supabase
        .from('posts')
        .select('id, author_id, body')
        .eq('id', entrada.postId)
        .eq('state', 'active')
        .maybeSingle(),
      // Sin `autorId`: desde 0222 el autor sale de `auth.uid()` dentro de la
      // función, así que ya no hay forma de pedir el historial de otra persona.
      leerPreviosDelAutor(supabase),
    ])

    if (errorPost) throw new ErrorApi('error_interno', { causa: errorPost })
    if (!post) throw new ErrorApi('no_encontrado')

    if (post.author_id === userId) {
      throw new ErrorApi('sin_permiso', {
        mensaje: 'Este desahogo es tuyo. Puedes responder a quien te escriba, pero acompañarte a ti mismo no cuenta como escucha.',
      })
    }

    // ── 2ª consulta: el INSERT. Con el cliente RLS y con las TRES columnas que
    // 0004 dejó abiertas: `grant insert (post_id, author_id, body)`. No se
    // menciona `is_validated` ni para ponerlo a false —su default ya lo es— y,
    // desde 0004, el intento ni siquiera compilaría en Postgres: sería
    // `permission denied for column`. El comentario nace sin validar porque la
    // base lo impide, no porque nos acordemos.
    const { data: creado, error: errorInsert } = await supabase
      .from('comments')
      .insert({ post_id: entrada.postId, author_id: userId, body: entrada.body })
      .select('id, author_id, body, is_validated, is_helpful, upvote_count, created_at')
      .single()

    if (errorInsert || !creado) throw new ErrorApi('error_interno', { causa: errorInsert })

    // ── Contexto COMPLETO del validador (el enganche que pedía B11):
    // `autorId` SIEMPRE de la sesión (jamás del body), `refId` del comentario
    // YA insertado, el `admin` de esta ruta para presupuesto/auditoría/crisis
    // del pipeline, y el `pais` ya resuelto en el borde para que el pipeline no
    // viaje a `identity_vault`. Sin `autorId` el validador cae a heurística a
    // propósito.
    const contextoIA: ContextoValidacionIA = {
      postBody: post.body,
      // Fusión de dos frentes que llegaron a la vez: el historial del autor
      // viaja DENTRO del contexto de IA y no por una llamada aparte, así que lo
      // ven las DOS capas — el suelo heurístico (`self_repetition`) y el
      // modelo, que además puede juzgar una plantilla mejor que un Jaccard.
      previosDelAutor: historial.previos,
      autorId: userId,
      refId: creado.id,
      admin,
      pais,
    }

    // ── QUIÉN registra la crisis: la ruta O el pipeline, nunca ambos.
    // Con `admin` en el contexto, `evaluarContenido()` (B11) escribe
    // `crisis_events` por su cuenta — y su registro es mejor: añade la escalada
    // por LLM. El pipeline corre EXACTAMENTE cuando hay clave y el suelo
    // heurístico aprueba (ver `ValidadorIA.validar`); en ese camino la ruta NO
    // registra, porque escribiría la fila dos veces. Si el pipeline corre y
    // luego DEGRADA (timeout, refusal, presupuesto), su registro por reglas ya
    // quedó escrito ANTES de tocar la red, así que tampoco se pierde. En todos
    // los demás caminos —sin clave, que es el estado real de hoy, o con el
    // suelo en contra— el pipeline no llega a correr y el registro sigue
    // siendo de esta ruta. El suelo es puro y determinista
    // (`lib/moderation.ts`): evaluarlo aquí y dentro del validador da el mismo
    // veredicto. Vigilado por `enganche.test.ts`.
    const laRegistraElPipeline =
      evaluacion.tarjeta !== null &&
      hayClaveIA() &&
      (await sueloHeuristico.validar(entrada.body, contextoIA)).valido

    if (!laRegistraElPipeline) {
      await registrar(admin, evaluacion, userId, creado.id, pais)
    }

    // Si el historial no se pudo leer, se avisa AQUÍ y se sigue. Un fallo de
    // base de datos no puede convertirse en el rechazo de una escucha sincera:
    // «no pude comprobarlo» no es «es una plantilla». Lo que no puede es pasar
    // en silencio —un filtro antifarmeo apagado sin ruido es peor que no
    // tenerlo—, así que queda el aviso con prefijo estable. No sale nada de
    // esto hacia el cliente: contar que la comprobación está ciega es publicar
    // la ventana por la que colar la plantilla.
    if (historial.estado === 'no_disponible') {
      console.warn('[darma][b04] historial del autor no disponible; se valida sin la señal de plantilla', {
        code: historial.codigo,
      })
    }

    // ── Validación de calidad, síncrona.
    const veredicto = await validadorPorDefecto.validar(entrada.body, contextoIA)

    let validacion: ResultadoValidacion
    let creditoGanado = 0
    let karmaGanado = 0

    if (veredicto.valido) {
      // ⛔ EXCEPCIÓN DE ADMIN (1 de 3): `authenticated` solo tiene
      // `grant update (body, state) on comments`, así que este UPDATE con el
      // cliente RLS devolvería 200 y NO escribiría la columna — el peor tipo de
      // fallo, el silencioso. Es también lo que impide que alguien se
      // autovalide con un PATCH directo a PostgREST.
      const { data: validado, error: errorValidar } = await admin
        .from('comments')
        .update({ is_validated: true, quality_score: veredicto.score })
        .eq('id', creado.id)
        .eq('is_validated', false)
        .select('id')
        .maybeSingle()

      if (errorValidar) {
        if (!esEscuchaDuplicada(errorValidar)) {
          throw new ErrorApi('error_interno', { causa: errorValidar })
        }
        // 23505 sobre `uq_comments_one_listen_per_post`: esta persona ya había
        // acompañado a la del post. No es un error, es la regla antifarmeo
        // funcionando. El comentario queda publicado sin validar y sin crédito.
        validacion = validacionRepetida()
      } else {
        validacion = { estado: 'valido', motivo: null }
        // El `returning` confirma que la columna cambió de verdad (trampa
        // conocida nº 2 de la ficha). Si no cambió, el trigger no corrió y no
        // se anuncia un crédito que nadie ha ganado.
        if (validado) {
          creditoGanado = 1

          // El trigger corrió en ESTA misma transacción: +1 listen_credits,
          // +1 listens_given, award_karma('comment_validated') y +1
          // posts.reply_count. No se consulta ninguno de esos contadores; solo
          // el ledger, y solo para saber CUÁNTO se pagó.
          const { data: evento } = await supabase
            .from('karma_events')
            .select('delta_reputation')
            .eq('idempotency_key', `comment_validated:${creado.id}`)
            .limit(1)

          karmaGanado = karmaConcedido(evento)
        }
      }
    } else {
      // ⛔ EXCEPCIÓN DE ADMIN (3 de 3, segunda mitad): `moderation_flags` tiene
      // RLS activa y CERO políticas, igual que `crisis_events`.
      const { error: errorSenal } = await admin.from('moderation_flags').insert({
        ref_type: 'comment',
        ref_id: creado.id,
        subject_id: userId,
        signal: 'low_quality',
        severity: 1,
        // El score va al registro de moderación, NO a la respuesta: publicar la
        // cifra es publicar el manual para quedarse justo por encima del umbral.
        detail: `score=${veredicto.score}`,
      })

      if (errorSenal) {
        console.error('[darma][b04] no se pudo registrar moderation_flags', { code: errorSenal.code })
      }

      // NO se aplica `spam_penalty` (−40) desde aquí: quitar reputación lo
      // decide B11 o moderación humana, nunca una heurística de longitud.
      validacion = { estado: 'no_valido', motivo: veredicto.motivo }
    }

    const comentario: ComentarioHilo = {
      id: creado.id,
      autor: perfilPublicoDesde(fila),
      body: creado.body,
      validado: creditoGanado === 1,
      esUtil: false,
      apoyos: creado.upvote_count,
      creadoEn: creado.created_at,
      esMio: true,
    }

    return sobreOk<RespuestaComentar>(
      {
        comentario,
        validacion,
        creditoGanado,
        karmaGanado,
        recursos: evaluacion.tarjeta,
      },
      201,
    )
  })
}

// ============================================================================
// GET /api/comments?postId&cursor&limite
// ============================================================================
export async function GET(request: Request) {
  return manejarRuta(async () => {
    const { userId } = await contextoConPerfil()

    const consulta = validar(esquemaListado, parametros(request))
    const supabase = await createClient()

    // Un cursor ilegible NO es un error: es la primera página con un 200. Ver
    // el porqué en `cursor.ts`.
    const pagina = await leerHilo(supabase, {
      postId: consulta.postId,
      userId,
      limite: consulta.limite,
      cursor: decodificarCursor(consulta.cursor),
    })

    return sobreOk<PaginaCursor<ComentarioHilo>>(pagina)
  })
}
