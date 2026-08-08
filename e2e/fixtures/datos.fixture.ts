import { randomBytes } from 'node:crypto'
import { clienteAdminE2E } from '../utils/admin'
import { postSembrado, TEXTO_NEUTRO } from '../utils/textos'
import { crearCuenta, type CuentaSembrada, type UsuarioE2E } from './usuario.fixture'

/**
 * Siembra N posts de N autores DISTINTOS y devuelve sus ids.
 *
 * De autores distintos a propósito: el índice único parcial
 * `uq_comments_one_listen_per_post (post_id, author_id) where is_validated`
 * impide ganar tres créditos comentando tres veces el mismo post, así que tres
 * posts del mismo autor tampoco servirían para el recorrido (b) si algún día
 * la regla se endurece a «tres personas distintas».
 *
 * Va por service_role en un solo `insert` con array, no por la UI: crear tres
 * posts navegando cuesta ~15 s por test y no prueba nada que no pruebe ya el
 * recorrido (c).
 *
 * Los autores se crean SIN sesión (`crearCuenta`): sus posts los inserta
 * service_role y nadie navega con ellos. Cada login de más cuenta contra el
 * límite por IP del Auth, que es el presupuesto más escaso de la suite.
 */
export async function sembrarPosts(n: number): Promise<{ ids: string[]; autores: CuentaSembrada[] }> {
  const admin = clienteAdminE2E()

  const autores: CuentaSembrada[] = []
  for (let i = 0; i < n; i += 1) autores.push(await crearCuenta(`autor${i + 1}`))

  // Los autores han de poder publicar: el primer post es gratis
  // (`posts_published = 0`), así que un solo post por autor pasa el trigger sin
  // necesidad de tocar `listen_credits` a mano.
  const filas = autores.map((autor, i) => ({
    author_id: autor.id,
    kind: 'desahogo',
    body: postSembrado(i + 1),
    topic: 'otro',
  }))

  const { data, error } = await admin.from('posts').insert(filas).select('id')
  if (error) throw new Error(`No se han podido sembrar ${n} posts: ${error.message}`)

  return { ids: (data ?? []).map((f) => f.id as string), autores }
}

/**
 * Marca un comentario como validado con service_role.
 *
 * ESTA ES LA PIEZA CLAVE DEL BLOQUE. Sin `MODERATION_API_KEY` el clasificador
 * de IA no responde y el sistema **falla cerrado** por diseño: ningún
 * comentario se valida solo y el bucle de reciprocidad no avanza nunca. Si un
 * test esperase a que la app validara sola, se quedaría colgado siempre.
 *
 * El `update` dispara `trg_comments_validated`, que en la misma transacción
 * acredita `listen_credits`, llama a `award_karma()` e incrementa
 * `reply_count`. Es exactamente la cadena real.
 *
 * ⚠️ NUNCA se toca `profiles.listen_credits` a mano: eso se saltaría el trigger
 * que es justo lo que hay que verificar.
 */
export async function validarComentario(comentarioId: string): Promise<void> {
  const admin = clienteAdminE2E()
  const { error } = await admin
    .from('comments')
    .update({ is_validated: true })
    .eq('id', comentarioId)
    .eq('is_validated', false)

  if (error) throw new Error(`No se ha podido validar el comentario ${comentarioId}: ${error.message}`)
}

/**
 * Deja al usuario con `posts_published >= 1` y `listen_credits = 0`, POR LA VÍA
 * REAL: publicando una vez.
 *
 * ⚠️ El primer post es GRATIS. Si el recorrido (c) usara un usuario recién
 * creado, la publicación FUNCIONARÍA y el test fallaría sin motivo aparente.
 * De ahí que esto exista y de ahí que publique de verdad en vez de escribir
 * `posts_published = 1` a mano.
 */
export async function agotarEscuchas(usuario: UsuarioE2E): Promise<void> {
  const admin = clienteAdminE2E()

  const { error } = await admin.from('posts').insert({
    author_id: usuario.id,
    kind: 'desahogo',
    body: TEXTO_NEUTRO,
    topic: 'otro',
  })

  if (error) {
    throw new Error(`No se ha podido gastar el post gratis de ${usuario.alias}: ${error.message}`)
  }
}

/** Lee del ledger, no del caché de `profiles`: `karma_events` es la verdad. */
export async function karmaDelLedger(usuarioId: string): Promise<number> {
  const admin = clienteAdminE2E()
  const { data, error } = await admin
    .from('karma_events')
    .select('delta_reputation')
    .eq('user_id', usuarioId)

  if (error) throw new Error(`No se ha podido leer el ledger de ${usuarioId}: ${error.message}`)
  return (data ?? []).reduce((suma, f) => suma + (f.delta_reputation as number), 0)
}

/** Créditos de escucha reales, leídos con service_role. */
export async function creditosDeEscucha(usuarioId: string): Promise<number> {
  const admin = clienteAdminE2E()
  const { data, error } = await admin
    .from('profiles')
    .select('listen_credits')
    .eq('id', usuarioId)
    .single()

  if (error) throw new Error(`No se han podido leer los créditos de ${usuarioId}: ${error.message}`)
  return data.listen_credits as number
}

/**
 * Un id con la FORMA EXACTA de un id de vídeo de YouTube: 11 de [A-Za-z0-9_-]
 * (8 bytes en base64url son justo 11 caracteres, sin relleno).
 *
 * ⚠️ La forma no es decorativa: `esIdYoutubeValido()` filtra el catálogo ANTES
 * de construir la tarjeta, y un external_id que no pase esa regex no llega
 * nunca al cliente. La primera versión de este fixture sembraba
 * `e2e-<n>-<timestamp>` (19 caracteres): el feed lo descartaba EN SILENCIO y
 * los specs se afirmaban contra vídeos reales del catálogo de darma-dev —
 * de minutos de duración, imposibles de completar en el presupuesto.
 */
function idYoutubeSintetico(): string {
  return randomBytes(8).toString('base64url')
}

/** Un contenido de vídeo publicado, para el recorrido (f). */
export async function sembrarVideo(
  etiqueta: string,
  duracionSegundos = 30,
): Promise<string> {
  const admin = clienteAdminE2E()
  const externalId = idYoutubeSintetico()
  const { data, error } = await admin
    .from('content_items')
    .insert({
      source: 'e2e',
      platform: 'youtube',
      external_id: externalId,
      title: `Respiración guiada de prueba ${etiqueta}`,
      url: `https://www.youtube-nocookie.com/embed/${externalId}`,
      language: 'es',
      duration_seconds: duracionSegundos,
      topic: 'ansiedad',
      // El enum real de content_state es pending|approved|rejected (0002): el
      // valor 'published' de la primera versión de este fixture no existió
      // nunca en el esquema — el spec estuvo siempre en fixme y nadie lo pisó.
      state: 'approved',
      published_at: new Date().toISOString(),
      // Muy por encima del catálogo real (su score es tasa de finalización ×
      // log10 de vistas: un dígito). `feed_animo` ordena por performance_score
      // desc, y darma-dev tiene catálogo de verdad: sin esto el vídeo sembrado
      // queda bajo el pliegue y la tarjeta activa del spec sería un vídeo real.
      // MONÓTONO además de alto: una siembra huérfana de una ejecución anterior
      // (un test que reventó antes de su teardown y aún no cayó en el barrido
      // de 24 h) empataría con un score fijo y podría robar el primer puesto.
      performance_score: Date.now(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`No se ha podido sembrar el vídeo ${etiqueta}: ${error.message}`)
  return data.id as string
}

/** Borra un contenido sembrado. */
export async function borrarVideo(id: string): Promise<void> {
  const admin = clienteAdminE2E()
  await admin.from('content_views').delete().eq('content_id', id)
  await admin.from('content_items').delete().eq('id', id)
}
