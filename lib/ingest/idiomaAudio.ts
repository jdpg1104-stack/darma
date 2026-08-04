// ============================================================================
// B21 §2 · ¿En qué idioma SUENA este vídeo? — la guarda de audio.
//
// ── EL INCIDENTE QUE OBLIGA A QUE ESTO EXISTA (DataLaps, 2026-07-29) ────────
// Se publicó un vídeo con el TÍTULO traducido al español y el AUDIO en inglés.
// Quien lo abrió esperaba español, se encontró otra cosa, y el vídeo hubo que
// retirarlo a mano. La corrección de allí tuvo DOS partes, y la segunda pesa
// tanto como la primera:
//
//   (a) Consultar el idioma declarado del audio ANTES de clasificar. Si existe
//       y no es español, se descarta ahí mismo — más barato que gastar una
//       llamada al clasificador en algo que ya sabemos que no vale.
//   (b) 🔴 SE BORRÓ la función que traducía títulos. Nunca se traduce un vídeo
//       para «colarlo»: el título tiene que venir del vídeo real. Este módulo
//       NO traduce nada, y no debe crecer nunca en esa dirección — traducir el
//       título no cambia el audio, solo esconde el problema mejor.
//
// 🔴 Darma ya tiene el vídeo que dispara esto. La fuente `yt:who_social_connection`
// (OMS · «The Social Connection Series») está declarada `language: 'en'` en
// lib/ingest/fuentes.ts y sus títulos parecen universales — «Benny's Story» no
// avisa de nada. Sin esta guarda, alguien que abra /animo en español a las tres
// de la mañana se encuentra a Benny hablándole en inglés.
//
// ── POR QUÉ TRES SALIDAS Y NO UN BOOLEANO ──────────────────────────────────
// El mismo motivo que en lib/ingest/embebible.ts, que ya lleva cuatro estados
// por esto exactamente: un fallo de red NUNCA puede leerse como el veredicto
// que más conviene. Si «no pude preguntarlo» colapsara en `no_es_espanol`,
// cualquier hipo de red o cualquier día de cuota agotada archivaría en silencio
// todo el catálogo del día. Y si colapsara en `es_espanol`, publicaríamos a
// ciegas justo el caso que este archivo existe para cazar.
//
//   es_espanol      → YouTube lo declara y es español. Sigue al clasificador.
//   no_es_espanol   → YouTube lo declara y NO es español. Rechazo, sin gastar
//                     la llamada al clasificador.
//   desconocido     → nadie contestó, o YouTube no rellenó el campo. NO ES UN
//                     RECHAZO. Ver el bloque siguiente.
//
// ── QUÉ SIGNIFICA `desconocido`, Y QUÉ FALTA PARA CERRARLO ─────────────────
// YouTube deja `defaultAudioLanguage` vacío MUY a menudo: es un campo que el
// canal rellena a mano, no algo que la plataforma deduzca del audio. Así que
// `desconocido` no es un caso raro de error, es el caso corriente.
//
// 🔴 El respaldo previsto para `desconocido` es el eje `spanishLanguage` del
// clasificador por IA (B21 §5), fail-closed. ESE CLASIFICADOR AÚN NO EXISTE:
// depende de `MODERATION_API_KEY`, que hoy no está configurada. Mientras tanto,
// `desconocido` debe dejar el ítem en `pending` —la cola de curación humana—,
// que es el estado que Darma ya sabe pintar para «no lo sé». Está anotado en
// HANDOFF/PEDIDOS.md; quien conecte esta guarda al orquestador no puede tratar
// `desconocido` como aprobación ni como rechazo.
//
// ── ALTERNATIVAS DESCARTADAS ───────────────────────────────────────────────
// · **Detectar el idioma del TÍTULO y creerle.** Es justo lo que falló en el
//   incidente: el título del vídeo retirado estaba en español impecable. El
//   título describe el escaparate; el audio es el producto.
// · **Pedir los subtítulos (`captions.list`) y deducir de ahí.** Cuesta 50
//   unidades de cuota frente a 1, y un vídeo en inglés puede tener subtítulos
//   en español (de hecho es lo normal en material institucional). Mide otra
//   cosa.
// · **Traducir el título a español.** Prohibido. Ver (b) arriba.
// · **Usar `search.list` o `playlistItems.list`, que ya se llaman igualmente.**
//   No pueden: ninguno de los dos devuelve `defaultAudioLanguage`. Solo
//   `videos.list` lo expone, en `snippet`.
// · **Pedir `part=snippet,status` en la misma llamada** (como hace el original,
//   porque `videos.list` cuesta 1 unidad pidas los `part` que pidas, así que
//   la puerta de embebible le salía gratis). Aquí NO: Darma ya resuelve
//   embebible con oEmbed en lib/ingest/embebible.ts, que no consume cuota de la
//   Data API en absoluto. Es mejor que el original y no se toca. `part=snippet`
//   a secas.
// · **Un booleano `esEspanol`.** Ver el bloque de las tres salidas.
//
// ── LO QUE ESTE MÓDULO NO HACE (a propósito) ───────────────────────────────
// Resuelve UN vídeo por llamada. `videos.list` admite hasta 50 ids por 1 unidad
// de cuota, así que una versión por lotes ahorraría cuota de verdad en una
// corrida grande — pero la contabilidad de cuota vive en lib/ingest/cuota.ts
// (B21 §1, otra sesión) y el lote debe diseñarse contra ella, no contra este
// archivo. Anotado en el informe.
//
// Esta función NUNCA lanza.
// ============================================================================

import { recortarIdioma } from './clasificar.ts'

const YT_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'

/** Timeout de la consulta. Sin él, una conexión colgada se come el presupuesto de la corrida entera. */
export const TIMEOUT_IDIOMA_MS = 5_000

/**
 * Las TRES salidas. `desconocido` NO es `no_es_espanol`: ver la cabecera.
 * Si algún día alguien «simplifica» esto a un booleano, el test que se pone
 * rojo es el que lleva ese nombre.
 */
export type IdiomaAudio = 'es_espanol' | 'no_es_espanol' | 'desconocido'

/**
 * Motivos estables para `ingest_log.reason`. Son identificadores, no prosa, y
 * NUNCA arrastran texto del upstream ni la URL consultada (que lleva la clave).
 *
 * La distinción entre `audio_declarado_no_espanol` y `metadato_no_espanol`
 * importa en operación: la primera es evidencia sobre el audio; la segunda solo
 * sobre el título y la descripción. Ver `respaldoDefaultLanguage`.
 */
export type MotivoIdiomaAudio =
  | 'audio_declarado_espanol'
  | 'audio_declarado_no_espanol'
  | 'metadato_espanol'
  | 'metadato_no_espanol'
  | 'sin_declarar'
  | 'sin_clave_api'
  | 'sin_video_id'
  | 'video_no_encontrado'
  | 'respuesta_no_ok'
  | 'sin_respuesta'

/** Veredicto con su porqué. Mismo patrón que `VeredictoSeguridad` en tipos.ts. */
export interface VeredictoIdiomaAudio {
  decision: IdiomaAudio
  motivo: MotivoIdiomaAudio
  /** El código crudo tal como lo declaró YouTube ('es-419', 'en-US'…), o null. */
  codigoDeclarado: string | null
  /** De qué campo salió el veredicto. `null` cuando no hubo ninguno. */
  campo: 'defaultAudioLanguage' | 'defaultLanguage' | null
}

export interface OpcionesIdiomaAudio {
  /** Clave de la Data API. Por defecto, `process.env.YOUTUBE_API_KEY`. */
  apiKey?: string
  /** Inyectable: los tests NO hacen red. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /**
   * ¿Se acepta `defaultLanguage` cuando `defaultAudioLanguage` está vacío?
   *
   * 🔴 LEE ESTO ANTES DE CONFIAR EN EL VALOR POR DEFECTO. La ficha B21 §2 pide
   * este respaldo, y por eso viene activado. Pero el original de DataLaps lo
   * RETIRÓ el 2026-07-31, dos días después del incidente, con medidas contra la
   * API que conviene conocer: `defaultLanguage` es el idioma del TÍTULO y la
   * DESCRIPCIÓN, no del audio — son dos campos distintos que responden a dos
   * preguntas distintas. Usarlo como sustituto falla en las DOS direcciones:
   *
   *   · FALSO RECHAZO — un canal de cirugía colombiano, hablado en español, con
   *     5 de sus 6 últimos vídeos sin declarar audio y el metadato en 'en': la
   *     puerta DURA lo echaba entero del feed por un campo que no habla del
   *     audio.
   *   · FALSO PASE — vídeos sin declarar audio y con metadato 'es' pasaban como
   *     «audio español» sin ninguna evidencia sobre el audio, saltándose el
   *     respaldo fail-closed que existe justo para ese caso.
   *
   * Aquí se deja activado porque es lo que pide la ficha y porque hoy el
   * respaldo real (el clasificador de §5) no existe todavía: sin él, apagar
   * esto manda a `desconocido` casi todo. En cuanto ese clasificador esté en
   * pie, la decisión correcta es ponerlo a `false` — y entonces el motivo
   * `metadato_no_espanol` en `ingest_log` dice exactamente cuántos ítems
   * dependían de este respaldo. Por eso el motivo se distingue del de audio.
   */
  respaldoDefaultLanguage?: boolean
}

/** Forma parcial de la respuesta de `videos.list`. Todo opcional: la API omite lo que no hay. */
interface ItemVideoYouTube {
  id?: string
  snippet?: {
    defaultAudioLanguage?: string
    defaultLanguage?: string
  }
}

/**
 * ¿Este código de idioma es español?
 *
 * 'es', 'es-ES', 'es-419', 'es-MX', 'ES', ' es_419 ' → `es_espanol`.
 * Cualquier otro código declarado → `no_es_espanol`.
 * Vacío, ausente o basura → `desconocido`.
 *
 * Se apoya en `recortarIdioma` de clasificar.ts en vez de hacer
 * `startsWith('es')`, que es la trampa obvia y está mal: 'est' (estonio) y
 * 'esu' (yupik central) son códigos reales que empiezan por «es» y no son
 * español. Recortar a la subetiqueta base los deja fuera, que es lo correcto:
 * son idiomas declarados, y declarados que no son español → rechazo.
 *
 * Es pura y se exporta para poder probarla sin tocar red.
 */
export function clasificarCodigoIdioma(codigo: string | null | undefined): IdiomaAudio {
  if (typeof codigo !== 'string' || codigo.trim().length === 0) return 'desconocido'
  return recortarIdioma(codigo) === 'es' ? 'es_espanol' : 'no_es_espanol'
}

/**
 * Resuelve el idioma de audio DECLARADO de un vídeo de YouTube.
 *
 * Cuesta 1 unidad de cuota de la Data API. Se llama ANTES del clasificador
 * precisamente porque es lo barato: descartar aquí un vídeo en inglés ahorra
 * una llamada al modelo.
 *
 * NUNCA lanza. Sin clave, sin red, con la cuota agotada o con un JSON que no
 * se puede leer, la respuesta es `desconocido` — jamás un rechazo y jamás una
 * aprobación.
 */
export async function resolverIdiomaAudio(
  videoId: string,
  opciones: OpcionesIdiomaAudio = {},
): Promise<VeredictoIdiomaAudio> {
  const fetchFn = opciones.fetchImpl ?? globalThis.fetch
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_IDIOMA_MS
  const usarRespaldo = opciones.respaldoDefaultLanguage ?? true

  if (!videoId || typeof videoId !== 'string') return sinDatos('sin_video_id')

  // La clave se lee en la llamada, no al importar el módulo: así un despliegue
  // que la inyecte tarde no se queda con `undefined` congelado en memoria, y
  // así un test puede quitarla y volverla a poner.
  const apiKey = opciones.apiKey ?? process.env.YOUTUBE_API_KEY
  // 🔴 Sin clave se devuelve `desconocido`, NO un rechazo. Que falte una
  // variable de entorno no es información sobre el idioma de nadie: si esto
  // rechazara, un despliegue sin la clave vaciaría el catálogo en silencio y el
  // síntoma aparecería días después, sin rastro de la causa.
  if (!apiKey) return sinDatos('sin_clave_api')
  if (typeof fetchFn !== 'function') return sinDatos('sin_respuesta')

  const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey })
  const destino = `${YT_VIDEOS_ENDPOINT}?${params.toString()}`

  // AbortController y no solo el timeout del runtime: en serverless una
  // petición sin cancelar mantiene viva la invocación hasta el techo de la
  // función, y el presupuesto de la corrida deja de significar nada. Mismo
  // razonamiento que en embebible.ts.
  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), timeoutMs)

  let item: ItemVideoYouTube | null = null
  try {
    const res = await fetchFn(destino, { signal: control.signal })
    // 403 (cuota agotada), 5xx, 400… todo es «no lo sé». La cuota agotada es
    // el caso que más duele y el que más tienta a asumir algo: no se asume.
    if (!res || res.ok !== true) return sinDatos('respuesta_no_ok')
    const json = (await res.json()) as { items?: ItemVideoYouTube[] }
    item = Array.isArray(json?.items) && json.items.length > 0 ? json.items[0] : null
  } catch {
    // Timeout, abort, DNS, red caída, JSON ilegible. 🔴 El error NO se registra
    // con su mensaje ni con la URL: `destino` lleva la clave de API en el query
    // string y acabaría en los logs de Vercel en texto plano.
    console.warn(`[idiomaAudio] no se pudo resolver el idioma de ${videoId}; queda desconocido`)
    return sinDatos('sin_respuesta')
  } finally {
    clearTimeout(alarma)
  }

  // Id inexistente, privado o borrado: `items` viene vacío. No es un rechazo
  // por idioma — de la existencia del vídeo ya se ocupa embebible.ts.
  if (!item?.snippet) return sinDatos('video_no_encontrado')

  const audio = item.snippet.defaultAudioLanguage
  const decisionAudio = clasificarCodigoIdioma(audio)
  if (decisionAudio !== 'desconocido') {
    return {
      decision: decisionAudio,
      motivo: decisionAudio === 'es_espanol' ? 'audio_declarado_espanol' : 'audio_declarado_no_espanol',
      codigoDeclarado: (audio ?? '').trim(),
      campo: 'defaultAudioLanguage',
    }
  }

  if (usarRespaldo) {
    const metadato = item.snippet.defaultLanguage
    const decisionMetadato = clasificarCodigoIdioma(metadato)
    if (decisionMetadato !== 'desconocido') {
      return {
        decision: decisionMetadato,
        motivo: decisionMetadato === 'es_espanol' ? 'metadato_espanol' : 'metadato_no_espanol',
        codigoDeclarado: (metadato ?? '').trim(),
        campo: 'defaultLanguage',
      }
    }
  }

  // El caso corriente, no el raro: YouTube no rellenó ninguno de los dos.
  return sinDatos('sin_declarar')
}

/** Atajo para el llamador que solo quiere saber si puede seguir al clasificador. */
export function rechazaPorIdioma(veredicto: VeredictoIdiomaAudio): boolean {
  return veredicto.decision === 'no_es_espanol'
}

function sinDatos(motivo: MotivoIdiomaAudio): VeredictoIdiomaAudio {
  return { decision: 'desconocido', motivo, codigoDeclarado: null, campo: null }
}
