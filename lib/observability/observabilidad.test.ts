// ============================================================================
// Tests de B14 · observabilidad
//
// Cubren los 13 casos exigidos por HANDOFF/B14.md §"Pruebas exigidas". El nº 14
// (k6 sale con código ≠ 0 contra un servidor lento) es una verificación manual,
// documentada en scripts/load/README.md.
//
// El acento está en el CAMINO DE FALLO: un endpoint de salud solo vale por lo
// que hace cuando algo está roto, y un logger solo vale por lo que NO escribe.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  configurarEscritor,
  configurarMuestreo,
  construirLinea,
  crearLogger,
  decidirMuestreo,
  esClaveSensible,
  requestIdDe,
  type NivelLog,
} from './logger.ts'

import {
  __reiniciarMetricas,
  contarPeticion,
  exportarPrometheus,
  instantanea,
  normalizarRuta,
  observarError,
  observarLatencia,
  percentil,
  ponerSaturacion,
} from './metricas.ts'

import { conLimite, conTraza, TiempoAgotadoError } from './traza.ts'

import {
  evaluarPresupuestos,
  hayViolacionDeCrisis,
  PRESUPUESTOS,
} from './presupuestos.ts'

import {
  comprobarProfundo,
  comprobarSuperficial,
  TIMEOUT_SUPERFICIAL_MS,
  type Sondas,
} from './dependencias.ts'

import {
  construirMetricas,
  construirSalud,
  construirSaludProfunda,
  estadoGlobal,
  respuestaNoAutenticado,
} from './salud.ts'

// ── Utilidades de test ──────────────────────────────────────────────────────

/** Sondas sanas. Cada test sobrescribe solo la que quiere romper. */
function sondasSanas(sobre: Partial<Sondas> = {}): Sondas {
  return {
    ping: async () => {},
    consultaFeed: async () => {},
    clasificadorIa: async () => ({ estado: 'ok', detalle: 'test' }),
    descuadreLedger: async () => 0,
    crisisSinAtender: async () => 0,
    ...sobre,
  }
}

/** Captura las líneas emitidas por el logger durante `fn`. */
function capturando(fn: () => void): string[] {
  const lineas: string[] = []
  configurarEscritor((linea) => lineas.push(linea))
  try {
    fn()
  } finally {
    configurarEscritor(null)
  }
  return lineas
}

function conEntorno(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previo: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const restaurar = () => {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  const r = fn()
  if (r instanceof Promise) return r.finally(restaurar)
  restaurar()
  return undefined
}

// ============================================================================
// CAMINO FELIZ
// ============================================================================

// ── 1 ───────────────────────────────────────────────────────────────────────
test('1 · evaluarPresupuestos: un snapshot dentro de límites no produce violaciones', () => {
  const violaciones = evaluarPresupuestos({
    feed_p95_ms: 120,
    feed_sql_p95_ms: 18,
    composer_p95_ms: 400,
    hilo_p95_ms: 210,
    ratio_5xx: 0,
    crisis_sin_atender: 0,
    ia_gasto_diario_usd: 3.5,
  })
  assert.deepEqual(violaciones, [])
})

test('1b · el valor EXACTAMENTE igual al límite cumple (el techo es inclusivo)', () => {
  assert.deepEqual(evaluarPresupuestos({ feed_p95_ms: PRESUPUESTOS.feed_p95_ms }), [])
  assert.equal(evaluarPresupuestos({ feed_p95_ms: PRESUPUESTOS.feed_p95_ms + 1 }).length, 1)
})

test('1c · una clave AUSENTE no es una violación (no medido ≠ incumplido)', () => {
  assert.deepEqual(evaluarPresupuestos({}), [])
})

// ── 2 ───────────────────────────────────────────────────────────────────────
test('2 · exportarPrometheus produce texto válido y parseable', () => {
  __reiniciarMetricas()
  observarLatencia('/api/feed', 12)
  observarLatencia('/api/feed', 240)
  observarLatencia('/api/feed', 9000) // por encima del último cubo: solo +Inf
  contarPeticion('/api/feed', 200)
  contarPeticion('/api/feed', 500)
  observarError('internal')
  ponerSaturacion('crisis_sin_atender', 2)

  const texto = exportarPrometheus()

  assert.match(texto, /# HELP darma_latencia_ms /)
  assert.match(texto, /# TYPE darma_latencia_ms histogram/)
  assert.match(texto, /# TYPE darma_peticiones_total counter/)
  assert.match(texto, /# TYPE darma_saturacion gauge/)
  assert.match(texto, /darma_latencia_ms_bucket\{ruta="\/api\/feed",le="\+Inf"\} 3/)
  assert.match(texto, /darma_latencia_ms_count\{ruta="\/api\/feed"\} 3/)
  assert.match(texto, /darma_errores_total\{codigo="internal"\} 1/)
  assert.match(texto, /darma_saturacion\{recurso="crisis_sin_atender"\} 2/)
  assert.ok(texto.endsWith('\n'), 'el formato exige salto de línea final')

  // Parseable: toda línea de muestra es `nombre{etiquetas} valor`.
  for (const linea of texto.trim().split('\n')) {
    if (linea.startsWith('#')) continue
    assert.match(linea, /^[a-z_]+(\{[^}]*\})? -?[\d.e+]+$/i, `línea no parseable: ${linea}`)
  }
})

test('2b · el histograma es acumulativo y monótono (requisito de Prometheus)', () => {
  __reiniciarMetricas()
  for (const ms of [1, 30, 30, 700, 3000]) observarLatencia('/api/feed', ms)

  const cuentas = [...exportarPrometheus().matchAll(/darma_latencia_ms_bucket\{[^}]*\} (\d+)/g)].map(
    (m) => Number(m[1]),
  )
  for (let i = 1; i < cuentas.length; i += 1) {
    assert.ok(cuentas[i] >= cuentas[i - 1], 'los cubos acumulados no pueden decrecer')
  }
})

test('2c · la cardinalidad se acota: una etiqueta con id no crea una serie por id', () => {
  __reiniciarMetricas()
  const uuid = '11111111-2222-3333-4444-555555555555'
  assert.equal(normalizarRuta(`/api/posts/${uuid}/comentarios`), '/api/posts/:id/comentarios')
  assert.equal(normalizarRuta('/api/feed?cursor=abc'), '/api/feed')

  for (let i = 0; i < 500; i += 1) observarLatencia(`/ruta-inventada-${i}`, 10)
  const series = [...exportarPrometheus().matchAll(/darma_latencia_ms_count\{/g)].length
  assert.ok(series <= 200, `se crearon ${series} series; el techo es 200`)
  assert.match(exportarPrometheus(), /darma_series_desbordadas_total [1-9]\d*/)
})

test('2d · percentil: sin muestras devuelve null, no un cero tranquilizador', () => {
  __reiniciarMetricas()
  assert.equal(percentil('/api/feed', 0.95), null)

  for (let i = 0; i < 99; i += 1) observarLatencia('/api/feed', 10)
  observarLatencia('/api/feed', 1900)
  const p95 = percentil('/api/feed', 0.95)
  assert.ok(p95 !== null && p95 <= 25, `p95=${p95} debería seguir en la parte baja`)
})

test('2e · instantanea: sin tráfico NO inventa un ratio_5xx de 0', () => {
  __reiniciarMetricas()
  assert.equal(instantanea().ratio_5xx, undefined)

  contarPeticion('/api/feed', 200)
  contarPeticion('/api/feed', 500)
  assert.equal(instantanea().ratio_5xx, 0.5)
})

// ── 3 ───────────────────────────────────────────────────────────────────────
test('3 · conTraza devuelve el valor de la función y registra la duración', async () => {
  __reiniciarMetricas()
  configurarMuestreo(1)
  const lineas: string[] = []
  configurarEscritor((l) => lineas.push(l))

  try {
    const log = crearLogger('req-1', '/api/feed')
    const valor = await conTraza('sql:feed', async () => 42, log)
    assert.equal(valor, 42)
  } finally {
    configurarEscritor(null)
    configurarMuestreo(0.01)
  }

  const traza = lineas.map((l) => JSON.parse(l)).find((l) => l.traza === 'sql:feed')
  assert.ok(traza, 'no se registró la traza')
  assert.equal(traza.ok, true)
  assert.equal(typeof traza.ms, 'number')
  assert.equal(traza.request_id, 'req-1')
  assert.match(exportarPrometheus(), /darma_latencia_ms_count\{ruta="sql:feed"\} 1/)
})

// ── 4 ───────────────────────────────────────────────────────────────────────
test('4 · comprobarSuperficial con Postgres OK → todas ok', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const c = await comprobarSuperficial(sondasSanas())
      assert.deepEqual(c.map((x) => x.nombre).sort(), ['auth', 'postgres'])
      assert.ok(c.every((x) => x.estado === 'ok'), JSON.stringify(c))
      assert.equal(estadoGlobal(c), 'ok')
      assert.equal(construirSalud(c).status, 200)
    },
  )
})

test('4b · comprobarProfundo devuelve las cinco dependencias del contrato', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const c = await comprobarProfundo(sondasSanas())
      assert.deepEqual(
        c.map((x) => x.nombre).sort(),
        ['auth', 'cola_crisis', 'ia', 'ledger', 'postgres'],
      )
    },
  )
})

// ============================================================================
// CAMINO DE FALLO
// ============================================================================

// ── 5 ───────────────────────────────────────────────────────────────────────
test('5 · Postgres caído → /api/health responde 503 y postgres queda "caido"', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const c = await comprobarSuperficial(
        sondasSanas({
          ping: async () => {
            throw new Error('ECONNREFUSED 10.0.0.4:5432')
          },
        }),
      )
      const postgres = c.find((x) => x.nombre === 'postgres')
      assert.equal(postgres?.estado, 'caido')

      const { status, cuerpo } = construirSalud(c)
      assert.equal(status, 503, 'un endpoint de salud que siempre dice 200 alarga la caída')
      assert.equal(cuerpo.ok && cuerpo.data.estado, 'caido')
    },
  )
})

test('5b · falta una variable de entorno crítica → auth "caido" y 503', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    async () => {
      const c = await comprobarSuperficial(sondasSanas())
      assert.equal(c.find((x) => x.nombre === 'auth')?.estado, 'caido')
      assert.equal(construirSalud(c).status, 503)
    },
  )
})

// ── 6 ───────────────────────────────────────────────────────────────────────
test('6 · Postgres lento (2,5 s) → timeout a los 2 s, "degradado", y responde en < 3 s', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const t0 = Date.now()
      const c = await comprobarSuperficial(
        sondasSanas({
          ping: () =>
            new Promise<void>((resolver) => {
              const t = setTimeout(resolver, 2500)
              // El temporizador no debe mantener vivo el proceso de test una vez
              // que la comprobación ya ha dejado de esperar.
              if (typeof t === 'object' && 'unref' in t) t.unref()
            }),
        }),
      )
      const transcurrido = Date.now() - t0

      const postgres = c.find((x) => x.nombre === 'postgres')
      assert.equal(postgres?.estado, 'degradado')
      assert.match(postgres?.detalle ?? '', new RegExp(`timeout_${TIMEOUT_SUPERFICIAL_MS}ms`))
      assert.ok(transcurrido < 3000, `tardó ${transcurrido} ms: la comprobación se colgó`)

      // Degradado sirve tráfico: un 503 por lentitud momentánea saca de rotación
      // instancias sanas justo cuando hay menos capacidad.
      const respuesta = construirSalud(c)
      assert.equal(respuesta.status, 200)
      assert.ok(respuesta.cuerpo.ok)
      assert.equal(respuesta.cuerpo.data.estado, 'degradado')
    },
  )
})

test('6b · conLimite propaga TiempoAgotadoError y limpia el temporizador', async () => {
  await assert.rejects(
    () => conLimite('lento', 20, () => new Promise((r) => setTimeout(r, 500).unref?.())),
    TiempoAgotadoError,
  )
})

// ── 7 ───────────────────────────────────────────────────────────────────────
test('7 · /api/metrics sin Authorization → 401 y cuerpo VACÍO de métricas', () => {
  __reiniciarMetricas()
  observarLatencia('/api/feed', 10)

  const r = construirMetricas(null, exportarPrometheus, 'token-secreto')
  assert.equal(r.status, 401)
  assert.equal(r.cuerpo, '', 'un 401 que ya filtra nombres de métrica es una fuga con estilo')
  assert.ok(!r.cuerpo.includes('darma_'))
})

test('7b · con el token correcto sí devuelve el texto Prometheus', () => {
  __reiniciarMetricas()
  observarLatencia('/api/feed', 10)
  const r = construirMetricas('Bearer token-secreto', exportarPrometheus, 'token-secreto')
  assert.equal(r.status, 200)
  assert.match(r.contentType, /version=0\.0\.4/)
  assert.match(r.cuerpo, /darma_latencia_ms_count/)
})

test('7c · sin METRICS_TOKEN configurado NADIE pasa (falla cerrado)', () => {
  assert.equal(construirMetricas('Bearer loquesea', () => 'x', undefined).status, 401)
  assert.equal(construirMetricas('Bearer ', () => 'x', '').status, 401)
})

// ── 8 ───────────────────────────────────────────────────────────────────────
// Esta prueba también ejercitaba la COMPARACIÓN del Bearer, cuando la hacía un
// `bearerValido` propio de este módulo. Ya no: la comparación es la de
// `lib/cronAuth.ts` y allí está probada. Aquí se queda lo que sí es de este
// bloque —el SOBRE del 401— y no se reproduce lo que prueba el vecino.
test('8 · el 401 de las rutas de máquina sale con el código no_autenticado', () => {
  const r = respuestaNoAutenticado()
  assert.equal(r.status, 401)
  assert.equal(r.cuerpo.ok, false)
  assert.equal(!r.cuerpo.ok && r.cuerpo.code, 'no_autenticado')
})

// ── 9 ───────────────────────────────────────────────────────────────────────
test('9 · crisis_sin_atender: 12 → violación con severidad DISTINTA a las demás', () => {
  const violaciones = evaluarPresupuestos({
    crisis_sin_atender: 12,
    feed_p95_ms: 900,
    ratio_5xx: 0.05,
  })

  const crisis = violaciones.find((v) => v.clave === 'crisis_sin_atender_max')
  assert.ok(crisis, 'no se detectó la violación de la cola de crisis')
  assert.equal(crisis.valor, 12)
  assert.equal(crisis.limite, PRESUPUESTOS.crisis_sin_atender_max)
  assert.equal(crisis.severidad, 'crisis')

  for (const otra of violaciones.filter((v) => v.clave !== 'crisis_sin_atender_max')) {
    assert.notEqual(otra.severidad, 'crisis')
  }

  assert.equal(violaciones[0].clave, 'crisis_sin_atender_max', 'la crisis va SIEMPRE primero')
  assert.equal(hayViolacionDeCrisis(violaciones), true)
  assert.equal(hayViolacionDeCrisis(evaluarPresupuestos({ feed_p95_ms: 900 })), false)
})

// ── 10 ──────────────────────────────────────────────────────────────────────
test('10 · la respuesta de /api/health no filtra NADA interno (test de grep)', () => {
  const c = [
    {
      nombre: 'postgres' as const,
      estado: 'caido' as const,
      ms: 12,
      detalle: 'ECONNREFUSED postgres://darma:password@db.abcdefgh.supabase.co:5432/postgres pg_stat',
    },
    { nombre: 'auth' as const, estado: 'ok' as const, ms: 0 },
  ]

  const serializado = JSON.stringify(construirSalud(c, 'abc123def456').cuerpo)

  for (const prohibido of ['postgres://', 'supabase.co', 'password', 'ECONNREFUSED', 'pg_']) {
    assert.ok(
      !serializado.includes(prohibido),
      `la respuesta pública contiene "${prohibido}": ${serializado}`,
    )
  }
  // Y sigue diciendo lo que tiene que decir.
  assert.match(serializado, /"estado":"caido"/)
  assert.match(serializado, /"nombre":"postgres"/)
  assert.match(serializado, /"version":"abc123def456"/)
})

test('10b · lo mismo en /api/health/deep, que además lleva violaciones', () => {
  const serializado = JSON.stringify(
    construirSaludProfunda(
      [{ nombre: 'ledger', estado: 'degradado', ms: 5, detalle: 'pg_toast supabase.co password' }],
      { crisis_sin_atender: 9 },
      'v1',
    ).cuerpo,
  )
  for (const prohibido of ['postgres://', 'supabase.co', 'password', 'ECONNREFUSED', 'pg_']) {
    assert.ok(!serializado.includes(prohibido), `filtra "${prohibido}"`)
  }
  assert.match(serializado, /"severidad":"crisis"/)
})

// ── 11 ──────────────────────────────────────────────────────────────────────
test('11 · el logger NO filtra el cuerpo de un desahogo', () => {
  configurarMuestreo(1)
  const secreto = 'hoy he pensado en dejarlo todo y no se lo he contado a nadie'
  const lineas = capturando(() => {
    crearLogger('req-9', '/api/posts').info('post_creado', {
      body: secreto,
      postId: '11111111-2222-3333-4444-555555555555',
    })
  })
  configurarMuestreo(0.01)

  assert.equal(lineas.length, 1)
  const salida = lineas[0]
  assert.ok(!salida.includes(secreto), 'el texto original aparece en el log')
  assert.ok(!salida.includes('dejarlo todo'), 'aparece un fragmento del texto original')

  const linea = JSON.parse(salida)
  assert.equal(linea.body, undefined, 'la clave body no debe sobrevivir')
  assert.match(linea.body_huella, /^h:[0-9a-f]{12}$/)
  assert.equal(linea.body_longitud, secreto.length)
  // El identificador SÍ se conserva: es lo que hace depurable el sistema.
  assert.equal(linea.postId, '11111111-2222-3333-4444-555555555555')
  assert.equal(linea.request_id, 'req-9')
  assert.equal(linea.ruta, '/api/posts')
})

test('11b · alias, email, ip y token tampoco salen, vengan en la clave que vengan', () => {
  configurarMuestreo(1)
  const lineas = capturando(() => {
    crearLogger('req-10', '/api/auth').warn('intento', {
      alias: 'LunaSilente_42',
      userEmail: 'persona@ejemplo.com',
      ip: '81.44.12.9',
      access_token: 'eyJhbGciOiJIUzI1NiJ9.secreto',
      mensaje: 'escríbeme a persona@ejemplo.com',
    })
  })
  configurarMuestreo(0.01)

  const salida = lineas[0]
  for (const prohibido of ['LunaSilente_42', 'persona@ejemplo.com', '81.44.12.9', 'eyJhbGciOiJIUzI1NiJ9']) {
    assert.ok(!salida.includes(prohibido), `el log filtra "${prohibido}"`)
  }
})

test('11c · esClaveSensible acierta por sufijo pero no por inclusión', () => {
  assert.equal(esClaveSensible('body'), true)
  assert.equal(esClaveSensible('postBody'), true)
  assert.equal(esClaveSensible('user_email'), true)
  // `post_id` contiene "post" pero NO es sensible: redactarlo dejaría el log
  // sin lo único que lo hace depurable.
  assert.equal(esClaveSensible('post_id'), false)
  assert.equal(esClaveSensible('body_longitud'), false)
})

test('11d · muestreo: 100 % de errores, 100 % de lo lento, 1 % del resto', () => {
  configurarMuestreo(0.01)
  assert.equal(decidirMuestreo('error', {}, 0.99), true)
  assert.equal(decidirMuestreo('warn', {}, 0.99), true)
  assert.equal(decidirMuestreo('info', { ms: 1500 }, 0.99), true)
  assert.equal(decidirMuestreo('info', { ms: 20 }, 0.99), false)
  assert.equal(decidirMuestreo('info', { ms: 20 }, 0.001), true)
})

test('11e · construirLinea siempre lleva ts, nivel, request_id y ruta', () => {
  const linea = construirLinea('info' as NivelLog, 'hola', 'req-x', '/api/feed')
  assert.match(linea.ts as string, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(linea.nivel, 'info')
  assert.equal(linea.request_id, 'req-x')
  assert.equal(linea.ruta, '/api/feed')
  // Sin cabecera, se genera un id: una línea sin correlación es peor que una
  // línea con un id que no cruza fronteras.
  assert.match(requestIdDe(null), /^[0-9a-f]{32}$/)
  assert.equal(requestIdDe(new Headers({ 'x-request-id': 'abc123def456' })), 'abc123def456')
})

// ── 12 ──────────────────────────────────────────────────────────────────────
test('12 · conTraza con una función que lanza: propaga Y registra el error', async () => {
  __reiniciarMetricas()
  configurarMuestreo(1)
  const lineas: string[] = []
  configurarEscritor((l) => lineas.push(l))

  let lanzado: unknown
  try {
    await conTraza(
      'sql:feed',
      async () => {
        throw new Error('ECONNREFUSED db.abcdefgh.supabase.co:5432')
      },
      crearLogger('req-2', '/api/feed'),
    )
  } catch (e) {
    lanzado = e
  } finally {
    configurarEscritor(null)
    configurarMuestreo(0.01)
  }

  assert.ok(lanzado instanceof Error, 'conTraza se tragó la excepción')

  const error = lineas.map((l) => JSON.parse(l)).find((l) => l.msg === 'traza_error')
  assert.ok(error, 'no se registró la línea de error')
  assert.equal(error.ok, false)
  assert.equal(error.error, 'Error', 'solo el NOMBRE del error, nunca su mensaje')
  assert.ok(!lineas.join('').includes('supabase.co'), 'el log filtra el host de la base')

  // El camino de fallo también se mide: un timeout de 2 s tiene que aparecer en
  // el histograma, no desaparecer de él.
  assert.match(exportarPrometheus(), /darma_latencia_ms_count\{ruta="sql:feed"\} 1/)
  // El código se normaliza a `[a-z0-9_]` al entrar en la métrica: los dos
  // puntos de `sql:feed` no son válidos en un valor de etiqueta sin escapar.
  assert.match(exportarPrometheus(), /darma_errores_total\{codigo="traza_sql_feed"\} 1/)
})

// ── Dependencias profundas: degradación por cola de crisis y por ledger ─────
test('13 · cola de crisis por encima del presupuesto → degradado (y presupuesto violado)', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      __reiniciarMetricas()
      const c = await comprobarProfundo(
        sondasSanas({ crisisSinAtender: async () => 12, descuadreLedger: async () => 3 }),
      )
      assert.equal(c.find((x) => x.nombre === 'cola_crisis')?.estado, 'degradado')
      assert.equal(c.find((x) => x.nombre === 'ledger')?.estado, 'degradado')

      const violaciones = evaluarPresupuestos(instantanea())
      assert.equal(violaciones[0]?.clave, 'crisis_sin_atender_max')
      assert.equal(violaciones[0]?.severidad, 'crisis')
    },
  )
})

test('13b · el sondeo del ledger falla RUIDOSAMENTE si no puede auditar', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const c = await comprobarProfundo(
        sondasSanas({
          descuadreLedger: async () => {
            throw new Error('RpcAuditarCristalesAusente')
          },
        }),
      )
      // Devolver 0 sería reportar "la economía cuadra" sin haberla mirado.
      assert.equal(c.find((x) => x.nombre === 'ledger')?.estado, 'caido')
    },
  )
})

test('13c · el clasificador apagado se ve como degradación, no como normalidad', async () => {
  await conEntorno(
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const c = await comprobarProfundo(
        sondasSanas({
          clasificadorIa: async () => ({ estado: 'degradado', detalle: 'sin_clave' }),
        }),
      )
      assert.equal(c.find((x) => x.nombre === 'ia')?.estado, 'degradado')
      assert.equal(estadoGlobal(c), 'degradado')
    },
  )
})
