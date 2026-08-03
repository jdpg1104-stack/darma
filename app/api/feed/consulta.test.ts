// ============================================================================
// Pruebas de la consulta del feed, del interleave y de la regla de crisis.
//
// El cliente de Supabase se sustituye por uno falso que implementa la MISMA
// comparación de tupla que la RPC de 0102_1_feed_keyset.sql:
//
//     (hot_score, id) < (:score, :id)   order by hot_score desc, id desc
//
// No es un atajo para evitar la base de datos: es lo que permite probar la
// propiedad que de verdad importa del keyset —paginar sin huecos ni repetidos
// mientras alguien publica— de forma determinista y en milisegundos. El plan de
// ejecución real (que use idx_posts_hot y no un seq scan) no se puede probar
// aquí; eso se verifica con EXPLAIN ANALYZE contra Postgres y va en el PR.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { BOOST_BONUS, computeHotScore, effectiveScore, rankFeed } from '../../../lib/feedRanking.ts'
import { CURSOR_VACIO, decodificarCursor } from './cursor.ts'
import {
  SLOTS_INTERLEAVE,
  aPostFeed,
  consultarFeed,
  entrelazar,
  type FilaFeedContenido,
  type FilaFeedEncuesta,
  type FilaFeedPost,
} from './consulta.ts'
import type { ContenidoFeed, ElementoFeed, PostFeed } from './tipos.ts'

// ── Andamiaje ───────────────────────────────────────────────────────────────

/** uuid determinista y ordenable: el orden lexicográfico es el numérico. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

interface Semilla {
  n: number
  upvotes?: number
  replies?: number
  creadoEn?: string
  risk?: FilaFeedPost['risk']
  boostUntil?: string | null
}

const BASE_ISO = '2026-02-01T00:00:00.000Z'

function filaPost(semilla: Semilla): FilaFeedPost {
  const upvote_count = semilla.upvotes ?? 0
  const reply_count = semilla.replies ?? 0
  const created_at = semilla.creadoEn ?? BASE_ISO

  return {
    id: uuid(semilla.n),
    autor_id: uuid(900000 + (semilla.n % 5)),
    kind: 'desahogo',
    body: 'Texto de prueba con longitud suficiente para el feed.',
    topic: null,
    upvote_count,
    reply_count,
    // Espejo de lo que hace el trigger trg_posts_hot en Postgres.
    hot_score: computeHotScore({ upvote_count, reply_count, created_at }),
    boost_until: semilla.boostUntil ?? null,
    risk: semilla.risk ?? 'none',
    created_at,
    he_votado: false,
    alias: `alias_${semilla.n}`,
    avatar_seed: 'abcdef0123456789',
    level: 'semilla',
    availability: 'disponible',
    karma_reputation: 0,
  }
}

function filaContenido(n: number): FilaFeedContenido {
  return {
    id: uuid(500000 + n),
    title: `Contenido ${n}`,
    summary: null,
    url: `https://www.youtube-nocookie.com/embed/c${n}`,
    thumbnail_url: null,
    platform: 'youtube',
    duration_seconds: 120,
    topic: 'ansiedad',
    performance_score: 1 - n / 1000,
  }
}

function filaEncuesta(n: number): FilaFeedEncuesta {
  return {
    id: uuid(700000 + n),
    created_at: new Date(Date.UTC(2026, 5, 1) - n * 3600_000).toISOString(),
  }
}

interface BaseFalsa {
  posts: FilaFeedPost[]
  contenidos: FilaFeedContenido[]
  encuestas: FilaFeedEncuesta[]
}

/** Orden del índice idx_posts_hot: (hot_score desc, id desc). */
function ordenHot(a: FilaFeedPost, b: FilaFeedPost): number {
  if (b.hot_score !== a.hot_score) return b.hot_score - a.hot_score
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * Cliente falso. Reproduce literalmente la comparación de tupla de la RPC —no
 * `hot_score < X or id < Y`, que es lo que generaría `.or()` de supabase-js y lo
 * que devuelve filas de más.
 */
function clienteFalso(base: BaseFalsa): SupabaseClient {
  const falso = {
    rpc(nombre: string, args: Record<string, unknown>) {
      if (nombre === 'feed_keyset') {
        const score = args.p_cursor_score as number | null
        const id = args.p_cursor_id as string | null
        const limite = args.p_limite as number

        const filas = [...base.posts]
          .sort(ordenHot)
          .filter((f) =>
            score == null || id == null ? true : f.hot_score < score || (f.hot_score === score && f.id < id),
          )
          .slice(0, limite)

        return Promise.resolve({ data: filas, error: null })
      }

      if (nombre === 'feed_contenido_keyset') {
        const score = args.p_cursor_score as number | null
        const id = args.p_cursor_id as string | null
        const filas = [...base.contenidos]
          .sort((a, b) => b.performance_score - a.performance_score || (a.id < b.id ? 1 : -1))
          .filter((f) =>
            score == null || id == null
              ? true
              : f.performance_score < score || (f.performance_score === score && f.id < id),
          )
          .slice(0, args.p_limite as number)
        return Promise.resolve({ data: filas, error: null })
      }

      if (nombre === 'feed_encuestas_keyset') {
        const instante = args.p_cursor_creado as string | null
        const id = args.p_cursor_id as string | null
        const filas = [...base.encuestas]
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : -1))
          .filter((f) =>
            instante == null || id == null
              ? true
              : f.created_at < instante || (f.created_at === instante && f.id < id),
          )
          .slice(0, args.p_limite as number)
        return Promise.resolve({ data: filas, error: null })
      }

      return Promise.resolve({ data: null, error: { message: 'rpc desconocida' } })
    },
  }

  return falso as unknown as SupabaseClient
}

function baseCon(posts: FilaFeedPost[]): BaseFalsa {
  return {
    posts,
    contenidos: Array.from({ length: 40 }, (_, i) => filaContenido(i + 1)),
    encuestas: Array.from({ length: 40 }, (_, i) => filaEncuesta(i + 1)),
  }
}

function idsDePosts(items: ElementoFeed[]): string[] {
  return items.flatMap((e) => (e.tipo === 'post' ? [e.post.id] : []))
}

// ── 1 · El orden de la consulta y el de rankFeed son el mismo ───────────────

test('el orden de la consulta coincide con rankFeed, desempate por id desc incluido', async () => {
  const posts = [
    ...Array.from({ length: 28 }, (_, i) => filaPost({ n: i + 1, upvotes: (i * 13) % 90, replies: i % 7 })),
    // Empate exacto de hot_score: fuerza el desempate por id descendente, que es
    // el criterio del índice y el que evita que el keyset salte o repita filas.
    filaPost({ n: 500, upvotes: 42, replies: 3 }),
    filaPost({ n: 501, upvotes: 42, replies: 3 }),
  ]

  const esperado = rankFeed(posts).map((f) => f.id)

  const pagina = await consultarFeed(clienteFalso(baseCon(posts)), {
    carril: 'para_ti',
    limite: posts.length,
    cursor: CURSOR_VACIO,
    idioma: 'es',
  })

  assert.deepEqual(idsDePosts(pagina.items), esperado)
  // Y el desempate es de verdad id DESC, no el orden de inserción.
  assert.ok(esperado.indexOf(uuid(501)) < esperado.indexOf(uuid(500)))
})

// ── 2 · Interleave determinista ────────────────────────────────────────────

test('el interleave coloca contenido y encuesta en los slots 3, 8 y 13', async () => {
  const posts = Array.from({ length: 20 }, (_, i) => filaPost({ n: i + 1, upvotes: 100 - i }))

  const pagina = await consultarFeed(clienteFalso(baseCon(posts)), {
    carril: 'para_ti',
    limite: 20,
    cursor: CURSOR_VACIO,
    idioma: 'es',
  })

  assert.equal(pagina.items[3].tipo, 'contenido')
  assert.equal(pagina.items[8].tipo, 'encuesta')
  assert.equal(pagina.items[13].tipo, 'contenido')
  // Los 20 posts siguen estando: el interleave añade, no sustituye.
  assert.equal(idsDePosts(pagina.items).length, 20)
})

test('el interleave es determinista: dos renders idénticos dan lo mismo', async () => {
  const posts = Array.from({ length: 20 }, (_, i) => filaPost({ n: i + 1, upvotes: 100 - i }))
  const cliente = clienteFalso(baseCon(posts))
  const opciones = { carril: 'para_ti' as const, limite: 20, cursor: CURSOR_VACIO, idioma: 'es' }

  const primera = await consultarFeed(cliente, opciones)
  const segunda = await consultarFeed(cliente, opciones)

  assert.deepEqual(primera, segunda)
})

test('un slot que la página no alcanza NO consume su pieza', () => {
  // Con 4 posts la página no llega al slot 8: la encuesta no se gasta. Avanzar
  // su cursor haría desaparecer esa encuesta para siempre, sin síntoma.
  const posts: PostFeed[] = Array.from({ length: 4 }, (_, i) =>
    aPostFeed(filaPost({ n: i + 1, upvotes: 10 - i })),
  )
  const contenidos: ContenidoFeed[] = [
    { id: uuid(1001), titulo: 'A', resumen: null, url: 'u', miniatura: null, plataforma: 'youtube', duracionSegundos: null },
    { id: uuid(1002), titulo: 'B', resumen: null, url: 'u', miniatura: null, plataforma: 'youtube', duracionSegundos: null },
  ]

  const resultado = entrelazar(posts, contenidos, [uuid(2001)])

  assert.equal(resultado.contenidoUsado, 1)
  assert.equal(resultado.encuestaUsada, 0)
  assert.equal(resultado.elementos.length, 5)
  assert.equal(resultado.elementos[3].tipo, 'contenido')
})

test('ningún post ocupa un slot de interleave: son espacio de promoción', () => {
  const posts: PostFeed[] = Array.from({ length: 20 }, (_, i) =>
    aPostFeed(filaPost({ n: i + 1, upvotes: 100 - i, risk: i % 3 === 0 ? 'critical' : 'none' })),
  )
  const contenidos: ContenidoFeed[] = Array.from({ length: 2 }, (_, i) => ({
    id: uuid(1001 + i), titulo: 'C', resumen: null, url: 'u', miniatura: null, plataforma: 'youtube', duracionSegundos: null,
  }))

  const { elementos } = entrelazar(posts, contenidos, [uuid(2001)])

  for (const slot of SLOTS_INTERLEAVE) {
    assert.notEqual(elementos[slot.indice].tipo, 'post', `el slot ${slot.indice} lo ocupa un post`)
  }
})

// ── 3 · La regla de crisis ─────────────────────────────────────────────────

test('FALLO · un post crítico con boost VIGENTE no recibe BOOST_BONUS y no sale impulsado', () => {
  const ahora = new Date('2026-02-02T00:00:00.000Z')
  const fila = filaPost({
    n: 42,
    upvotes: 50,
    replies: 4,
    risk: 'critical',
    boostUntil: '2026-03-01T00:00:00.000Z', // muy en el futuro
  })

  const post = aPostFeed(fila, ahora)
  assert.equal(post.impulsado, false)

  // Y el score efectivo es exactamente el hot score, sin el bono.
  const sinBono = effectiveScore(fila, ahora)
  assert.equal(sinBono, fila.hot_score)
  assert.notEqual(sinBono, fila.hot_score + BOOST_BONUS)
})

test('FALLO · lo mismo con risk = high', () => {
  const ahora = new Date('2026-02-02T00:00:00.000Z')
  const post = aPostFeed(
    filaPost({ n: 43, upvotes: 50, risk: 'high', boostUntil: '2026-03-01T00:00:00.000Z' }),
    ahora,
  )
  assert.equal(post.impulsado, false)
})

test('un post SIN riesgo y con boost vigente sí sale impulsado (el control del test anterior)', () => {
  const ahora = new Date('2026-02-02T00:00:00.000Z')
  const post = aPostFeed(
    filaPost({ n: 44, upvotes: 50, risk: 'none', boostUntil: '2026-03-01T00:00:00.000Z' }),
    ahora,
  )
  assert.equal(post.impulsado, true)
})

test('un post crítico aparece en el feed en SU posición por hot_score, ni al final ni filtrado', async () => {
  // La optimización más natural del mundo —hundir los posts en crisis para que
  // «no molesten»— está prohibida por CONTRATOS §9. Quien escribe desde ahí
  // necesita ser visto, no archivado.
  const posts = [
    filaPost({ n: 1, upvotes: 300 }),
    filaPost({ n: 2, upvotes: 200 }),
    filaPost({ n: 3, upvotes: 150, risk: 'critical', boostUntil: '2026-12-01T00:00:00.000Z' }),
    filaPost({ n: 4, upvotes: 100 }),
    filaPost({ n: 5, upvotes: 50 }),
  ]

  const pagina = await consultarFeed(clienteFalso(baseCon(posts)), {
    carril: 'para_ti',
    limite: 5,
    cursor: CURSOR_VACIO,
    idioma: 'es',
    ahora: new Date('2026-02-02T00:00:00.000Z'),
  })

  const ids = idsDePosts(pagina.items)
  assert.deepEqual(ids, [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)])
  assert.equal(ids.indexOf(uuid(3)), 2, 'el post crítico se ha movido de sitio')

  const critico = pagina.items.find((e) => e.tipo === 'post' && e.post.id === uuid(3))
  assert.ok(critico && critico.tipo === 'post')
  assert.equal(critico.post.enRiesgo, true)
  assert.equal(critico.post.impulsado, false)
})

// ── 4 · Nada prohibido sale en la respuesta ────────────────────────────────

test('la respuesta no lleva ni un campo de los prohibidos', async () => {
  const posts = [filaPost({ n: 1, upvotes: 10, risk: 'critical', boostUntil: '2026-12-01T00:00:00.000Z' })]

  const pagina = await consultarFeed(clienteFalso(baseCon(posts)), {
    carril: 'para_ti',
    limite: 1,
    cursor: CURSOR_VACIO,
    idioma: 'es',
  })

  const serializado = JSON.stringify(pagina)
  for (const prohibido of [
    'hot_score', 'boost_until', 'author_id', 'shadow_banned', 'state',
    'email', 'phone', 'real_name', 'contact_hash', 'user_agent',
    'karma_spendable', 'crystals', 'listen_credits',
  ]) {
    assert.ok(!serializado.includes(prohibido), `la respuesta filtra «${prohibido}»`)
  }
  // `risk` crudo tampoco: solo el booleano `enRiesgo`.
  assert.ok(!serializado.includes('"critical"'), 'la respuesta filtra el nivel de riesgo crudo')

  const elemento = pagina.items[0]
  assert.ok(elemento.tipo === 'post')
  assert.deepEqual(
    Object.keys(elemento.post).sort(),
    ['autor', 'body', 'creadoEn', 'enRiesgo', 'heVotado', 'id', 'impulsado', 'kind', 'respuestas', 'topic', 'upvotes'],
  )
  assert.deepEqual(
    Object.keys(elemento.post.autor).sort(),
    ['alias', 'avatarSeed', 'disponibilidad', 'esMentor', 'id', 'karmaReputacion', 'nivel'],
  )
})

// ── 5 · Paginación ─────────────────────────────────────────────────────────

async function recorrer(base: BaseFalsa, paginas: number, limite = 20) {
  const cliente = clienteFalso(base)
  const ids: string[] = []
  let cursor = CURSOR_VACIO
  let token: string | null = null
  let vistas = 0

  for (let i = 0; i < paginas; i++) {
    const pagina = await consultarFeed(cliente, { carril: 'para_ti', limite, cursor, idioma: 'es' })
    ids.push(...idsDePosts(pagina.items))
    vistas++
    token = pagina.siguienteCursor
    if (token === null) break
    cursor = decodificarCursor(token, 'para_ti')
  }

  return { ids, vistas, token }
}

test('10 páginas seguidas: ids únicos y cobertura completa del conjunto', async () => {
  const posts = Array.from({ length: 200 }, (_, i) => filaPost({ n: i + 1, upvotes: (i * 37) % 400, replies: i % 11 }))
  const base = baseCon(posts)

  const { ids, token } = await recorrer(base, 10)

  assert.equal(ids.length, 200, 'no se han recorrido las 200 filas')
  assert.equal(new Set(ids).size, 200, 'hay ids repetidos')
  assert.deepEqual(ids, rankFeed(posts).map((f) => f.id), 'el orden global no es el del ranking')

  // Con 200 filas y páginas de 20, la décima viene LLENA, así que todavía trae
  // cursor: «página llena» y «hay más» no son lo mismo, y distinguirlos exigiría
  // pedir `limite + 1` o contar. El precio es UNA petición de más que vuelve
  // vacía y cierra el scroll; el precio de la alternativa (count) es un seq scan
  // sobre `posts` en cada scroll. Se paga la petición.
  assert.notEqual(token, null)

  const cliente = clienteFalso(base)
  const ultima = await consultarFeed(cliente, {
    carril: 'para_ti', limite: 20, cursor: decodificarCursor(token, 'para_ti'), idioma: 'es',
  })
  assert.equal(idsDePosts(ultima.items).length, 0)
  assert.equal(ultima.siguienteCursor, null)
})

test('FALLO · publicar 50 posts entre la página 1 y la 2 no provoca duplicados ni saltos', async () => {
  // Esto es EXACTAMENTE lo que rompería un OFFSET: los 50 nuevos desplazan todo
  // y el usuario ve otra vez las tarjetas que acaba de leer.
  const posts = Array.from({ length: 100 }, (_, i) => filaPost({ n: i + 1, upvotes: 400 - i * 3 }))
  const base = baseCon(posts)
  const cliente = clienteFalso(base)

  const pagina1 = await consultarFeed(cliente, {
    carril: 'para_ti', limite: 20, cursor: CURSOR_VACIO, idioma: 'es',
  })
  const idsPagina1 = idsDePosts(pagina1.items)
  assert.equal(idsPagina1.length, 20)
  assert.ok(pagina1.siguienteCursor)

  // 50 posts nuevos, todos con MUCHA señal: caerían en la página 1 si se
  // recargara. El cursor apunta por debajo de ellos, así que no deben aparecer.
  const nuevos = Array.from({ length: 50 }, (_, i) => filaPost({ n: 800 + i, upvotes: 9000 + i }))
  base.posts.push(...nuevos)

  const restantes: string[] = []
  let cursor = decodificarCursor(pagina1.siguienteCursor, 'para_ti')
  for (let i = 0; i < 10; i++) {
    const pagina = await consultarFeed(cliente, { carril: 'para_ti', limite: 20, cursor, idioma: 'es' })
    restantes.push(...idsDePosts(pagina.items))
    if (pagina.siguienteCursor === null) break
    cursor = decodificarCursor(pagina.siguienteCursor, 'para_ti')
  }

  const todos = [...idsPagina1, ...restantes]
  assert.equal(new Set(todos).size, todos.length, 'hay tarjetas repetidas tras la inserción')

  const idsNuevos = new Set(nuevos.map((f) => f.id))
  assert.ok(!restantes.some((id) => idsNuevos.has(id)), 'un post nuevo se ha colado por encima del cursor')

  // Y las 80 filas que quedaban del conjunto original están todas, sin huecos.
  assert.equal(restantes.length, 80)
  assert.equal(todos.length, 100)
})

test('la última página cierra con siguienteCursor = null (sin count(*))', async () => {
  const posts = Array.from({ length: 25 }, (_, i) => filaPost({ n: i + 1, upvotes: 100 - i }))
  const cliente = clienteFalso(baseCon(posts))

  const p1 = await consultarFeed(cliente, { carril: 'para_ti', limite: 20, cursor: CURSOR_VACIO, idioma: 'es' })
  assert.ok(p1.siguienteCursor)

  const p2 = await consultarFeed(cliente, {
    carril: 'para_ti', limite: 20, cursor: decodificarCursor(p1.siguienteCursor, 'para_ti'), idioma: 'es',
  })
  assert.equal(idsDePosts(p2.items).length, 5)
  assert.equal(p2.siguienteCursor, null)
})

test('FALLO · un cursor corrupto sirve la primera página, no una excepción ni un 500', async () => {
  const posts = Array.from({ length: 30 }, (_, i) => filaPost({ n: i + 1, upvotes: 100 - i }))
  const cliente = clienteFalso(baseCon(posts))

  const referencia = await consultarFeed(cliente, {
    carril: 'para_ti', limite: 20, cursor: CURSOR_VACIO, idioma: 'es',
  })
  const conBasura = await consultarFeed(cliente, {
    carril: 'para_ti', limite: 20, cursor: decodificarCursor('%%%basura%%%', 'para_ti'), idioma: 'es',
  })

  assert.deepEqual(idsDePosts(conBasura.items), idsDePosts(referencia.items))
})

// ── 6 · Degradación de los carriles accesorios ─────────────────────────────

test('si el contenido curado falla, el feed de la comunidad se sirve igual', async () => {
  const posts = Array.from({ length: 20 }, (_, i) => filaPost({ n: i + 1, upvotes: 100 - i }))
  const base = baseCon(posts)

  const clienteRoto = {
    rpc(nombre: string, args: Record<string, unknown>) {
      if (nombre === 'feed_keyset') return clienteFalso(base).rpc(nombre, args)
      return Promise.resolve({ data: null, error: { message: 'catálogo caído' } })
    },
  } as unknown as SupabaseClient

  const pagina = await consultarFeed(clienteRoto, {
    carril: 'para_ti', limite: 20, cursor: CURSOR_VACIO, idioma: 'es',
  })

  assert.equal(idsDePosts(pagina.items).length, 20)
  assert.ok(!pagina.items.some((e) => e.tipo !== 'post'))
})

test('si el carril de posts falla, se levanta error_interno sin filtrar el mensaje de Postgres', async () => {
  const clienteRoto = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: 'relation "public.posts" does not exist', code: '42P01' },
      })
    },
  } as unknown as SupabaseClient

  await assert.rejects(
    () => consultarFeed(clienteRoto, { carril: 'para_ti', limite: 20, cursor: CURSOR_VACIO, idioma: 'es' }),
    (error: unknown) => {
      const mensaje = (error as Error).message
      assert.equal((error as { code?: string }).code, 'error_interno')
      assert.ok(!mensaje.includes('public.posts'), 'el error filtra el nombre de la tabla')
      assert.ok(!mensaje.includes('42P01'), 'el error filtra el código de Postgres')
      return true
    },
  )
})
