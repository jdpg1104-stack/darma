import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CANALES_PERMITIDOS,
  HOSTS_EMBED_PERMITIDOS,
  buscarCanalPorId,
  canalesPendientesDeVerificacion,
  esChannelIdValido,
  esHostEmbedPermitido,
  esVideoIdValido,
  extraerVideoIdYouTube,
  urlEmbedSinCookies,
  validarRegistro,
  verificarCanalDeEmbed,
  type CanalPermitido,
  type ResolutorCanal,
} from './canalesPermitidos.ts'
import { FUENTES_SEMILLA } from './fuentes.ts'

/** Un videoId con la forma exacta (11 caracteres base64url). No existe; da igual: nada sale a la red. */
const ID = 'dQw4w9WgXcQ'
const UC_OMS = 'UC07-dOwgza1IguKA86jqxNA'

// ────────────────────────────────────────────────────────────────────────────
// (A) CONTROL DE HOST · pruebas de INTRUSIÓN
//
// Cada cadena de aquí abajo pasaría un `url.includes('youtube.com')` o un
// `hostname.endsWith('youtube.com')`. Ese es justo el motivo de que existan.
// ────────────────────────────────────────────────────────────────────────────

const INTRUSIONES: readonly [string, string][] = [
  ['https://youtube.com.evil.tld/watch?v=' + ID, 'sufijo de dominio: el host real es evil.tld'],
  ['https://www.youtube.com.evil.tld/embed/' + ID, 'lo mismo con el www delante para dar el pego'],
  ['https://evil.com/youtube.com/watch?v=' + ID, 'el nombre bueno está en la RUTA, no en el host'],
  ['https://evilyoutube.com/watch?v=' + ID, 'termina en youtube.com: mata el atajo endsWith()'],
  ['https://notyoutube.com/watch?v=' + ID, 'idem'],
  ['https://youtube.com.br/watch?v=' + ID, 'TLD distinto, marca reconocible'],
  ['https://sub.youtube.com/embed/' + ID, 'subdominio no declarado: la lista es cerrada'],
  ['https://api.youtube.com/embed/' + ID, 'idem'],
  ['https://m.youtube.com/watch?v=' + ID, 'existe de verdad, pero NO está en la lista (decisión, no olvido)'],
  ['https://youtu.be.evil.tld/' + ID, 'el enlace corto también se falsifica'],
  ['https://www.youtube.com@evil.tld/embed/' + ID, 'userinfo: el host real es lo que va TRAS la arroba'],
  ['https://evil.tld/?u=https://www.youtube.com/embed/' + ID, 'URL buena dentro de un parámetro'],
  ['https://evil.tld/#https://www.youtube.com/embed/' + ID, 'URL buena dentro del fragmento'],
  ['http://www.youtube.com/watch?v=' + ID, 'http:// degradable por un intermediario'],
  ['//www.youtube.com/embed/' + ID, 'relativa al protocolo: `new URL` ni siquiera la parsea'],
  ['javascript:alert(1)//www.youtube.com/embed/' + ID, 'esquema ejecutable'],
  ['data:text/html,<iframe src="https://www.youtube.com/embed/' + ID + '">', 'iframe anidado en un data:'],
  ['https://www.youtube.com./embed/' + ID, 'FQDN con punto final: es OTRO nombre para el resolutor'],
  // Homógrafo: la «е» es U+0435, cirílica. Se escribe con escape a propósito —
  // un carácter así, pegado literal, es invisible en un diff y en un editor.
  ['https://www.youtubе.com/embed/' + ID, 'homógrafo cirílico (URL lo pasa a punycode y ya no casa)'],
  ['', 'cadena vacía'],
  ['no es una url', 'basura'],
]

test('(A) INTRUSIÓN · ningún host falsificado se acepta', () => {
  for (const [url, porQue] of INTRUSIONES) {
    assert.equal(esHostEmbedPermitido(url), false, `debería rechazarse — ${porQue}: ${url}`)
    assert.equal(extraerVideoIdYouTube(url), null, `no debería dar videoId — ${porQue}: ${url}`)
  }
})

test('(A) INTRUSIÓN · un host falsificado no consulta al resolutor (no se gasta cuota)', async () => {
  let llamadas = 0
  const resolutor: ResolutorCanal = async () => {
    llamadas++
    return UC_OMS
  }

  for (const [url] of INTRUSIONES) {
    const v = await verificarCanalDeEmbed(url, { resolutor })
    assert.equal(v.decision, 'rechazado', url)
    assert.equal(v.videoId, null, url)
  }
  assert.equal(llamadas, 0, 'el control (A) corta ANTES de gastar una unidad de cuota')
})

test('(A) los hosts legítimos SÍ pasan, en mayúsculas incluidas', () => {
  const buenas = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `https://youtu.be/${ID}`,
    // `URL` normaliza el host a minúsculas: rechazar esto sería un falso negativo.
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ]
  for (const url of buenas) {
    assert.equal(esHostEmbedPermitido(url), true, url)
    assert.equal(extraerVideoIdYouTube(url), ID, url)
  }
})

test('(A) la lista de hosts es exactamente la declarada, sin comodines', () => {
  assert.deepEqual([...HOSTS_EMBED_PERMITIDOS].sort(), [
    'www.youtube-nocookie.com',
    'www.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'youtube.com',
  ])
})

// ── Extracción del videoId ──────────────────────────────────────────────────

test('extrae el id de los tres formatos, con parámetros de más', () => {
  assert.equal(extraerVideoIdYouTube(`https://www.youtube.com/watch?v=${ID}&t=42&list=PLx`), ID)
  assert.equal(extraerVideoIdYouTube(`https://www.youtube-nocookie.com/embed/${ID}?rel=0&mute=1`), ID)
  assert.equal(extraerVideoIdYouTube(`https://youtu.be/${ID}?t=30`), ID)
  // Segmento sobrante tras el id: se ignora, no invalida.
  assert.equal(extraerVideoIdYouTube(`https://www.youtube.com/embed/${ID}/algo`), ID)
})

test('INTRUSIÓN · ids que no tienen la forma exacta se rechazan', () => {
  const malos = [
    `https://www.youtube.com/watch?v=${ID}x`, // 12 caracteres
    'https://www.youtube.com/watch?v=corto', // 5
    'https://www.youtube.com/watch?v=', // vacío
    'https://www.youtube.com/watch', // sin v
    'https://www.youtube.com/embed/', // sin id
    'https://youtu.be/', // sin id
    'https://www.youtube.com/embed/abc%2F..%2Fdef', // barra codificada
    'https://www.youtube.com/embed/aaaa.aaaaaa', // punto: fuera del alfabeto
    'https://www.youtube.com/embed/aaaa+aaaaaa', // más: fuera del alfabeto
    `https://www.youtube.com/embed/${ID}'"><script>`, // inyección por la ruta
    `https://www.youtube.com/watch?v=${ID}%00`, // byte nulo pegado
    // Travesía de ruta: `URL` normaliza y el pathname acaba siendo `/etc/passwd`.
    `https://www.youtube.com/embed/${ID}/../../etc/passwd`,
    // `/shorts/` NO está soportado, y es deliberado (ver la cabecera del módulo).
    `https://www.youtube.com/shorts/${ID}`,
    // Una playlist tampoco es un vídeo.
    'https://www.youtube.com/playlist?list=PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c',
    'https://www.youtube.com/channel/UC07-dOwgza1IguKA86jqxNA',
  ]
  for (const url of malos) {
    assert.equal(extraerVideoIdYouTube(url), null, url)
  }
})

test('la travesía de ruta no puede reconstruir un id válido', () => {
  // Se comprueba el resultado exacto, no solo que sea null: si algún día `URL`
  // dejara de normalizar, este assert es el que lo cuenta.
  const u = new URL(`https://www.youtube.com/embed/${ID}/../../etc/passwd`)
  assert.equal(u.pathname, '/etc/passwd')
})

test('urlEmbedSinCookies solo construye el host que la CSP permite', () => {
  assert.equal(urlEmbedSinCookies(ID), `https://www.youtube-nocookie.com/embed/${ID}`)
  // Y no acepta cualquier cosa como id: sin esta guarda se podría inyectar ruta.
  assert.equal(urlEmbedSinCookies('../../evil'), null)
  assert.equal(urlEmbedSinCookies(''), null)
  assert.equal(urlEmbedSinCookies(`${ID}?x=1`), null)
})

test('las guardas de forma son estrictas', () => {
  assert.equal(esVideoIdValido(ID), true)
  assert.equal(esVideoIdValido(ID + 'x'), false)
  assert.equal(esChannelIdValido(UC_OMS), true)
  assert.equal(esChannelIdValido('PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c'), false, 'una playlist no es un canal')
  assert.equal(esChannelIdValido('UC' + 'a'.repeat(21)), false, 'un carácter de menos')
  assert.equal(esChannelIdValido('AB' + 'a'.repeat(22)), false, 'sin el prefijo UC')
  assert.equal(esChannelIdValido(''), false)
})

// ────────────────────────────────────────────────────────────────────────────
// (B) IDENTIDAD DE CANAL
// ────────────────────────────────────────────────────────────────────────────

const URL_BUENA = `https://www.youtube.com/watch?v=${ID}`
const resolutorQueDevuelve = (channelId: string | null): ResolutorCanal => async () => channelId

test('(B) el canal está en el registro → permitido', async () => {
  const v = await verificarCanalDeEmbed(URL_BUENA, { resolutor: resolutorQueDevuelve(UC_OMS) })
  assert.equal(v.decision, 'permitido')
  assert.equal(v.motivo, 'canal_permitido')
  assert.equal(v.videoId, ID)
  assert.equal(v.channelId, UC_OMS)
  assert.equal(v.canal?.fuenteKey, 'yt:who')
})

test('(B) un canal ajeno con forma válida → RECHAZADO (el resolutor contestó)', async () => {
  const ajeno = 'UCzzzzzzzzzzzzzzzzzzzzzz'
  const v = await verificarCanalDeEmbed(URL_BUENA, { resolutor: resolutorQueDevuelve(ajeno) })
  assert.equal(v.decision, 'rechazado')
  assert.equal(v.motivo, 'canal_fuera_del_registro')
  assert.equal(v.channelId, ajeno)
  assert.equal(v.canal, null)
})

test('(B) FAIL-CLOSED · sin resolutor no se aprueba nada, pero tampoco se rechaza', async () => {
  const v = await verificarCanalDeEmbed(URL_BUENA)
  assert.equal(v.decision, 'pendiente_revision')
  assert.equal(v.motivo, 'sin_resolutor')
  assert.equal(v.videoId, ID, 'el control (A) sí se resolvió: el id se conserva')
  assert.notEqual(v.decision, 'permitido')
})

test('(B) FAIL-CLOSED · el resolutor que falla NO aprueba y NO rechaza', async () => {
  const casos: readonly [ResolutorCanal, string][] = [
    [resolutorQueDevuelve(null), 'resolutor_sin_respuesta'],
    [
      async () => {
        throw new Error('403 quotaExceeded')
      },
      'resolutor_sin_respuesta',
    ],
    [resolutorQueDevuelve(''), 'channel_id_malformado'],
    [resolutorQueDevuelve('no-es-un-uc'), 'channel_id_malformado'],
    [resolutorQueDevuelve('UC07-dOwgza1IguKA86jqxNA/../otro'), 'channel_id_malformado'],
    // Un resolutor escrito fuera de TypeScript puede devolver `undefined`.
    [(async () => undefined) as unknown as ResolutorCanal, 'resolutor_sin_respuesta'],
  ]

  for (const [resolutor, motivo] of casos) {
    const v = await verificarCanalDeEmbed(URL_BUENA, { resolutor })
    assert.equal(v.decision, 'pendiente_revision', motivo)
    assert.equal(v.motivo, motivo)
    assert.equal(v.canal, null)
  }
})

test('«pendiente_revision» es un valor PROPIO: nunca es «rechazado» ni «permitido»', async () => {
  // Si algún día alguien "simplifica" la decisión a un booleano, este test es el
  // que se pone rojo. Un fallo de red del resolutor NO puede archivar contenido
  // bueno en silencio, y tampoco puede publicarlo.
  const v = await verificarCanalDeEmbed(URL_BUENA, { resolutor: resolutorQueDevuelve(null) })
  assert.equal(v.decision, 'pendiente_revision')
  assert.notEqual(v.decision, 'rechazado')
  assert.notEqual(v.decision, 'permitido')
})

test('verificarCanalDeEmbed nunca lanza, ni con entradas absurdas', async () => {
  const absurdas = ['', 'null', 'https://', ' ', 'https://www.youtube.com/watch?v=' + 'a'.repeat(5000)]
  for (const url of absurdas) {
    const v = await verificarCanalDeEmbed(url, { resolutor: resolutorQueDevuelve(UC_OMS) })
    assert.notEqual(v.decision, 'permitido', url)
  }
})

// ── La disciplina de `channelId: null` ──────────────────────────────────────

const REGISTRO_CON_NULL: readonly CanalPermitido[] = [
  {
    fuenteKey: 'ficticio:sin_uc',
    organismo: 'Organismo oficial cuyo UC no consta',
    ambito: 'Pruebas',
    urlCanal: 'https://www.youtube.com/@ficticio',
    channelId: null,
    verificadoPor: null,
    verificadoEn: '2026-08-04',
    porQue: 'Entrada de prueba: canal oficial verificado cuyo ID canónico NO se pudo confirmar. No se inventa.',
  },
] as const

test('una entrada con channelId null NUNCA casa con nada', () => {
  assert.equal(buscarCanalPorId(UC_OMS, REGISTRO_CON_NULL), null)
  assert.equal(buscarCanalPorId('UCzzzzzzzzzzzzzzzzzzzzzz', REGISTRO_CON_NULL), null)
  // Y ningún valor con pinta de "vacío" la alcanza por la puerta de atrás.
  for (const raro of ['', 'null', 'undefined', 'UC', 'UCnull']) {
    assert.equal(buscarCanalPorId(raro, REGISTRO_CON_NULL), null, raro)
  }
})

test('un canal sin UC confirmado no se publica por API: queda para curación humana', async () => {
  const v = await verificarCanalDeEmbed(URL_BUENA, {
    resolutor: resolutorQueDevuelve(UC_OMS),
    registro: REGISTRO_CON_NULL,
  })
  assert.equal(v.decision, 'rechazado')
  assert.equal(v.motivo, 'canal_fuera_del_registro')
})

test('buscarCanalPorId exige la forma exacta antes de comparar', () => {
  assert.equal(buscarCanalPorId(UC_OMS)?.fuenteKey, 'yt:who')
  assert.equal(buscarCanalPorId(UC_OMS.toLowerCase()), null, 'los IDs distinguen mayúsculas')
  assert.equal(buscarCanalPorId(` ${UC_OMS} `), null, 'no se recorta: se rechaza')
  assert.equal(buscarCanalPorId(UC_OMS + 'x'), null)
})

// ── El registro ─────────────────────────────────────────────────────────────

test('el registro es coherente', () => {
  assert.deepEqual(validarRegistro(), [])
})

test('validarRegistro detecta lo que tiene que detectar', () => {
  const roto: readonly CanalPermitido[] = [
    { ...REGISTRO_CON_NULL[0], channelId: 'UC-invalido', porQue: 'corto' },
    { ...REGISTRO_CON_NULL[0], urlCanal: 'http://inseguro', verificadoEn: 'ayer' },
  ]
  const problemas = validarRegistro(roto)
  assert.ok(problemas.some((p) => p.includes('fuenteKey duplicada')))
  assert.ok(problemas.some((p) => p.includes('channelId con forma inválida')))
  assert.ok(problemas.some((p) => p.includes('justificación insuficiente')))
  assert.ok(problemas.some((p) => p.includes('urlCanal no https')))
  assert.ok(problemas.some((p) => p.includes('verificadoEn no es ISO')))
})

test('EL REGISTRO NO ES MÁS ANCHO QUE EL CATÁLOGO DE FUENTES', () => {
  // Esta es la prueba que impide sembrar «de memoria». Todo canal permitido
  // tiene que existir ya en fuentes.ts, con el MISMO handle. Si alguien añade
  // aquí un UC que no consta allí, se pone roja.
  const canalesDeFuentes = new Map(
    FUENTES_SEMILLA.filter((f) => f.kind === 'youtube_channel').map((f) => [f.key, f.handle]),
  )

  for (const c of CANALES_PERMITIDOS) {
    const handle = canalesDeFuentes.get(c.fuenteKey)
    assert.ok(handle, `${c.fuenteKey} no existe como fuente youtube_channel en fuentes.ts`)
    assert.equal(c.channelId, handle, `el channelId de ${c.fuenteKey} no coincide con su fuente`)
  }
  assert.equal(CANALES_PERMITIDOS.length, 3, 'OMS, CDC y OPS. Ni uno más sin verificar')
})

test('las playlists NO tienen entrada propia: un PL no es un UC', () => {
  const claves = CANALES_PERMITIDOS.map((c) => c.fuenteKey)
  assert.equal(claves.includes('yt:ops_mirar_al_futuro'), false)
  assert.equal(claves.includes('yt:who_social_connection'), false)
  // Y ningún channelId del registro es en realidad un playlistId.
  for (const c of CANALES_PERMITIDOS) {
    assert.ok(c.channelId !== null && c.channelId.startsWith('UC'), c.fuenteKey)
  }
})

test('los tres canales están declarados como PENDIENTES de verificación humana', () => {
  // Igual que los 24 teléfonos: la fecha de revisión no es una verificación.
  // Cuando alguien con nombre confirme un UC contra su fuente, este test cambia
  // de forma — y ese cambio es exactamente el registro de que se hizo.
  const pendientes = canalesPendientesDeVerificacion()
  assert.equal(pendientes.length, 3)
  for (const c of CANALES_PERMITIDOS) {
    assert.equal(c.verificadoPor, null, c.fuenteKey)
  }
})
