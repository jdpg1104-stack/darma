// ============================================================================
// B21 §2 · Pruebas de la guarda de idioma de audio. SIN RED.
//
// El camino feliz aquí es de una línea; lo que de verdad hay que sostener es el
// camino de FALLO, porque el incidente que motiva este módulo no fue un error
// de red: fue una respuesta que alguien interpretó como le convenía.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clasificarCodigoIdioma,
  rechazaPorIdioma,
  resolverIdiomaAudio,
  type VeredictoIdiomaAudio,
} from './idiomaAudio.ts'

const CLAVE = 'clave-de-prueba'

interface SnippetFalso {
  defaultAudioLanguage?: string
  defaultLanguage?: string
}

/** Doble de `fetch`: ni un byte de red. Devuelve un `videos.list` con un ítem. */
function fetchConSnippet(snippet: SnippetFalso, espia?: { n: number; url: string | null }): typeof fetch {
  return (async (url: string) => {
    if (espia) {
      espia.n++
      espia.url = url
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: 'vid', snippet }] }),
    } as unknown as Response
  }) as unknown as typeof fetch
}

/** `videos.list` que contesta bien pero sin ítems: id inexistente, privado o borrado. */
const fetchSinItems = (async () =>
  ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as unknown as Response) as unknown as typeof fetch

/** HTTP no-2xx. 403 es la cuota agotada, que es el caso que más duele. */
function fetchConEstado(status: number): typeof fetch {
  return (async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch
}

const fetchQueLanza = (async () => {
  throw new Error('ECONNRESET')
}) as unknown as typeof fetch

/** Contesta 200 pero el cuerpo no es JSON: `res.json()` revienta. */
const fetchConJsonIlegible = (async () =>
  ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    },
  }) as unknown as Response) as unknown as typeof fetch

function resolver(snippet: SnippetFalso, opciones = {}): Promise<VeredictoIdiomaAudio> {
  return resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl: fetchConSnippet(snippet), ...opciones })
}

// ── El incidente ────────────────────────────────────────────────────────────

test('🔴 audio declarado en inglés → no_es_espanol, aunque el título parezca español', async () => {
  // El caso de DataLaps del 2026-07-29: título traducido, audio en inglés. El
  // título no se mira aquí a propósito — mentía.
  const v = await resolver({ defaultAudioLanguage: 'en' })
  assert.equal(v.decision, 'no_es_espanol')
  assert.equal(v.motivo, 'audio_declarado_no_espanol')
  assert.equal(v.campo, 'defaultAudioLanguage')
  assert.equal(rechazaPorIdioma(v), true)
})

test('🔴 el caso de `yt:who_social_connection` («Benny\'s Story») se caza', async () => {
  // Fuente real del catálogo: OMS · The Social Connection Series, declarada
  // `language: 'en'` en fuentes.ts, con títulos que no avisan de nada.
  const v = await resolver({ defaultAudioLanguage: 'en-US', defaultLanguage: 'en' })
  assert.equal(v.decision, 'no_es_espanol')
  assert.equal(v.codigoDeclarado, 'en-US')
})

// ── Español en todas sus variantes ──────────────────────────────────────────

test('es, es-ES, es-419, es-MX, ES y espacios sobrantes → es_espanol', async () => {
  for (const codigo of ['es', 'es-ES', 'es-419', 'es-MX', 'ES', ' es_419 ', 'es-us']) {
    const v = await resolver({ defaultAudioLanguage: codigo })
    assert.equal(v.decision, 'es_espanol', `«${codigo}» debería ser español`)
    assert.equal(v.motivo, 'audio_declarado_espanol')
    assert.equal(rechazaPorIdioma(v), false)
  }
})

test('«est» y «esu» NO son español: no se compara por prefijo', async () => {
  // La implementación ingenua sería `startsWith('es')`. 'est' (estonio) y 'esu'
  // (yupik central) son códigos reales que la partirían.
  for (const codigo of ['est', 'esu', 'eu', 'en', 'pt-BR']) {
    const v = await resolver({ defaultAudioLanguage: codigo })
    assert.equal(v.decision, 'no_es_espanol', `«${codigo}» no debería contar como español`)
  }
})

// ── `desconocido` NO es rechazo. Es el contrato del módulo ──────────────────

test('🔴 sin ninguno de los dos campos → desconocido, y NUNCA no_es_espanol', async () => {
  // El caso CORRIENTE, no el raro: YouTube deja `defaultAudioLanguage` vacío a
  // menudo porque lo rellena el canal a mano. El respaldo es el clasificador
  // por IA de B21 §5, que aún no existe; hasta entonces el ítem queda pendiente.
  const v = await resolver({})
  assert.equal(v.decision, 'desconocido')
  assert.equal(v.motivo, 'sin_declarar')
  assert.equal(v.campo, null)
  assert.notEqual(v.decision, 'no_es_espanol')
  assert.equal(rechazaPorIdioma(v), false)
})

test('🔴 «desconocido» es un valor PROPIO en todos los fallos, nunca el veredicto que conviene', async () => {
  // Si algún día alguien «simplifica» el tipo a un booleano, este es el test que
  // se pone rojo. Mismo guardián que el de embebible.ts.
  const fallos: Array<[string, typeof fetch]> = [
    ['cuota agotada (403)', fetchConEstado(403)],
    ['servidor caído (500)', fetchConEstado(500)],
    ['429', fetchConEstado(429)],
    ['red caída', fetchQueLanza],
    ['JSON ilegible', fetchConJsonIlegible],
    ['sin ítems', fetchSinItems],
  ]
  for (const [nombre, fetchImpl] of fallos) {
    const v = await resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl })
    assert.equal(v.decision, 'desconocido', `${nombre} debería quedar desconocido`)
    assert.equal(rechazaPorIdioma(v), false, `${nombre} no puede rechazar`)
    assert.equal(v.codigoDeclarado, null)
  }
})

test('los motivos distinguen el tipo de fallo, para que la operación se vea en ingest_log', async () => {
  assert.equal((await resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl: fetchConEstado(403) })).motivo, 'respuesta_no_ok')
  assert.equal((await resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl: fetchQueLanza })).motivo, 'sin_respuesta')
  assert.equal((await resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl: fetchSinItems })).motivo, 'video_no_encontrado')
})

// ── Sin clave: desconocido, y sin gastar una petición ───────────────────────

test('🔴 sin YOUTUBE_API_KEY → desconocido (no rechazo) y NI SIQUIERA se pide', async () => {
  const previo = process.env.YOUTUBE_API_KEY
  try {
    delete process.env.YOUTUBE_API_KEY
    const espia = { n: 0, url: null as string | null }
    const v = await resolverIdiomaAudio('vid', { fetchImpl: fetchConSnippet({ defaultAudioLanguage: 'en' }, espia) })
    assert.equal(v.decision, 'desconocido')
    assert.equal(v.motivo, 'sin_clave_api')
    assert.equal(espia.n, 0, 'sin clave no tiene sentido llamar a la API')
  } finally {
    if (previo === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = previo
  }
})

test('la clave se lee del entorno en cada llamada, no al importar el módulo', async () => {
  const previo = process.env.YOUTUBE_API_KEY
  try {
    process.env.YOUTUBE_API_KEY = 'del-entorno'
    const espia = { n: 0, url: null as string | null }
    await resolverIdiomaAudio('vid', { fetchImpl: fetchConSnippet({ defaultAudioLanguage: 'es' }, espia) })
    assert.equal(espia.n, 1)
    assert.ok(espia.url?.includes('key=del-entorno'))
  } finally {
    if (previo === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = previo
  }
})

test('un videoId vacío no genera petición', async () => {
  const espia = { n: 0, url: null as string | null }
  const v = await resolverIdiomaAudio('', { apiKey: CLAVE, fetchImpl: fetchConSnippet({}, espia) })
  assert.equal(v.decision, 'desconocido')
  assert.equal(v.motivo, 'sin_video_id')
  assert.equal(espia.n, 0)
})

// ── La llamada en sí ────────────────────────────────────────────────────────

test('consulta videos.list con part=snippet y nada más', async () => {
  // `part=snippet,status` sería gratis en cuota, pero embebible.ts ya resuelve
  // la incrustación con oEmbed SIN gastar cuota de la Data API. No se duplica.
  const espia = { n: 0, url: null as string | null }
  await resolverIdiomaAudio('abc123', { apiKey: CLAVE, fetchImpl: fetchConSnippet({ defaultAudioLanguage: 'es' }, espia) })
  assert.ok(espia.url?.startsWith('https://www.googleapis.com/youtube/v3/videos?'))
  assert.ok(espia.url?.includes('part=snippet'))
  assert.ok(!espia.url?.includes('status'))
  assert.ok(espia.url?.includes('id=abc123'))
})

test('el timeout aborta la petición y deja desconocido', async () => {
  const fetchQueSeCuelga = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolver, rechazar) => {
      init?.signal?.addEventListener('abort', () => rechazar(new Error('AbortError')))
    })) as unknown as typeof fetch

  const v = await resolverIdiomaAudio('vid', { apiKey: CLAVE, fetchImpl: fetchQueSeCuelga, timeoutMs: 10 })
  assert.equal(v.decision, 'desconocido')
  assert.equal(v.motivo, 'sin_respuesta')
})

// ── El respaldo `defaultLanguage`, y por qué es discutible ──────────────────

test('sin audio declarado, `defaultLanguage` sirve de respaldo (activado por defecto)', async () => {
  const v = await resolver({ defaultLanguage: 'en' })
  assert.equal(v.decision, 'no_es_espanol')
  // Motivo DISTINTO al del audio: `defaultLanguage` es el idioma del título y la
  // descripción, no del audio. La distinción permite medir cuántos ítems
  // dependen de este respaldo antes de retirarlo (DataLaps lo retiró el
  // 2026-07-31 tras medir falsos rechazos y falsos pases).
  assert.equal(v.motivo, 'metadato_no_espanol')
  assert.equal(v.campo, 'defaultLanguage')
})

test('el respaldo se puede apagar: entonces sin audio declarado es desconocido', async () => {
  const v = await resolver({ defaultLanguage: 'en' }, { respaldoDefaultLanguage: false })
  assert.equal(v.decision, 'desconocido')
  assert.equal(v.motivo, 'sin_declarar')
})

test('`defaultAudioLanguage` manda sobre `defaultLanguage` cuando ambos están', async () => {
  // El caso exacto del incidente al revés: metadato en español, audio en inglés.
  const v = await resolver({ defaultAudioLanguage: 'en', defaultLanguage: 'es' })
  assert.equal(v.decision, 'no_es_espanol')
  assert.equal(v.campo, 'defaultAudioLanguage')
})

test('un audio declarado vacío no cuenta como declarado', async () => {
  const v = await resolver({ defaultAudioLanguage: '   ', defaultLanguage: 'es' })
  assert.equal(v.decision, 'es_espanol')
  assert.equal(v.campo, 'defaultLanguage')
})

// ── La parte pura ───────────────────────────────────────────────────────────

test('clasificarCodigoIdioma es pura y cubre los tres estados', () => {
  assert.equal(clasificarCodigoIdioma('es-419'), 'es_espanol')
  assert.equal(clasificarCodigoIdioma('fr'), 'no_es_espanol')
  assert.equal(clasificarCodigoIdioma(''), 'desconocido')
  assert.equal(clasificarCodigoIdioma('   '), 'desconocido')
  assert.equal(clasificarCodigoIdioma(null), 'desconocido')
  assert.equal(clasificarCodigoIdioma(undefined), 'desconocido')
})
