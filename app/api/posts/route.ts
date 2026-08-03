// ============================================================================
// POST /api/posts — publicar
//
// ── EL ORDEN DE OPERACIONES ES EL BLOQUE ENTERO ────────────────────────────
//   1. sesión            → nunca un authorId del cuerpo (CONTRATOS §6)
//   2. zod `.strict()`   → 20–5000, kind y topic de listas cerradas
//   3. rate limit        → 5/h por persona y 20/h por IP hasheada
//   4. assertNoPii       → bloqueo DURO; el aviso del cliente es cortesía
//   5. evaluarRiesgo     → obligatorio antes de persistir (CONTRATOS §9)
//   6. insert            → aquí dispara `trg_posts_reciprocity`
//   7. traducción 23514  → reciprocidad vs. entrada_invalida, por el MENSAJE
//   8. crisis_events     → en la misma transacción que el insert
//   9. respuesta         → con los recursos DENTRO
//
// ── LO QUE NO SE HACE, Y ES DELIBERADO ─────────────────────────────────────
// No hay ningún `if (!canPublish(...)) return error` antes del INSERT. Tienta,
// porque daría un error más bonito sin ir a la base. Pero `canPublish()` mira un
// saldo leído hace segundos: con dos pestañas abiertas las dos leen 3 créditos,
// las dos pasan el `if` y las dos publican gastando el mismo crédito. La
// autoridad es el `UPDATE ... WHERE ... RETURNING` del trigger, que toma el lock
// de la fila de `profiles`. El INSERT se ejecuta SIEMPRE y su error es la
// respuesta. `lib/reciprocity.ts` solo pinta la pantalla.
//
// ── POR QUÉ EL INSERT VA POR UNA RPC Y NO POR EL CLIENTE RLS ───────────────
// Está razonado entero en la cabecera de `supabase/migrations/0103_1_b03_publicar.sql`.
// Resumen: `risk` no es escribible por el cliente (0004, y con razón: sería un
// interruptor para salirse de la cola de crisis), el post y su `crisis_events`
// tienen que entrar en la MISMA transacción para que un crítico no pueda quedar
// fuera de la cola humana, y —hoy, en esta base— `insert ... returning` con el
// cliente RLS devuelve 42501 porque la política `posts_read` de 0001 consulta
// `profiles.shadow_banned`, columna sobre la que `authenticated` no tiene
// privilegio. Ese último punto es un fallo de 0001 que afecta también a B02, B04
// y B05; está en HANDOFF/PEDIDOS.md y no se parchea desde aquí.
// El gate 3:1 NO se pierde: `trg_posts_reciprocity` es BEFORE INSERT y se
// dispara para cualquier rol, `service_role` incluido (verificado en darma-dev).
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requirePerfil } from '@/lib/auth/session'
import { assertNoPii, PiiDetectedError } from '@/lib/anonymity'
import { CLAVE_RECHAZO_SERVIDOR, reciprocityMessage } from '@/lib/reciprocity'
import { logCrisisEvent, logger } from '@/lib/logger'
import type { RespuestaPublicar, PostCreado } from '@/components/composer/contrato'
import type { TipoPost } from '@/components/composer/temas'
import {
  codigoDesdeErrorDePost,
  construirTarjetaRecursos,
  esquemaCrearPost,
  evaluarRiesgo,
  mensajeDeValidacion,
  nombresDeRecursos,
} from './_dominio/publicar.ts'
import { adminOFallar, limitarB03, limitarPorIp, paisParaRecursos } from './_dominio/servidor.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Fila que devuelve `b03_publicar_post()`. Se declara a mano porque
 *  `lib/supabase/database.types.ts` (dueño B15) todavía no conoce esta RPC:
 *  se regenera en CI tras aplicar 0103_1. Anotado en HANDOFF/PEDIDOS.md. */
interface FilaPostCreado {
  id: string
  kind: TipoPost
  body: string
  topic: string | null
  created_at: string
}

export async function POST(request: Request) {
  return manejarRuta<RespuestaPublicar>(async () => {
    // 1 · Sesión. El autor sale de aquí y de ningún otro sitio.
    const sesion = await requirePerfil()

    const admin = adminOFallar()

    // 2 · Validación. `.strict()`: un `authorId` en el cuerpo no se ignora, se
    // rechaza. Ni siquiera se lee.
    let entrada
    try {
      entrada = esquemaCrearPost.parse(await request.json())
    } catch (causa) {
      throw new ErrorApi('entrada_invalida', {
        mensaje:
          causa instanceof Error && 'issues' in causa
            ? mensajeDeValidacion(causa as Parameters<typeof mensajeDeValidacion>[0])
            : 'No hemos podido leer lo que has enviado.',
        causa,
      })
    }

    // 3 · Rate limit. Por persona y por IP: el segundo cubre el registro masivo
    // seguido de publicación, que el primero no ve porque cada cuenta nueva
    // estrena contador.
    await limitarB03('publicar', sesion.userId, admin)
    await limitarPorIp('publicarPorIp', request, admin)

    // 4 · PII. Bloqueo DURO. El aviso del composer al perder el foco es una
    // cortesía; cualquiera puede hacer este POST con curl saltándose el
    // componente. El cliente nunca es autoridad.
    try {
      assertNoPii(entrada.body)
    } catch (causa) {
      throw new ErrorApi('contenido_bloqueado', {
        // El mensaje de PiiDetectedError está escrito para la persona y explica
        // qué quitar sin regañar; no filtra nada interno.
        mensaje: causa instanceof PiiDetectedError ? causa.message : undefined,
        causa,
      })
    }

    // 5 · Riesgo. Antes de persistir, sin excepción (CONTRATOS §9).
    const riesgo = await evaluarRiesgo(entrada.body)

    // El país solo se consulta si de verdad va a haber tarjeta: es el dato más
    // sensible de la app y no se toca en el camino normal.
    const pais = riesgo.requiereIntervencion ? await paisParaRecursos(admin, sesion.userId) : null
    const tarjeta = construirTarjetaRecursos(riesgo.nivel, pais)

    // 6 · El INSERT. Post + risk + crisis_events, una transacción.
    const { data, error } = await admin.rpc('b03_publicar_post', {
      p_author: sesion.userId,
      p_kind: entrada.kind,
      p_body: entrada.body,
      p_topic: entrada.topic,
      p_risk: riesgo.nivel,
      p_recursos: nombresDeRecursos(tarjeta),
      p_pais: pais,
    })

    // 7 · Los dos 23514. Se discrimina por el PREFIJO del mensaje, nunca por el
    // código: ver la explicación larga en `_dominio/publicar.ts`.
    if (error) {
      const codigo = codigoDesdeErrorDePost(error)

      if (codigo === 'reciprocidad') {
        // El trigger usa UN solo UPDATE para el saldo y para el baneo, así que
        // levanta el MISMO mensaje en los dos casos. La sesión sí sabe
        // distinguirlos, y decirle «te falta acompañar a alguien» a quien está
        // en pausa es mentira y además le hace perder el tiempo escuchando.
        const enPausa = sesion.bannedUntil !== null && new Date(sesion.bannedUntil).getTime() > Date.now()
        if (enPausa) {
          const { clave, params } = reciprocityMessage({
            listenCredits: 0,
            postsPublished: 1,
            bannedUntil: sesion.bannedUntil,
          })
          throw new ErrorApi('sin_permiso', { mensajeClave: clave, mensajeParams: params })
        }

        throw new ErrorApi('reciprocidad', { mensajeClave: CLAVE_RECHAZO_SERVIDOR, causa: error })
      }

      throw new ErrorApi(codigo, { causa: error })
    }

    const fila = (Array.isArray(data) ? data[0] : data) as FilaPostCreado | undefined
    if (!fila) throw new ErrorApi('error_interno')

    // 8 · La fila de `crisis_events` ya se escribió DENTRO de la RPC. Aquí solo
    // queda el log, que registra los ids de patrón y NUNCA el texto: medir la
    // calidad del triaje no puede exigir que alguien lea lo que una persona
    // escribió en su peor momento.
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

    // 9 · Los recursos van AQUÍ, en el mismo JSON. No en la pantalla siguiente,
    // no en un correo: CONTRATOS §9.1. Y el post queda `active`: se marca y se
    // prioriza, no se esconde (§9.2, «se prioriza, no se censura»).
    return sobreOk<RespuestaPublicar>({ post, recursos: tarjeta }, 201)
  })
}

/**
 * `GET /api/posts` no existe: leer posts es el feed, y el feed es de B02
 * (`/api/feed/*`, CONTRATOS §7). Se declara el 405 explícitamente para que la
 * ausencia sea una decisión visible y no un despiste que alguien "arregle"
 * añadiendo aquí una consulta sin paginación keyset.
 */
export async function GET() {
  return manejarRuta<never>(async () => {
    logger.info('b03_get_posts_no_soportado')
    throw new ErrorApi('no_encontrado')
  })
}
