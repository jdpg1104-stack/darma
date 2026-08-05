import test from 'node:test'
import assert from 'node:assert/strict'

import { crearConsultaMetadatos, duracionIsoASegundos } from './metadatosVideo.ts'

/** Respuesta de `videos.list` con el `snippet` (y `contentDetails`) que se le pida. */
function respuesta(
  snippet: Record<string, unknown> | null,
  status = 200,
  contentDetails?: Record<string, unknown>,
): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => (snippet === null ? { items: [] } : { items: [{ snippet, contentDetails }] }),
    }) as unknown as Response) as unknown as typeof fetch
}

/** Cuenta llamadas y guarda las URLs, para poder afirmar sobre la cuota gastada. */
function espia(inner: typeof fetch): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(String(url))
    return (inner as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
  }) as unknown as typeof fetch
  return { fetch: f, urls }
}

const CLAVE = 'AIzaSyDePrueba'

// ── Lo que trae ─────────────────────────────────────────────────────────────

test('devuelve los campos del snippet y la duración de contentDetails', async () => {
  const consultar = crearConsultaMetadatos({
    apiKey: CLAVE,
    fetchImpl: respuesta(
      {
        channelId: 'UC07-dOwgza1IguKA86jqxNA',
        defaultAudioLanguage: 'es-419',
        defaultLanguage: 'es',
      },
      200,
      { duration: 'PT12M30S' },
    ),
  })

  assert.deepEqual(await consultar('abcdefghijk'), {
    channelId: 'UC07-dOwgza1IguKA86jqxNA',
    defaultAudioLanguage: 'es-419',
    defaultLanguage: 'es',
    durationSeconds: 750,
  })
})

test('sin contentDetails la duración es null, y el resto del snippet no se pierde', async () => {
  const consultar = crearConsultaMetadatos({
    apiKey: CLAVE,
    fetchImpl: respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }),
  })
  const meta = await consultar('abcdefghijk')
  assert.equal(meta?.channelId, 'UC07-dOwgza1IguKA86jqxNA')
  assert.equal(meta?.durationSeconds, null)
})

test('🔴 la duración viaja en la MISMA llamada: part pide snippet y contentDetails', async () => {
  // Es el motivo de capturarla aquí: videos.list cuesta 1 unidad pidas los
  // `part` que pidas. Una segunda llamada solo por la duración costaría el doble.
  const e = espia(respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }, 200, { duration: 'PT1M' }))
  await crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })('abcdefghijk')
  assert.equal(e.urls.length, 1)
  assert.ok(e.urls[0]?.includes('part=snippet,contentDetails'))
})

// ── duracionIsoASegundos: pura, sin red ─────────────────────────────────────

test('duracionIsoASegundos entiende las formas reales de YouTube', () => {
  assert.equal(duracionIsoASegundos('PT54S'), 54)
  assert.equal(duracionIsoASegundos('PT12M30S'), 750)
  assert.equal(duracionIsoASegundos('PT1H2M3S'), 3_723)
  assert.equal(duracionIsoASegundos('P1DT1S'), 86_401)
  assert.equal(duracionIsoASegundos(' PT2M '), 120, 'el espacio sobrante no invalida el dato')
})

test('🔴 una duración de CERO es null, no 0: un 0 completaría el vídeo al primer latido', () => {
  // 'P0D' es lo que declara YouTube en los directos. Con 0 en duration_seconds
  // el objetivo de acreditación sería 0 y el +1 se regalaría al instante — el
  // agujero contrario al que la captura de duración viene a cerrar.
  assert.equal(duracionIsoASegundos('P0D'), null)
  assert.equal(duracionIsoASegundos('PT0S'), null)
})

test('duracionIsoASegundos: lo que no encaja es null, nunca un número inventado', () => {
  assert.equal(duracionIsoASegundos(null), null)
  assert.equal(duracionIsoASegundos(undefined), null)
  assert.equal(duracionIsoASegundos(''), null)
  assert.equal(duracionIsoASegundos('7200'), null)
  assert.equal(duracionIsoASegundos('P1W'), null, 'YouTube no usa semanas; conservador a propósito')
  assert.equal(duracionIsoASegundos('PT'), null)
})

test('los campos ausentes son null, no cadena vacía', async () => {
  // El caso REAL más frecuente, medido contra la API: YouTube rellena channelId
  // pero no declara idioma en la mayoría de los vídeos.
  const consultar = crearConsultaMetadatos({
    apiKey: CLAVE,
    fetchImpl: respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }),
  })
  const meta = await consultar('abcdefghijk')
  assert.equal(meta?.channelId, 'UC07-dOwgza1IguKA86jqxNA')
  assert.equal(meta?.defaultAudioLanguage, null)
  assert.equal(meta?.defaultLanguage, null)
})

test('una cadena en blanco cuenta como ausente', async () => {
  const consultar = crearConsultaMetadatos({
    apiKey: CLAVE,
    fetchImpl: respuesta({ channelId: '  ', defaultAudioLanguage: '' }),
  })
  const meta = await consultar('abcdefghijk')
  assert.equal(meta?.channelId, null)
  assert.equal(meta?.defaultAudioLanguage, null)
})

// ── La cuota: el motivo de que este módulo exista ───────────────────────────

test('🔴 el mismo vídeo NO se consulta dos veces', async () => {
  // Es la razón entera del caché. Las dos guardas —canal e idioma— piden el
  // mismo `snippet`; sin memo, cada vídeo costaría 2 unidades en vez de 1.
  const e = espia(respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })

  await consultar('abcdefghijk')
  await consultar('abcdefghijk')
  await consultar('abcdefghijk')

  assert.equal(e.urls.length, 1)
})

test('🔴 un fallo también se cachea: no se reintenta dentro de la misma corrida', async () => {
  // Reintentar en el mismo minuto gasta cuota para obtener el mismo fallo.
  const e = espia(respuesta(null, 500))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })

  assert.equal(await consultar('abcdefghijk'), null)
  assert.equal(await consultar('abcdefghijk'), null)
  assert.equal(e.urls.length, 1)
})

test('vídeos distintos sí gastan una unidad cada uno', async () => {
  const e = espia(respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })
  await consultar('aaaaaaaaaaa')
  await consultar('bbbbbbbbbbb')
  assert.equal(e.urls.length, 2)
})

test('🔴 cada consulta tiene su propio caché: dos corridas no se contaminan', async () => {
  const e = espia(respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA' }))
  await crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })('abcdefghijk')
  await crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })('abcdefghijk')
  assert.equal(e.urls.length, 2, 'no debe haber estado de módulo compartido')
})

// ── Camino de fallo: todo es null, nunca una excepción ──────────────────────

test('🔴 SIN clave no toca la red y devuelve null', async () => {
  // Es un estado de CONFIGURACIÓN. `ejecutar.ts` lo distingue de «no pude» y por
  // eso el pipeline sigue funcionando hoy, sin YOUTUBE_API_KEY.
  const e = espia(respuesta({ channelId: 'UC0' }))
  for (const clave of [null, '', '   ']) {
    const consultar = crearConsultaMetadatos({ apiKey: clave, fetchImpl: e.fetch })
    assert.equal(await consultar('abcdefghijk'), null)
  }
  assert.equal(e.urls.length, 0, 'no se gasta una petición que ya se sabe inútil')
})

test('un videoId vacío no gasta petición', async () => {
  const e = espia(respuesta({ channelId: 'UC0' }))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })
  assert.equal(await consultar(''), null)
  assert.equal(await consultar('   '), null)
  assert.equal(e.urls.length, 0)
})

test('403 (cuota agotada), 429 y 5xx son null, no una suposición', async () => {
  for (const status of [403, 429, 500, 503]) {
    const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: respuesta(null, status) })
    assert.equal(await consultar('abcdefghijk'), null, `status ${status}`)
  }
})

test('items vacío —vídeo borrado o privado— es null', async () => {
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: respuesta(null) })
  assert.equal(await consultar('abcdefghijk'), null)
})

test('un cuerpo ilegible no lanza', async () => {
  const roto = (async () =>
    ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('no es JSON')
      },
    }) as unknown as Response) as unknown as typeof fetch

  await assert.doesNotReject(crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: roto })('abcdefghijk'))
  assert.equal(await crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: roto })('abcdefghijk'), null)
})

test('un fetch que lanza tampoco propaga', async () => {
  const cae = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  assert.equal(await crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: cae })('abcdefghijk'), null)
})

test('el timeout aborta de verdad y devuelve null', async () => {
  const lento = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_, rechazar) => {
      init?.signal?.addEventListener('abort', () => rechazar(new Error('AbortError')))
    })) as unknown as typeof fetch

  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: lento, timeoutMs: 10 })
  assert.equal(await consultar('abcdefghijk'), null)
})

// ── La clave no se escapa ───────────────────────────────────────────────────

test('🔴 la clave va en la URL, así que el resultado NUNCA la lleva', async () => {
  // Este módulo no registra nada por esa razón exacta: el mensaje de un error de
  // fetch arrastra la URL completa, y la URL lleva `key=`. Aquí se comprueba que
  // al menos el valor devuelto está limpio.
  const e = espia(respuesta({ channelId: 'UC07-dOwgza1IguKA86jqxNA', defaultAudioLanguage: 'es' }))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })
  const meta = await consultar('abcdefghijk')

  assert.ok(e.urls[0]?.includes(CLAVE), 'la clave sí viaja en la petición')
  assert.equal(JSON.stringify(meta).includes(CLAVE), false, 'pero no debe volver en el resultado')
})

test('el videoId se escapa antes de entrar en la URL', async () => {
  const e = espia(respuesta(null))
  const consultar = crearConsultaMetadatos({ apiKey: CLAVE, fetchImpl: e.fetch })
  await consultar('a&key=robada')
  assert.equal(e.urls[0]?.includes('&key=robada&'), false, 'un id no puede inyectar parámetros')
})
