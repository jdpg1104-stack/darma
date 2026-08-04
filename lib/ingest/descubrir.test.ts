import test from 'node:test'
import assert from 'node:assert/strict'

import { clasificarFalloHttp } from './backoff.ts'
import { crearContadorCuota } from './cuota.ts'
import {
  MAX_RESULTADOS_API,
  VENTANA_DIAS,
  descubrirDeFuente,
  descubrirPorBusqueda,
  descubrirPorCanal,
  descubrirPorPlaylist,
  playlistDeSubidas,
} from './descubrir.ts'

// ── Andamiaje: ni un byte de red ────────────────────────────────────────────

const CLAVE = 'CLAVE-DE-PRUEBA-NO-REAL'
const CANAL = 'UC07-dOwgza1IguKA86jqxNA'
const PLAYLIST = 'PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c'
const AHORA = (): Date => new Date('2021-05-10T00:00:00.000Z')

interface Espia {
  fetchImpl: typeof fetch
  urls: string[]
}

/** Doble de `fetch` que además apunta a qué URL se llamó (el test más importante). */
function espiar(manejador: (url: string) => Response | Promise<Response>): Espia {
  const urls: string[] = []
  const fetchImpl = (async (entrada: string) => {
    const url = String(entrada)
    urls.push(url)
    return manejador(url)
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
}

/** Un ítem de `playlistItems.list` tal como lo devuelve la API. */
function itemPlaylist(opciones: {
  videoId: string
  titulo?: string
  publishedAt?: string
  duenoDelVideo?: string | null
  duenoDeLaLista?: string
  miniatura?: string
}): unknown {
  const snippet: Record<string, unknown> = {
    title: opciones.titulo ?? `Título de ${opciones.videoId}`,
    description: 'Descripción',
    publishedAt: opciones.publishedAt ?? '2021-05-09T10:00:00Z',
    // Dueño de la PLAYLIST. En una lista curada NO es el dueño del vídeo.
    channelId: opciones.duenoDeLaLista ?? 'UCdeLaListaCuradaXXXXXXX',
    resourceId: { kind: 'youtube#video', videoId: opciones.videoId },
    thumbnails: { high: { url: opciones.miniatura ?? `https://i.ytimg.com/vi/${opciones.videoId}/hq.jpg` } },
  }
  if (opciones.duenoDelVideo !== null) snippet.videoOwnerChannelId = opciones.duenoDelVideo ?? CANAL
  return { snippet }
}

/** Un ítem de `search.list`. Ahí el resultado ES el vídeo. */
function itemBusqueda(videoId: string, publishedAt = '2021-05-09T10:00:00Z'): unknown {
  return {
    id: { kind: 'youtube#video', videoId },
    snippet: {
      title: `Título de ${videoId}`,
      description: 'Descripción',
      publishedAt,
      channelId: CANAL,
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${videoId}/mq.jpg` } },
    },
  }
}

function opciones(extra: Partial<Parameters<typeof descubrirPorPlaylist>[1]> = {}) {
  return {
    cuota: crearContadorCuota(),
    claveApi: CLAVE,
    ahora: AHORA,
    ...extra,
  }
}

// ── LA regla del bloque: nunca search.list para un canal conocido ───────────

test('un canal conocido se lee por playlistItems.list, JAMÁS por search.list', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'vid00000001' })] }))
  const cuota = crearContadorCuota()

  const r = await descubrirPorCanal(CANAL, opciones({ fetchImpl: espia.fetchImpl, cuota }))

  assert.equal(r.motivo, null)
  assert.equal(r.items.length, 1)
  assert.equal(espia.urls.length, 1)
  assert.ok(espia.urls[0].startsWith('https://www.googleapis.com/youtube/v3/playlistItems?'))
  assert.ok(!espia.urls[0].includes('/youtube/v3/search'), 'search.list cuesta 100× y aquí no pinta nada')
  // El coste real: UNA unidad, no cien.
  assert.equal(r.unidadesGastadas, 1)
  assert.equal(cuota.gastadas(), 1)
})

test('la playlist de subidas se deriva del channelId, sin gastar otra llamada', () => {
  assert.equal(playlistDeSubidas('UC07-dOwgza1IguKA86jqxNA'), 'UU07-dOwgza1IguKA86jqxNA')
  // Un handle NO es un channelId, y resolverlo NO es asunto de este archivo.
  assert.equal(playlistDeSubidas('@quien'), null)
  assert.equal(playlistDeSubidas('UCcorto'), null)
  assert.equal(playlistDeSubidas(''), null)
})

test('un canal con handle en vez de channelId se rechaza y NO cae a search.list', async () => {
  const espia = espiar(() => json({ items: [] }))
  const cuota = crearContadorCuota()

  const r = await descubrirPorCanal('@saludmental', opciones({ fetchImpl: espia.fetchImpl, cuota }))

  assert.equal(r.motivo, 'identificador_invalido')
  assert.equal(espia.urls.length, 0, 'no se llama a nada: caer a search.list es exactamente la trampa')
  assert.equal(cuota.gastadas(), 0)
})

// ── Trampa nº 1: playlistItems.list no acepta publishedAfter ────────────────

test('la URL de playlistItems.list NO lleva publishedAfter (la API lo ignora en silencio)', async () => {
  const espia = espiar(() => json({ items: [] }))
  await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.ok(!espia.urls[0].includes('publishedAfter'), 'mandarlo no da error: devuelve la playlist ENTERA')
  assert.ok(espia.urls[0].includes(`playlistId=${PLAYLIST}`))
})

test('la ventana de playlist se filtra EN CLIENTE', async () => {
  const espia = espiar(() =>
    json({
      items: [
        itemPlaylist({ videoId: 'reciente001', publishedAt: '2021-05-09T10:00:00Z' }),
        itemPlaylist({ videoId: 'viejo000001', publishedAt: '2021-01-01T10:00:00Z' }),
      ],
    }),
  )

  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].externalId, 'reciente001')
})

test('la ventana por defecto son 7 días y se puede ensanchar', async () => {
  const respuesta = (): Response =>
    json({ items: [itemPlaylist({ videoId: 'haceDiezDia', publishedAt: '2021-04-30T00:00:00Z' })] })

  assert.equal(VENTANA_DIAS, 7)
  const estrecha = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espiar(respuesta).fetchImpl }))
  assert.equal(estrecha.items.length, 0)

  const ancha = await descubrirPorPlaylist(
    PLAYLIST,
    opciones({ fetchImpl: espiar(respuesta).fetchImpl, ventanaDias: 30 }),
  )
  assert.equal(ancha.items.length, 1)
})

test('un vídeo sin fecha interpretable se CONSERVA, no se pierde en silencio', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'sinfecha001', publishedAt: 'no es fecha' })] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].publishedAt, null)
})

// ── El propietario del vídeo, no el de la lista ────────────────────────────

test('en una playlist curada, el channelId es el del VÍDEO (videoOwnerChannelId)', async () => {
  const espia = espiar(() =>
    json({
      items: [
        itemPlaylist({
          videoId: 'vid00000001',
          duenoDeLaLista: 'UCquienMontoLaListaXXXXX',
          duenoDelVideo: 'UCquienPublicoElVideoXXX',
        }),
      ],
    }),
  )
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  // Confundirlos deja pasar material de terceros como si fuera del organismo
  // oficial que montó la lista.
  assert.equal(r.items[0].channelId, 'UCquienPublicoElVideoXXX')
})

test('si el propietario no viene, el channelId es null — NO se inventa un UC', async () => {
  const espia = espiar(() =>
    json({ items: [itemPlaylist({ videoId: 'vid00000001', duenoDelVideo: null, duenoDeLaLista: 'UCdelaListaXXXXXXXXXXXX' })] }),
  )
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items[0].channelId, null, 'null = «oficial pero sin confirmar», la regla de los 24 teléfonos')
})

// ── Búsqueda abierta: 100 unidades y tope duro ─────────────────────────────

test('search.list cuesta 100 unidades y sí manda publishedAfter', async () => {
  const espia = espiar(() => json({ items: [itemBusqueda('busqueda001')] }))
  const cuota = crearContadorCuota()

  const r = await descubrirPorBusqueda('testimonio ansiedad', opciones({ fetchImpl: espia.fetchImpl, cuota }))

  assert.equal(r.motivo, null)
  assert.equal(r.unidadesGastadas, 100)
  assert.equal(cuota.gastadas(), 100)
  assert.ok(espia.urls[0].startsWith('https://www.googleapis.com/youtube/v3/search?'))
  assert.ok(espia.urls[0].includes('publishedAfter=2021-05-03'))
  // Filtros que salen gratis y quitan trabajo a la cola humana.
  assert.ok(espia.urls[0].includes('videoEmbeddable=true'))
  assert.ok(espia.urls[0].includes('safeSearch=strict'))
})

test('la búsqueda TAMBIÉN refiltra en cliente aunque mande publishedAfter', async () => {
  // Un parámetro que el servidor puede ignorar no puede ser la única defensa.
  const espia = espiar(() => json({ items: [itemBusqueda('viejo000001', '2020-01-01T00:00:00Z')] }))
  const r = await descubrirPorBusqueda('lo que me ayudó', opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.motivo, null)
  assert.equal(r.items.length, 0)
})

test('TOPE DURO: la tercera búsqueda de la corrida no llega a salir', async () => {
  const espia = espiar(() => json({ items: [] }))
  const cuota = crearContadorCuota({ topes: { 'search.list': 2 } })
  const comunes = opciones({ fetchImpl: espia.fetchImpl, cuota })

  assert.equal((await descubrirPorBusqueda('a', comunes)).motivo, null)
  assert.equal((await descubrirPorBusqueda('b', comunes)).motivo, null)

  const tercera = await descubrirPorBusqueda('c', comunes)
  assert.equal(tercera.motivo, 'tope_de_operacion')
  assert.equal(tercera.unidadesGastadas, 0)
  assert.equal(espia.urls.length, 2, 'la tercera ni se pide: el corte es ANTES de la llamada')
  assert.equal(cuota.gastadas(), 200)
})

test('con la cuota comprometida, el descubrimiento se corta ANTES de gastarla', async () => {
  const espia = espiar(() => json({ items: [] }))
  // 150 de presupuesto con 100 reservados a verificación: una búsqueda (100) no
  // cabe sin comerse la reserva, así que ni se intenta.
  const cuota = crearContadorCuota({ presupuesto: 150, reservaVerificacion: 100 })

  const r = await descubrirPorBusqueda('cualquier cosa', opciones({ fetchImpl: espia.fetchImpl, cuota }))

  assert.equal(r.motivo, 'reserva_de_verificacion')
  assert.equal(r.items.length, 0)
  assert.equal(espia.urls.length, 0)
  assert.equal(cuota.gastadas(), 0)
})

test('una búsqueda vacía no gasta 100 unidades en nada', async () => {
  const espia = espiar(() => json({ items: [] }))
  const cuota = crearContadorCuota()
  const r = await descubrirPorBusqueda('   ', opciones({ fetchImpl: espia.fetchImpl, cuota }))

  assert.equal(r.motivo, 'identificador_invalido')
  assert.equal(cuota.gastadas(), 0)
  assert.equal(espia.urls.length, 0)
})

// ── Sin clave: vacío con motivo, NUNCA una excepción ───────────────────────

test('sin YOUTUBE_API_KEY devuelve vacío con motivo y no lanza ni gasta', async () => {
  const previo = process.env.YOUTUBE_API_KEY
  delete process.env.YOUTUBE_API_KEY
  try {
    const espia = espiar(() => json({ items: [] }))
    const cuota = crearContadorCuota()
    const r = await descubrirPorPlaylist(PLAYLIST, { cuota, ahora: AHORA, fetchImpl: espia.fetchImpl })

    assert.equal(r.motivo, 'sin_clave_api')
    assert.deepEqual(r.items, [])
    assert.equal(r.unidadesGastadas, 0)
    assert.equal(cuota.gastadas(), 0, 'no se apunta como gasto algo que nunca salió a la red')
    assert.equal(espia.urls.length, 0)
    // Quedarse sin clave NO es motivo para apagar una fuente.
    assert.equal(clasificarFalloHttp(r.estadoHttp), 'reintentar')
  } finally {
    if (previo !== undefined) process.env.YOUTUBE_API_KEY = previo
  }
})

test('una clave en blanco cuenta como ausente (un .env a medias no es una clave)', async () => {
  const espia = espiar(() => json({ items: [] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl, claveApi: '   ' }))
  assert.equal(r.motivo, 'sin_clave_api')
  assert.equal(espia.urls.length, 0)
})

test('la clave no viaja en el resultado ni en los motivos', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'vid00000001' })] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  // La URL sí la lleva (no hay otra forma de autenticar), pero nada de lo que
  // sale de aquí hacia los logs puede contenerla.
  assert.ok(espia.urls[0].includes(CLAVE))
  assert.ok(!JSON.stringify(r).includes(CLAVE))
})

// ── Camino de fallo: la API contesta mal, o no contesta ────────────────────

test('HTTP 403 (cuota agotada del lado de Google) → vacío, motivo y estado para el backoff', async () => {
  const espia = espiar(() => json({ error: { code: 403, message: 'quotaExceeded' } }, 403))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.motivo, 'http_no_2xx')
  assert.equal(r.estadoHttp, 403)
  assert.deepEqual(r.items, [])
  // La unidad se cobra igual: Google la ha descontado aunque el cuerpo sea un error.
  assert.equal(r.unidadesGastadas, 1)
  assert.equal(clasificarFalloHttp(r.estadoHttp), 'deshabilitar')
})

test('HTTP 429 y 500 se reintentan; el estado se propaga tal cual', async () => {
  for (const status of [429, 500, 503]) {
    const espia = espiar(() => json({ error: {} }, status))
    const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))
    assert.equal(r.estadoHttp, status)
    assert.equal(clasificarFalloHttp(r.estadoHttp), 'reintentar')
  }
})

test('un fetch que LANZA (red caída, timeout) no propaga la excepción', async () => {
  const queLanza = (async () => {
    throw new Error(`ECONNRESET https://www.googleapis.com/...key=${CLAVE}`)
  }) as unknown as typeof fetch

  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: queLanza }))

  assert.equal(r.motivo, 'sin_respuesta')
  assert.equal(r.estadoHttp, null)
  assert.deepEqual(r.items, [])
  // El mensaje del error llevaba la clave; nada de eso sale del módulo.
  assert.ok(!JSON.stringify(r).includes(CLAVE))
})

test('un 200 con cuerpo no-JSON se marca como cuerpo ilegible, no como caída de red', async () => {
  const espia = espiar(() => new Response('<html>error del proxy</html>', { status: 200 }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.motivo, 'cuerpo_ilegible')
  assert.equal(r.estadoHttp, 200)
})

test('un 200 sin `items` es una respuesta de error disfrazada, no «nada nuevo»', async () => {
  const espia = espiar(() => json({ error: { code: 400, message: 'playlistNotFound' } }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.motivo, 'cuerpo_ilegible')
  assert.deepEqual(r.items, [])
})

test('`items: []` SÍ es «nada nuevo»: éxito sin motivo', async () => {
  const espia = espiar(() => json({ items: [] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.motivo, null)
  assert.deepEqual(r.items, [])
})

test('sin un fetch utilizable tampoco lanza', async () => {
  // Runtime sin fetch global (o inyección mal hecha). Devuelve motivo, no excepción.
  const noEsFuncion = 42 as unknown as typeof fetch
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: noEsFuncion }))

  assert.equal(r.motivo, 'sin_fetch')
  assert.deepEqual(r.items, [])
  assert.equal(r.estadoHttp, null)
})

// ── Higiene de los datos que devuelve la API ───────────────────────────────

test('un videoId que no tiene 11 caracteres se descarta', async () => {
  const espia = espiar(() =>
    json({
      items: [
        itemPlaylist({ videoId: 'corto' }),
        itemPlaylist({ videoId: 'demasiado-largo-para-ser-id' }),
        itemPlaylist({ videoId: 'vid00000001' }),
      ],
    }),
  )
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].externalId, 'vid00000001')
})

test('un ítem sin snippet o sin título se descarta en vez de inventarse', async () => {
  const espia = espiar(() =>
    json({
      items: [
        {},
        { snippet: { resourceId: { videoId: 'vid00000001' }, title: '   ' } },
        null,
        itemPlaylist({ videoId: 'vid00000002' }),
      ],
    }),
  )
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].externalId, 'vid00000002')
})

test('la URL del vídeo se construye a partir del id, siempre canónica', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'vid00000001' })] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))
  assert.equal(r.items[0].url, 'https://www.youtube.com/watch?v=vid00000001')
})

test('una miniatura de un host que la CSP bloquea se guarda como null', async () => {
  const espia = espiar(() =>
    json({ items: [itemPlaylist({ videoId: 'vid00000001', miniatura: 'https://cdn.ejemplo.net/x.jpg' })] }),
  )
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))

  assert.equal(r.items[0].thumbnailUrl, null, 'un hueco roto en la tarjeta es peor que no tener miniatura')
})

test('maxResults se acota al tope de la API (pedir más devuelve 400)', async () => {
  const espia = espiar(() => json({ items: [] }))
  await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl, maxResultados: 500 }))
  assert.ok(espia.urls[0].includes(`maxResults=${MAX_RESULTADOS_API}`))
})

// ── La costura con el catálogo existente (fuentes.ts) ──────────────────────

test('descubrirDeFuente despacha por kind y deja el RSS fuera sin tumbar nada', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'vid00000001' })] }))
  const cuota = crearContadorCuota()
  const comunes = opciones({ fetchImpl: espia.fetchImpl, cuota })

  const playlist = await descubrirDeFuente({ kind: 'youtube_playlist', handle: PLAYLIST }, comunes)
  assert.equal(playlist.motivo, null)
  assert.ok(espia.urls[0].includes(`playlistId=${PLAYLIST}`))

  const canal = await descubrirDeFuente({ kind: 'youtube_channel', handle: CANAL }, comunes)
  assert.equal(canal.motivo, null)
  assert.ok(espia.urls[1].includes('playlistId=UU07-dOwgza1IguKA86jqxNA'))

  const rss = await descubrirDeFuente({ kind: 'rss', handle: 'https://www.who.int/rss-feeds/news-spanish.xml' }, comunes)
  assert.equal(rss.motivo, 'fuente_no_youtube')
  assert.deepEqual(rss.items, [])
  assert.equal(espia.urls.length, 2, 'una fuente RSS no gasta ni una llamada a la Data API')
  assert.equal(cuota.gastadas(), 2)
})

test('una fuente rota no impide que la siguiente se lea (best-effort por fuente)', async () => {
  // Es la promesa del módulo: un origen caído no tumba el ciclo.
  const espia = espiar((url) =>
    url.includes(PLAYLIST) ? json({ error: {} }, 500) : json({ items: [itemPlaylist({ videoId: 'vid00000002' })] }),
  )
  const comunes = opciones({ fetchImpl: espia.fetchImpl })

  const rota = await descubrirDeFuente({ kind: 'youtube_playlist', handle: PLAYLIST }, comunes)
  const sana = await descubrirDeFuente({ kind: 'youtube_channel', handle: CANAL }, comunes)

  assert.equal(rota.motivo, 'http_no_2xx')
  assert.equal(sana.motivo, null)
  assert.equal(sana.items.length, 1)
})

test('lo que devuelve encaja con EntradaCruda: el orquestador no necesita cambios', async () => {
  const espia = espiar(() => json({ items: [itemPlaylist({ videoId: 'vid00000001' })] }))
  const r = await descubrirPorPlaylist(PLAYLIST, opciones({ fetchImpl: espia.fetchImpl }))
  const item = r.items[0]

  // Los campos que `normalizar()` exige para producir un CandidatoContenido.
  assert.equal(typeof item.externalId, 'string')
  assert.equal(typeof item.title, 'string')
  assert.equal(typeof item.url, 'string')
  assert.deepEqual(item.tags, [])
  assert.equal(item.durationSeconds, null, 'playlistItems.list no da duración; eso es videos.list')
})
