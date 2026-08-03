// ============================================================================
// La consulta del feed: tres carriles keyset + interleave determinista
//
// TRES CONSULTAS POR RENDER, EXACTAMENTE (CONTRATOS §11): posts, contenido y
// encuestas, lanzadas en paralelo. `heVotado` NO es una cuarta: se resuelve
// dentro de la consulta de posts con un `exists` correlacionado sobre la clave
// primaria de `post_votes` (ver la RPC en 0102_1_feed_keyset.sql). Una consulta
// «solo una más» por página es un N+1 que todavía no ha crecido.
//
// ── POR QUÉ RPC Y NO EL QUERY BUILDER DE supabase-js ────────────────────────
// La paginación keyset necesita una comparación de TUPLA:
// `(hot_score, id) < (:score, :id)`. PostgREST no la sabe expresar, y el `.or()`
// de supabase-js genera `hot_score < X or id < Y`, que devuelve filas de más y
// hace que el scroll repita tarjetas. Se ve poco y se nota mucho: el usuario
// concluye que «la app se repite». Por eso el predicado se escribe a mano en
// SQL, en una función `security invoker` para que RLS siga mandando.
//
// ── LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO ────────────────────────────
//  · No usa NUNCA el cliente admin. Si una fila no aparece, es que RLS ha
//    decidido que no debe aparecer: eso es el sistema funcionando, no un bug que
//    haya que rodear con `service_role`.
//  · No filtra `shadow_banned`. Lo hace la política `posts_read`, y repetirlo
//    aquí escondería también los posts PROPIOS de quien está silenciado — que
//    debe seguir viéndolos con normalidad, o sabrá que lo está y se creará otra
//    cuenta.
//  · No hace `count(*)` para saber si hay más. Se mira si la consulta devolvió
//    menos filas de las pedidas.
//
// ── LA REGLA DE CRISIS, QUE ES LA QUE MÁS IMPORTA ───────────────────────────
// Un post con `risk` alto o crítico entra en el feed con su `hot_score` normal:
// ni se filtra, ni se desprioriza, ni se manda al final. Se prioriza a la
// persona, no se la censura (CONTRATOS §9). Lo único prohibido es AMPLIFICARLO:
// nunca recibe `BOOST_BONUS` —lo garantiza `isBoostEligible()`, que se llama en
// vez de reimplementar la condición— y nunca ocupa un slot de interleave, que es
// espacio de promoción. Bajarlos «para que no molesten» es la optimización más
// natural del mundo y está prohibida: quien escribe desde ahí necesita ser
// visto, no archivado.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isBoostEligible } from '../../../lib/feedRanking.ts'
import { ErrorApi } from '../../../lib/auth/errores.ts'
import type { KarmaLevel } from '../../../lib/karma.ts'
import type { Disponibilidad } from '../../../lib/auth/session.ts'
import {
  codificarCursor,
  type CursorCompuesto,
  type PosicionTemporal,
} from './cursor.ts'
import type {
  Carril,
  ContenidoFeed,
  ElementoFeed,
  PaginaFeed,
  PostFeed,
  TipoPost,
} from './tipos.ts'

// ── Formas de fila ──────────────────────────────────────────────────────────
// Se declaran a mano y no se derivan de `Database` (CONTRATOS §3) porque
// `lib/supabase/database.types.ts` se genera contra el esquema y todavía no
// contiene las cuatro funciones de la migración 0102_1. En cuanto B15 lo
// regenere, estas tres interfaces se sustituyen por
// `Database['public']['Functions']['feed_keyset']['Returns'][number]` y
// equivalentes. Anotado en HANDOFF/PEDIDOS.md.

/** Fila de `feed_keyset` / `feed_keyset_nuevo`. */
export interface FilaFeedPost {
  id: string
  autor_id: string
  kind: TipoPost
  body: string
  topic: string | null
  upvote_count: number
  reply_count: number
  hot_score: number
  boost_until: string | null
  risk: 'none' | 'low' | 'high' | 'critical'
  created_at: string
  he_votado: boolean
  alias: string
  avatar_seed: string
  level: KarmaLevel
  availability: Disponibilidad
  karma_reputation: number
}

/** Fila de `feed_contenido_keyset`. */
export interface FilaFeedContenido {
  id: string
  title: string
  summary: string | null
  url: string
  thumbnail_url: string | null
  platform: string
  duration_seconds: number | null
  topic: string | null
  performance_score: number
}

/** Fila de `feed_encuestas_keyset`. */
export interface FilaFeedEncuesta {
  id: string
  created_at: string
}

// ── Interleave ──────────────────────────────────────────────────────────────

/**
 * Posiciones FIJAS del interleave, en índices de la página ya montada.
 *
 * Fijas y no aleatorias, y esto no es un detalle: con `Math.random()` en el
 * servidor, dos renders de la misma página dan resultados distintos, el cursor
 * deja de casar con lo que el usuario vio y al hacer scroll aparecen elementos
 * repetidos. Determinista significa que recargar devuelve exactamente lo mismo.
 *
 * Los slots son espacio de PROMOCIÓN: solo los ocupan contenido curado y
 * encuestas. Ningún post entra en ellos, y en particular ninguno en crisis
 * (ficha B02 §5).
 */
export const SLOTS_INTERLEAVE = [
  { indice: 3, tipo: 'contenido' },
  { indice: 8, tipo: 'encuesta' },
  { indice: 13, tipo: 'contenido' },
] as const

/** Cuántas piezas de cada carril hacen falta como mucho para una página. */
export const CONTENIDOS_POR_PAGINA = SLOTS_INTERLEAVE.filter((s) => s.tipo === 'contenido').length
export const ENCUESTAS_POR_PAGINA = SLOTS_INTERLEAVE.filter((s) => s.tipo === 'encuesta').length

export interface ResultadoInterleave {
  elementos: ElementoFeed[]
  /** Cuántas piezas de contenido se colocaron DE VERDAD. */
  contenidoUsado: number
  /** Cuántas encuestas se colocaron DE VERDAD. */
  encuestaUsada: number
}

/**
 * Monta la página intercalando contenido y encuestas en los slots fijos.
 *
 * Función PURA y determinista. Dos propiedades que hay que conservar:
 *
 *  1. **El orden relativo de los posts no cambia nunca.** Se consumen en el
 *     orden en que llegaron de Postgres, que es el orden del índice. Reordenar
 *     aquí rompería el keyset: el cursor apunta a la última fila del carril de
 *     posts, no a la última fila de la página.
 *  2. **Un slot solo se ocupa si la página llega hasta él.** Con 4 posts, el
 *     slot 8 no existe y su encuesta NO se consume — por eso la función devuelve
 *     cuántas piezas usó de verdad: avanzar el cursor de un carril que no se
 *     llegó a mostrar haría desaparecer contenido en silencio.
 */
export function entrelazar(
  posts: PostFeed[],
  contenidos: ContenidoFeed[],
  encuestas: string[],
): ResultadoInterleave {
  const elementos: ElementoFeed[] = []
  let iPost = 0
  let contenidoUsado = 0
  let encuestaUsada = 0

  while (iPost < posts.length) {
    const posicion = elementos.length
    const slot = SLOTS_INTERLEAVE.find((s) => s.indice === posicion)

    if (slot?.tipo === 'contenido' && contenidoUsado < contenidos.length) {
      elementos.push({ tipo: 'contenido', contenido: contenidos[contenidoUsado] })
      contenidoUsado++
      continue
    }
    if (slot?.tipo === 'encuesta' && encuestaUsada < encuestas.length) {
      elementos.push({ tipo: 'encuesta', encuestaId: encuestas[encuestaUsada] })
      encuestaUsada++
      continue
    }

    elementos.push({ tipo: 'post', post: posts[iPost] })
    iPost++
  }

  return { elementos, contenidoUsado, encuestaUsada }
}

// ── Proyección: de fila de Postgres a contrato público ──────────────────────

/**
 * Campo a campo, nunca con spread.
 *
 * Un `{ ...fila, ... }` publicaría cualquier columna que alguien añada mañana al
 * esquema. Aquí se ve de un vistazo que `hot_score`, `boost_until`, `risk`
 * crudo, `state` y `author_id` se quedan dentro (ver tipos.ts).
 */
export function aPostFeed(fila: FilaFeedPost, ahora: Date = new Date()): PostFeed {
  const enRiesgo = fila.risk === 'high' || fila.risk === 'critical'

  return {
    id: fila.id,
    autor: {
      id: fila.autor_id,
      alias: fila.alias,
      avatarSeed: fila.avatar_seed,
      nivel: fila.level,
      karmaReputacion: fila.karma_reputation,
      disponibilidad: fila.availability,
      esMentor: fila.level === 'mentor',
    },
    kind: fila.kind,
    body: fila.body,
    topic: fila.topic,
    upvotes: fila.upvote_count,
    respuestas: fila.reply_count,
    // `isBoostEligible` y no `boost_until != null`: la función ya incluye la
    // línea roja (nada de boost en contenido de riesgo alto o crítico, nada de
    // boost en contenido moderado). Reimplementar la condición aquí sería
    // duplicarla, y la copia sería la que se olvida de actualizar.
    impulsado: isBoostEligible(
      {
        id: fila.id,
        upvote_count: fila.upvote_count,
        reply_count: fila.reply_count,
        created_at: fila.created_at,
        boost_until: fila.boost_until,
        risk: fila.risk,
        // La RPC solo devuelve filas activas (`where state = 'active'`), pero se
        // pasa explícito para que la comprobación no dependa de recordarlo.
        state: 'active',
      },
      ahora,
    ),
    enRiesgo,
    creadoEn: fila.created_at,
    heVotado: fila.he_votado,
  }
}

export function aContenidoFeed(fila: FilaFeedContenido): ContenidoFeed {
  return {
    id: fila.id,
    titulo: fila.title,
    resumen: fila.summary,
    url: fila.url,
    miniatura: fila.thumbnail_url,
    plataforma: fila.platform,
    duracionSegundos: fila.duration_seconds,
  }
}

// ── Consulta ────────────────────────────────────────────────────────────────

export interface OpcionesFeed {
  carril: Carril
  /** 1–50, ya validado con zod en la ruta. */
  limite: number
  cursor: CursorCompuesto
  /** Idioma del contenido curado ('es' | 'en'). */
  idioma: string
  /** Inyectable para que los tests del boost no dependan del reloj. */
  ahora?: Date
}

function filas<T>(datos: unknown): T[] {
  return Array.isArray(datos) ? (datos as T[]) : []
}

/**
 * Una página del feed mixto.
 *
 * Las tres consultas van en paralelo porque son independientes: encadenarlas
 * sumaría tres viajes de red al presupuesto de LCP sin ganar nada.
 */
export async function consultarFeed(
  supabase: SupabaseClient,
  opciones: OpcionesFeed,
): Promise<PaginaFeed> {
  const { carril, limite, cursor, idioma } = opciones
  const ahora = opciones.ahora ?? new Date()

  const consultaPosts =
    carril === 'para_ti'
      ? supabase.rpc('feed_keyset', {
          p_cursor_score: cursor.postsHot?.hotScore ?? null,
          p_cursor_id: cursor.postsHot?.id ?? null,
          p_limite: limite,
        })
      : supabase.rpc('feed_keyset_nuevo', {
          p_cursor_creado: cursor.postsNuevo?.instante ?? null,
          p_cursor_id: cursor.postsNuevo?.id ?? null,
          p_limite: limite,
        })

  const [respuestaPosts, respuestaContenido, respuestaEncuestas] = await Promise.all([
    consultaPosts,
    supabase.rpc('feed_contenido_keyset', {
      p_idioma: idioma,
      p_cursor_score: cursor.contenido?.hotScore ?? null,
      p_cursor_id: cursor.contenido?.id ?? null,
      p_limite: CONTENIDOS_POR_PAGINA,
    }),
    supabase.rpc('feed_encuestas_keyset', {
      p_cursor_creado: cursor.encuesta?.instante ?? null,
      p_cursor_id: cursor.encuesta?.id ?? null,
      p_limite: ENCUESTAS_POR_PAGINA,
    }),
  ])

  // El carril de posts es la columna vertebral: si falla, no hay feed. El
  // mensaje de Postgres se queda en la causa y jamás sale al cliente
  // (lib/auth/respuestas.ts lo redacta), porque filtra nombres de tabla y de
  // índice.
  if (respuestaPosts.error) {
    throw new ErrorApi('error_interno', { causa: respuestaPosts.error })
  }

  // Los otros dos carriles son ADORNO: si el contenido curado o las encuestas
  // fallan, el feed de la comunidad sigue sirviéndose sin ellos. Convertir un
  // fallo del catálogo de vídeos en una pantalla de error dejaría a alguien sin
  // su feed por un problema que no le afecta.
  const filasContenido = respuestaContenido.error ? [] : filas<FilaFeedContenido>(respuestaContenido.data)
  const filasEncuestas = respuestaEncuestas.error ? [] : filas<FilaFeedEncuesta>(respuestaEncuestas.data)

  const filasPosts = filas<FilaFeedPost>(respuestaPosts.data)

  const { elementos, contenidoUsado, encuestaUsada } = entrelazar(
    filasPosts.map((fila) => aPostFeed(fila, ahora)),
    filasContenido.map(aContenidoFeed),
    filasEncuestas.map((fila) => fila.id),
  )

  // Menos filas de las pedidas = no hay más páginas. Sin `count(*)`: contar
  // sobre `posts` con un millón de filas es un seq scan en cada scroll.
  const hayMas = filasPosts.length >= limite
  if (!hayMas) {
    return { items: elementos, siguienteCursor: null }
  }

  const ultimoPost = filasPosts[filasPosts.length - 1]
  const ultimoContenido = contenidoUsado > 0 ? filasContenido[contenidoUsado - 1] : null
  const ultimaEncuesta = encuestaUsada > 0 ? filasEncuestas[encuestaUsada - 1] : null

  const siguiente: CursorCompuesto = {
    postsHot: carril === 'para_ti' ? { hotScore: ultimoPost.hot_score, id: ultimoPost.id } : null,
    postsNuevo:
      carril === 'nuevo' ? ({ instante: ultimoPost.created_at, id: ultimoPost.id } satisfies PosicionTemporal) : null,
    // Si un carril de adorno no se llegó a mostrar, su posición NO avanza: se
    // conserva la que traía el cursor de entrada.
    contenido: ultimoContenido
      ? { hotScore: ultimoContenido.performance_score, id: ultimoContenido.id }
      : cursor.contenido,
    encuesta: ultimaEncuesta
      ? { instante: ultimaEncuesta.created_at, id: ultimaEncuesta.id }
      : cursor.encuesta,
  }

  return { items: elementos, siguienteCursor: codificarCursor(siguiente, carril) }
}
