// ============================================================================
// B21 · Descubrimiento por la YouTube Data API, con la cuota como primer límite.
//
// ── QUÉ RESUELVE, Y POR QUÉ NO BASTABA CON LOS FEEDS ────────────────────────
// `lib/ingest/feeds.ts` lee YouTube por Atom: sin clave, sin cuota, y por eso es
// la vía por defecto y no se retira. Su límite es duro: el feed sirve los ~15
// últimos ítems y nada más. Con siete fuentes elegidas a mano eso se traduce en
// que `/animo` depende de que alguien haya acertado con los orígenes, y la
// primera ingesta real (2026-08-04) trajo 80 piezas y CERO de salud mental.
// Este módulo abre la otra puerta —la Data API— sin repetir el error que la
// hizo inservible en DataLaps: la cuota.
//
// ── LA REGLA QUE ORDENA TODO EL ARCHIVO ─────────────────────────────────────
// Para un canal o una playlist QUE YA CONOCEMOS, `search.list` está prohibido.
// Cuesta 100 unidades y devuelve lo mismo que `playlistItems.list`, que cuesta
// 1. La playlist de subidas de un canal no hay ni que resolverla: YouTube la
// expone siempre cambiando el prefijo `UC` del channelId por `UU` (documentado
// por Google), así que ni siquiera hace falta una llamada extra para averiguarla.
// `search.list` queda para lo único que no puede hacer nadie más —búsqueda
// abierta, sin canal conocido— y con tope duro por corrida (ver cuota.ts).
//
// ── TRAMPA Nº 1 DE LA FICHA, POR ESCRITO ────────────────────────────────────
// `playlistItems.list` NO acepta `publishedAfter`. Ese parámetro solo existe en
// `search.list`. Mandarlo no da error: la API lo IGNORA en silencio y devuelve
// la playlist entera, así que el bug se manifiesta como «la ventana no filtra»
// y no como un 400. Por eso la ventana se aplica en cliente, aquí, y el test que
// comprueba que la URL NO lleva ese parámetro existe para que nadie lo «arregle»
// añadiéndolo.
//
// ── LO QUE SE CORRIGIÓ RESPECTO AL ORIGINAL ─────────────────────────────────
// DataLaps lee el propietario del vídeo de `snippet.channelId` de
// `playlistItems`. Ahí eso funciona porque solo consulta playlists de SUBIDAS,
// donde el dueño de la playlist y el del vídeo coinciden. Darma consulta
// playlists CURADAS (`yt:ops_mirar_al_futuro`, `yt:who_social_connection`), y en
// una playlist curada `snippet.channelId` es el canal que MONTÓ la lista, no el
// que publicó el vídeo — puede contener material de terceros. El campo correcto
// es `snippet.videoOwnerChannelId`. Si no viene, se devuelve `null`: es la misma
// disciplina de los 24 teléfonos, no se inventa un `UC` que no consta, y la
// allowlist de canal (§4) tratará ese `null` como «no verificable».
//
// ── NUNCA LANZA, Y NUNCA REGISTRA ───────────────────────────────────────────
// Best-effort por fuente: cualquier fallo devuelve lista vacía con un `motivo`
// estable, y una fuente rota no tumba el ciclo. Y este módulo NO usa el logger a
// propósito: la URL que se construye aquí lleva `key=<YOUTUBE_API_KEY>` en la
// query, y un `logger.warn` con la URL —o con el mensaje de un error de fetch,
// que suele incluirla— filtra la clave a los logs del proveedor. El motivo viaja
// hacia arriba como identificador; quien llama decide qué registrar.
//
// `estadoHttp` se devuelve para que quien llama se lo pase a
// `clasificarFalloHttp` de backoff.ts y decida reintentar o deshabilitar. Un
// fallo sin respuesta —o sin clave— sale como `null`, que esa función clasifica
// como «reintentar»: quedarse sin clave no es motivo para apagar una fuente.
//
// ── ALTERNATIVAS DESCARTADAS ────────────────────────────────────────────────
// · Paginar con `pageToken`. Cada página vuelve a costar su unidad y multiplica
//   el trabajo aguas abajo (cada candidato acaba costando un `videos.list`). Una
//   página de hasta 50 ítems más el filtro de ventana cubre de sobra la cadencia
//   de un cron; si algún día no basta, el sitio de arreglarlo es la ventana.
// · Resolver un handle (`@quien`) a channelId. Se hace con `channels.list`
//   (1 unidad), NO con `search.list` (100). Está fuera de este archivo a
//   propósito: mezclarlo aquí invita a «pues ya que estamos, busco».
// · Traer también el idioma o la duración en la misma llamada. No se puede:
//   `playlistItems.list` no devuelve `snippet.defaultAudioLanguage` ni
//   `contentDetails.duration`; eso solo lo da `videos.list`, que es la guarda
//   de §2 y vive en otro archivo.
// ============================================================================

import type { EntradaCruda, FuenteIngesta } from './tipos.ts'
import { fechaIso } from './feeds.ts'
import { thumbnailPermitida } from './normalizar.ts'
import type { ContadorCuota, MotivoCorteCuota } from './cuota.ts'

const ENDPOINT_PLAYLIST_ITEMS = 'https://www.googleapis.com/youtube/v3/playlistItems'
const ENDPOINT_BUSQUEDA = 'https://www.googleapis.com/youtube/v3/search'

/**
 * Ventana por defecto, en días. Siete y no uno (que es lo que usa el original):
 * allí el cron corre a diario y una ventana estrecha es correcta. Aquí la
 * ingesta de vídeo va espaciada y puede quedarse parada por backoff, así que una
 * ventana de un día haría que cualquier interrupción de 48 h perdiera contenido
 * para siempre y en silencio. Ensanchar la ventana no duplica nada: la
 * idempotencia la garantizan `uq_ingest_log_seen` y el unique de `content_items`.
 */
export const VENTANA_DIAS = 7

/** Tope de la API por página. Pedir más devuelve 400, no más resultados. */
export const MAX_RESULTADOS_API = 50

/** Cuántos ítems se piden a una playlist. Cuesta lo mismo 1 que 50: una unidad. */
export const MAX_RESULTADOS_PLAYLIST = 50

/**
 * Cuántos se piden a una búsqueda abierta. Bastante menos que a una playlist, y
 * no por cuota (el precio es el mismo pidiendo 5 que 50) sino por lo que viene
 * después: cada resultado es un vídeo de un canal que nadie ha revisado, y todos
 * acaban en la cola de curación humana. La cola pequeña es una señal de
 * operación, no una limitación (trampa nº 7 de la ficha).
 */
export const MAX_RESULTADOS_BUSQUEDA = 10

/** Timeout por llamada. Sin él, una conexión colgada se come el presupuesto de reloj. */
export const TIMEOUT_DESCUBRIMIENTO_MS = 5_000

/** Los 11 caracteres de un id de vídeo de YouTube. Lo que no encaje se descarta. */
const RE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** `UC` + 22. Un handle (`@quien`) NO encaja, y es correcto que no encaje. */
const RE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/

/** Ids de playlist: `PL…`, `UU…`, `FL…`, `OL…`. Conservador a propósito. */
const RE_PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/

/**
 * Un vídeo descubierto por la API.
 *
 * EXTIENDE `EntradaCruda` (tipos.ts) en vez de inventar una forma nueva: así una
 * lista de estos es directamente consumible por `normalizar()` y el orquestador
 * puede cambiar el feed Atom por la API sin tocar nada más. Lo que añade es
 * `channelId`, que el feed Atom no da y que la allowlist de canal necesita.
 */
export interface VideoDescubierto extends EntradaCruda {
  externalId: string
  title: string
  url: string
  publishedAt: string | null
  /**
   * Canal PROPIETARIO del vídeo tal como lo devolvió la API, o `null` si no
   * vino. Nunca se deduce ni se rellena con el dueño de la playlist.
   */
  channelId: string | null
}

/** Por qué una llamada no trajo nada. Identificadores estables, nunca texto del upstream. */
export type MotivoDescubrimiento =
  | MotivoCorteCuota
  | 'sin_clave_api'
  | 'sin_fetch'
  | 'identificador_invalido'
  | 'fuente_no_youtube'
  | 'sin_respuesta'
  | 'http_no_2xx'
  | 'cuerpo_ilegible'

export interface ResultadoDescubrimiento {
  items: VideoDescubierto[]
  /** `null` = la llamada fue bien (aunque la ventana dejara la lista vacía). */
  motivo: MotivoDescubrimiento | null
  /** Para `clasificarFalloHttp` de backoff.ts. `null` = no hubo respuesta HTTP. */
  estadoHttp: number | null
  unidadesGastadas: number
}

export interface OpcionesDescubrimiento {
  /**
   * OBLIGATORIO y a propósito. Un contador opcional acabaría siendo un contador
   * ausente en la ruta que más corre, que es exactamente cómo DataLaps agotó su
   * cuota. Quien llama tiene que decidir de qué presupuesto sale cada llamada.
   */
  cuota: ContadorCuota
  /** Por defecto `process.env.YOUTUBE_API_KEY`. Sin ella: vacío con motivo, jamás excepción. */
  claveApi?: string
  /** Inyectable: los tests NO hacen red. */
  fetchImpl?: typeof fetch
  ahora?: () => Date
  ventanaDias?: number
  maxResultados?: number
  timeoutMs?: number
  /** Solo para búsqueda abierta: pista de idioma (`relevanceLanguage`), no filtro. */
  idiomaRelevancia?: string
}

function resultado(
  motivo: MotivoDescubrimiento | null,
  estadoHttp: number | null = null,
  unidadesGastadas = 0,
  items: VideoDescubierto[] = [],
): ResultadoDescubrimiento {
  return { items, motivo, estadoHttp, unidadesGastadas }
}

/** `UCxxxx` → `UUxxxx`, la playlist de subidas del canal. `null` si no es un channelId. */
export function playlistDeSubidas(channelId: string): string | null {
  if (typeof channelId !== 'string' || !RE_CHANNEL_ID.test(channelId)) return null
  return `UU${channelId.slice(2)}`
}

/** Clave efectiva. Una cadena en blanco cuenta como ausente: un `.env` a medias no es una clave. */
function claveEfectiva(opciones: OpcionesDescubrimiento): string | null {
  const bruta = opciones.claveApi ?? process.env.YOUTUBE_API_KEY
  if (typeof bruta !== 'string') return null
  const limpia = bruta.trim()
  return limpia.length > 0 ? limpia : null
}

// ── Lectura defensiva del JSON ──────────────────────────────────────────────
// La respuesta se recorre con guardas en vez de con un `as Forma`: un `as` es
// una promesa sobre datos de terceros que nadie ha comprobado, y aquí basta con
// que Google cambie un campo para que la promesa sea mentira en tiempo de
// ejecución. Es la misma disciplina que en feeds.ts: menos ítems, nunca ítems
// inventados.

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null
}

function comoTexto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function campo(objeto: Record<string, unknown> | null, clave: string): unknown {
  return objeto ? objeto[clave] : undefined
}

/**
 * Mejor miniatura disponible, validada contra los hosts que admite la CSP
 * (`thumbnailPermitida`, normalizar.ts). Una miniatura de un host bloqueado deja
 * un hueco roto en la tarjeta, que es peor que no tener miniatura.
 */
function mejorMiniatura(thumbnails: unknown): string | null {
  const t = comoObjeto(thumbnails)
  if (!t) return null
  for (const nombre of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = comoTexto(campo(comoObjeto(t[nombre]), 'url'))
    const permitida = thumbnailPermitida(url)
    if (permitida) return permitida
  }
  return null
}

interface Peticion {
  destino: string
  fetchImpl?: typeof fetch
  timeoutMs: number
}

interface RespuestaCruda {
  cuerpo: unknown
  motivo: MotivoDescubrimiento | null
  estadoHttp: number | null
}

/**
 * Una petición GET que nunca lanza. El `AbortController` no es adorno: en
 * serverless una petición sin cancelar mantiene viva la invocación hasta el
 * techo de la función, y entonces el presupuesto de 45 s del orquestador deja de
 * significar nada (mismo razonamiento que en embebible.ts).
 */
async function pedir(peticion: Peticion): Promise<RespuestaCruda> {
  const fetchFn = peticion.fetchImpl ?? globalThis.fetch
  if (typeof fetchFn !== 'function') return { cuerpo: null, motivo: 'sin_fetch', estadoHttp: null }

  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), peticion.timeoutMs)
  // Se declara fuera del `try` para que el `catch` pueda distinguir «no hubo
  // respuesta» de «hubo respuesta y el cuerpo vino roto»: son fallos distintos y
  // `clasificarFalloHttp` los trata distinto.
  let estadoHttp: number | null = null
  try {
    const res = await fetchFn(peticion.destino, {
      signal: control.signal,
      headers: { accept: 'application/json' },
    })
    estadoHttp = typeof res?.status === 'number' ? res.status : null
    if (estadoHttp == null || estadoHttp < 200 || estadoHttp >= 300) {
      // 403 con `quotaExceeded` cae aquí. No se distingue del resto a propósito:
      // el contador de cuota es quien debe evitar llegar a este punto, y tratar
      // el 403 como caso especial invitaría a usarlo como señal en su lugar —es
      // decir, a enterarse después.
      return { cuerpo: null, motivo: 'http_no_2xx', estadoHttp }
    }
    const cuerpo: unknown = await res.json()
    return { cuerpo, motivo: null, estadoHttp }
  } catch {
    // Timeout, abort, DNS, red caída o JSON no parseable. Sin detalle: el
    // mensaje del error puede arrastrar la URL, y la URL lleva la clave.
    return { cuerpo: null, motivo: estadoHttp == null ? 'sin_respuesta' : 'cuerpo_ilegible', estadoHttp }
  } finally {
    clearTimeout(alarma)
  }
}

/** Los `items` de la respuesta, o `null` si el cuerpo no tiene la forma esperada. */
function itemsDeRespuesta(cuerpo: unknown): unknown[] | null {
  const raiz = comoObjeto(cuerpo)
  if (!raiz) return null
  const items = raiz.items
  // Un cuerpo sin `items` es una respuesta de error de la API disfrazada de 200
  // (pasa con algunos proxies). Lista vacía SÍ es válida: significa «nada nuevo».
  if (!Array.isArray(items)) return null
  return items
}

/** Instante a partir del cual un vídeo entra en la ventana. */
function inicioVentana(opciones: OpcionesDescubrimiento): number {
  const ahora = (opciones.ahora ?? (() => new Date()))()
  const dias = Number.isFinite(opciones.ventanaDias) && (opciones.ventanaDias ?? 0) > 0 ? Number(opciones.ventanaDias) : VENTANA_DIAS
  return ahora.getTime() - dias * 86_400_000
}

/**
 * ¿Entra el ítem en la ventana?
 *
 * Un ítem SIN fecha interpretable se CONSERVA. Descartarlo sería fail-closed
 * contra la persona equivocada: la idempotencia ya impide que se duplique, y lo
 * único que se gana descartándolo es perder en silencio un vídeo cuya fecha
 * YouTube no rellenó. El orquestador ya sabe tratar ítems sin fecha: los ordena
 * al final y no mueven el cursor.
 */
function dentroDeVentana(publishedAt: string | null, desde: number): boolean {
  if (publishedAt == null) return true
  const t = Date.parse(publishedAt)
  if (!Number.isFinite(t)) return true
  return t >= desde
}

function acotarResultados(pedidos: number | undefined, porDefecto: number): number {
  if (!Number.isFinite(pedidos) || (pedidos ?? 0) <= 0) return porDefecto
  return Math.min(Math.floor(Number(pedidos)), MAX_RESULTADOS_API)
}

// ── Frente 1 · playlists y canales conocidos (1 unidad) ─────────────────────

/**
 * Lee una playlist con `playlistItems.list`. UNA unidad de cuota.
 *
 * Sirve tanto para las fuentes `youtube_playlist` como para las
 * `youtube_channel` (a través de `descubrirPorCanal`, que traduce el channelId a
 * su playlist de subidas). Nunca llama a `search.list`.
 */
export async function descubrirPorPlaylist(
  playlistId: string,
  opciones: OpcionesDescubrimiento,
): Promise<ResultadoDescubrimiento> {
  if (typeof playlistId !== 'string' || !RE_PLAYLIST_ID.test(playlistId)) {
    return resultado('identificador_invalido')
  }

  const clave = claveEfectiva(opciones)
  // Sin clave se sale ANTES de tocar el contador: no se apunta como gasto algo
  // que jamás salió a la red.
  if (!clave) return resultado('sin_clave_api')

  const corte = opciones.cuota.intentarGastar('playlistItems.list')
  if (corte) return resultado(corte)

  const params = new URLSearchParams({
    part: 'snippet',
    playlistId,
    maxResults: String(acotarResultados(opciones.maxResultados, MAX_RESULTADOS_PLAYLIST)),
    key: clave,
  })
  // ⛔ AQUÍ NO VA `publishedAfter`. `playlistItems.list` lo ignora en silencio
  // (ver cabecera). La ventana se filtra abajo, en cliente.

  const respuesta = await pedir({
    destino: `${ENDPOINT_PLAYLIST_ITEMS}?${params.toString()}`,
    fetchImpl: opciones.fetchImpl,
    timeoutMs: opciones.timeoutMs ?? TIMEOUT_DESCUBRIMIENTO_MS,
  })
  const coste = 1
  if (respuesta.motivo) return resultado(respuesta.motivo, respuesta.estadoHttp, coste)

  const items = itemsDeRespuesta(respuesta.cuerpo)
  if (items == null) return resultado('cuerpo_ilegible', respuesta.estadoHttp, coste)

  const desde = inicioVentana(opciones)
  const salida: VideoDescubierto[] = []

  for (const bruto of items) {
    const snippet = comoObjeto(campo(comoObjeto(bruto), 'snippet'))
    if (!snippet) continue

    const videoId = comoTexto(campo(comoObjeto(snippet.resourceId), 'videoId'))
    if (!videoId || !RE_VIDEO_ID.test(videoId)) continue

    const titulo = comoTexto(snippet.title)
    if (!titulo) continue

    const publishedAt = fechaIso(comoTexto(snippet.publishedAt))
    if (!dentroDeVentana(publishedAt, desde)) continue

    salida.push({
      externalId: videoId,
      title: titulo,
      summary: comoTexto(snippet.description),
      // URL canónica construida a partir del id, igual que en feeds.ts: el
      // enlace que da la API puede traer parámetros y dos URLs del mismo vídeo
      // ensuciarían el catálogo aunque el unique las dedupe.
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: mejorMiniatura(snippet.thumbnails),
      publishedAt,
      durationSeconds: null,
      tags: [],
      // `videoOwnerChannelId`, NO `channelId` (ver cabecera). En una playlist
      // curada `channelId` es quien montó la lista, no quien publicó el vídeo.
      channelId: comoTexto(snippet.videoOwnerChannelId),
    })
  }

  return resultado(null, respuesta.estadoHttp, coste, salida)
}

/**
 * Lee los vídeos recientes de un canal. UNA unidad, no cien.
 *
 * No hace falta ninguna llamada para averiguar la playlist de subidas: es el
 * channelId con `UU` en lugar de `UC`. Si el handle no es un channelId (por
 * ejemplo `@quien`), se devuelve `identificador_invalido` y NO se cae a
 * `search.list` — resolver un handle se hace con `channels.list`, y eso es otro
 * archivo.
 */
export async function descubrirPorCanal(
  channelId: string,
  opciones: OpcionesDescubrimiento,
): Promise<ResultadoDescubrimiento> {
  const playlistId = playlistDeSubidas(channelId)
  if (!playlistId) return resultado('identificador_invalido')
  return descubrirPorPlaylist(playlistId, opciones)
}

// ── Frente 2 · búsqueda abierta (100 unidades) ──────────────────────────────

/**
 * Búsqueda abierta con `search.list`. CIEN unidades por llamada.
 *
 * Es la única vía que no tiene equivalente barato: no hay canal conocido al que
 * apuntar. Por eso el tope duro por corrida vive en el contador (`search.list`:
 * 2 llamadas) y no en un `slice()` del llamante, que es donde estaba en el
 * original y donde nadie lo veía.
 *
 * Aquí `publishedAfter` SÍ existe y se manda: filtrar en el servidor ahorra
 * ancho de banda y trabajo. Aun así se vuelve a filtrar en cliente, porque el
 * mismo código de ventana debe valer para las dos vías y porque un parámetro que
 * la API pueda ignorar no puede ser la única defensa (que es justo lo que pasa
 * con `playlistItems.list`).
 */
export async function descubrirPorBusqueda(
  consulta: string,
  opciones: OpcionesDescubrimiento,
): Promise<ResultadoDescubrimiento> {
  const texto = typeof consulta === 'string' ? consulta.trim() : ''
  if (texto.length === 0) return resultado('identificador_invalido')

  const clave = claveEfectiva(opciones)
  if (!clave) return resultado('sin_clave_api')

  const corte = opciones.cuota.intentarGastar('search.list')
  if (corte) return resultado(corte)

  const desde = inicioVentana(opciones)
  const params = new URLSearchParams({
    part: 'snippet',
    q: texto,
    type: 'video',
    order: 'date',
    // `videoEmbeddable` sale gratis y quita de la cola justo la clase de vídeos
    // que la sonda de embed acabaría rechazando después: los que el dueño no
    // deja incrustar. Exige `type=video`, que ya está puesto.
    videoEmbeddable: 'true',
    // Búsqueda abierta sobre salud mental: `safeSearch` estricto es lo mínimo
    // antes de que exista el clasificador (§5 de la ficha).
    safeSearch: 'strict',
    maxResults: String(acotarResultados(opciones.maxResultados, MAX_RESULTADOS_BUSQUEDA)),
    publishedAfter: new Date(desde).toISOString(),
    key: clave,
  })
  if (opciones.idiomaRelevancia) params.set('relevanceLanguage', opciones.idiomaRelevancia)

  const respuesta = await pedir({
    destino: `${ENDPOINT_BUSQUEDA}?${params.toString()}`,
    fetchImpl: opciones.fetchImpl,
    timeoutMs: opciones.timeoutMs ?? TIMEOUT_DESCUBRIMIENTO_MS,
  })
  const coste = 100
  if (respuesta.motivo) return resultado(respuesta.motivo, respuesta.estadoHttp, coste)

  const items = itemsDeRespuesta(respuesta.cuerpo)
  if (items == null) return resultado('cuerpo_ilegible', respuesta.estadoHttp, coste)

  const salida: VideoDescubierto[] = []

  for (const bruto of items) {
    const objeto = comoObjeto(bruto)
    const videoId = comoTexto(campo(comoObjeto(campo(objeto, 'id')), 'videoId'))
    if (!videoId || !RE_VIDEO_ID.test(videoId)) continue

    const snippet = comoObjeto(campo(objeto, 'snippet'))
    if (!snippet) continue

    const titulo = comoTexto(snippet.title)
    if (!titulo) continue

    const publishedAt = fechaIso(comoTexto(snippet.publishedAt))
    if (!dentroDeVentana(publishedAt, desde)) continue

    salida.push({
      externalId: videoId,
      title: titulo,
      summary: comoTexto(snippet.description),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: mejorMiniatura(snippet.thumbnails),
      publishedAt,
      durationSeconds: null,
      tags: [],
      // En `search.list` el resultado ES el vídeo, así que `snippet.channelId`
      // sí es su propietario. No hay `videoOwnerChannelId` en esta respuesta.
      channelId: comoTexto(snippet.channelId),
    })
  }

  return resultado(null, respuesta.estadoHttp, coste, salida)
}

// ── La costura con el catálogo existente ────────────────────────────────────

/**
 * Descubre por API a partir de una fila de `ingest_sources`, respetando el
 * reparto de `fuentes.ts`: playlist y canal por `playlistItems.list`, y `rss`
 * fuera —no es YouTube y no tiene nada que buscar aquí—.
 *
 * Devolver `fuente_no_youtube` en vez de lanzar mantiene la promesa del módulo:
 * una fuente que no encaja no puede tumbar la corrida.
 */
export async function descubrirDeFuente(
  fuente: Pick<FuenteIngesta, 'kind' | 'handle'>,
  opciones: OpcionesDescubrimiento,
): Promise<ResultadoDescubrimiento> {
  switch (fuente.kind) {
    case 'youtube_playlist':
      return descubrirPorPlaylist(fuente.handle, opciones)
    case 'youtube_channel':
      return descubrirPorCanal(fuente.handle, opciones)
    case 'rss':
      return resultado('fuente_no_youtube')
  }
}
