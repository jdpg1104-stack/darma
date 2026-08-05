import test from 'node:test'
import assert from 'node:assert/strict'

import { ejecutarIngesta, type DependenciasIngesta } from './ejecutar.ts'
import { CLAVE_CURSOR_REVERIFICACION, type AlmacenIngesta, type ItemAprobado } from './almacen.ts'
import { crearContadorCuota, PRESUPUESTO_POR_CORRIDA, TOPE_DIARIO_PERSISTENTE } from './cuota.ts'
import type { CandidatoContenido, EstadoContenido, FuenteIngesta, SemillaFuente } from './tipos.ts'

// ============================================================================
// Doble en memoria del almacén. Los diez casos de la ficha son propiedades del
// ORDEN de las operaciones (idempotencia, reanudación, backoff), no de Postgres:
// se prueban mejor aquí que contra una base de datos que además no está
// levantada en este árbol.
// ============================================================================

interface FilaFuenteFalsa {
  fuente: FuenteIngesta
  enabled: boolean
  cooldownUntil: number | null
  motivo: string | null
  lastRunAt: number
}

class AlmacenFalso implements AlmacenIngesta {
  fuentes = new Map<string, FilaFuenteFalsa>()
  contenido = new Map<string, { item: CandidatoContenido; state: EstadoContenido }>()
  log = new Map<string, { decision: string; reason: string | null }>()
  estado = new Map<string, string | null>()
  aprobados: ItemAprobado[] = []
  cupoModelo = true
  purgadas = 0
  reloj = () => Date.now()

  agregarFuente(f: FuenteIngesta): void {
    this.fuentes.set(f.key, { fuente: { ...f }, enabled: true, cooldownUntil: null, motivo: null, lastRunAt: 0 })
  }

  async fuentesPendientes(kinds: readonly string[], limite: number): Promise<FuenteIngesta[]> {
    const ahora = this.reloj()
    return [...this.fuentes.values()]
      .filter((f) => f.enabled && kinds.includes(f.fuente.kind))
      .filter((f) => f.cooldownUntil == null || f.cooldownUntil <= ahora)
      .sort((a, b) => a.lastRunAt - b.lastRunAt)
      .slice(0, limite)
      .map((f) => ({ ...f.fuente }))
  }

  async registrarExitoFuente(key: string, cursor: string | null): Promise<void> {
    const f = this.fuentes.get(key)
    if (!f) return
    f.lastRunAt = this.reloj()
    f.fuente.fallosConsecutivos = 0
    f.cooldownUntil = null
    if (cursor != null) f.fuente.cursor = cursor
  }

  async registrarFalloFuente(key: string, cooldownHasta: Date, motivo: string): Promise<void> {
    const f = this.fuentes.get(key)
    if (!f) return
    f.lastRunAt = this.reloj()
    f.fuente.fallosConsecutivos += 1
    f.cooldownUntil = cooldownHasta.getTime()
    f.motivo = motivo
  }

  async deshabilitarFuente(key: string, motivo: string): Promise<void> {
    const f = this.fuentes.get(key)
    if (!f) return
    f.enabled = false
    f.motivo = motivo
  }

  async yaVisto(platform: string, externalId: string): Promise<boolean> {
    return this.log.has(`${platform}:${externalId}`)
  }

  async registrarDecision(e: {
    platform: string
    externalId: string
    decision: string
    reason: string | null
  }): Promise<void> {
    const clave = `${e.platform}:${e.externalId}`
    // Espejo de `uq_ingest_log_seen`: la primera decisión manda.
    if (!this.log.has(clave)) this.log.set(clave, { decision: e.decision, reason: e.reason })
  }

  async insertarContenido(c: CandidatoContenido, state: EstadoContenido): Promise<boolean> {
    const clave = `${c.platform}:${c.externalId}`
    // Espejo de `on conflict (platform, external_id) do nothing`.
    if (this.contenido.has(clave)) return false
    this.contenido.set(clave, { item: c, state })
    return true
  }

  async aprobadosDesde(cursor: string | null, limite: number): Promise<ItemAprobado[]> {
    return this.aprobados.filter((i) => (cursor ? i.id > cursor : true)).slice(0, limite)
  }

  async marcarRechazado(id: string): Promise<void> {
    for (const [clave, fila] of this.contenido) {
      if (fila.item.externalId === id || clave.endsWith(`:${id}`)) fila.state = 'rejected'
    }
    const i = this.aprobados.find((a) => a.id === id)
    if (i) this.estado.set(`rechazado:${id}`, 'si')
  }

  async leerEstado(key: string): Promise<string | null> {
    return this.estado.get(key) ?? null
  }

  async escribirEstado(key: string, value: string | null): Promise<void> {
    this.estado.set(key, value)
  }

  async consumirCupoModelo(): Promise<boolean> {
    return this.cupoModelo
  }

  // ── Cupo diario persistente (0214): se apunta cada llamada para afirmar ──
  cuotaReservas: Array<{ unidades: number; tope: number }> = []
  cuotaDevueltas: number[] = []
  /** `null` = conceder lo pedido; un número = lo que el «Postgres» del test concede. */
  cuotaConcedida: number | null = null

  async reservarCuotaYoutube(unidades: number, tope: number): Promise<number> {
    this.cuotaReservas.push({ unidades, tope })
    return this.cuotaConcedida ?? unidades
  }

  async devolverCuotaYoutube(unidades: number): Promise<void> {
    this.cuotaDevueltas.push(unidades)
  }

  async purgarLog(): Promise<number> {
    this.purgadas++
    return 0
  }

  // ── Backfill de duración ──
  sinDuracion: Array<{ id: string; externalId: string }> = []
  duraciones = new Map<string, number>()

  async videosSinDuracion(cursor: string | null, limite: number): Promise<Array<{ id: string; externalId: string }>> {
    return this.sinDuracion.filter((v) => (cursor ? v.id > cursor : true)).slice(0, limite)
  }

  async guardarDuracion(id: string, segundos: number): Promise<void> {
    this.duraciones.set(id, segundos)
  }

  async sembrarFuentes(semilla: readonly SemillaFuente[]): Promise<number> {
    return semilla.length
  }

  async pendientesDeCuracion(): Promise<Array<{ id: string; title: string; url: string; createdAt: string }>> {
    return [...this.contenido.values()]
      .filter((f) => f.state === 'pending')
      .map((f) => ({ id: f.item.externalId, title: f.item.title, url: f.item.url, createdAt: '' }))
  }
}

// ── Dobles de red ───────────────────────────────────────────────────────────

function feedYoutube(entradas: Array<{ id: string; titulo: string; publicado?: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>Canal de prueba</title>
${entradas
  .map(
    (e) => `<entry>
  <id>yt:video:${e.id}</id>
  <yt:videoId>${e.id}</yt:videoId>
  <title>${e.titulo}</title>
  ${e.publicado ? `<published>${e.publicado}</published>` : ''}
  <media:group>
    <media:description>Resumen del vídeo.</media:description>
    <media:thumbnail url="https://i.ytimg.com/vi/${e.id}/hqdefault.jpg"/>
  </media:group>
</entry>`,
  )
  .join('\n')}
</feed>`
}

function fetchFijo(cuerpo: string, status = 200, contador?: { n: number }): typeof fetch {
  return (async () => {
    if (contador) contador.n++
    return { status, ok: status >= 200 && status < 300, text: async () => cuerpo } as unknown as Response
  }) as unknown as typeof fetch
}

/**
 * Como `fetchFijo`, pero con `json()`. `resolverIdiomaAudio` consume JSON y el
 * helper original solo expone `text()`; se añade aparte en vez de ampliarlo
 * porque otras veinte pruebas dependen de su forma exacta.
 */
function fetchJson(cuerpo: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => cuerpo,
      text: async () => JSON.stringify(cuerpo),
    }) as unknown as Response) as unknown as typeof fetch
}

function fuenteYoutube(cursor: string | null = null): FuenteIngesta {
  return { key: 'yt:test', kind: 'youtube_channel', handle: 'UC0', language: 'es', topic: null, cursor, fallosConsecutivos: 0 }
}

/** Fuente de playlist con un id VÁLIDO: es lo que exige la vía de la Data API. */
function fuentePlaylist(): FuenteIngesta {
  return {
    key: 'yt:playlist',
    kind: 'youtube_playlist',
    handle: 'PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c',
    language: 'es',
    topic: null,
    cursor: null,
    fallosConsecutivos: 0,
  }
}

/** Dependencias por defecto: modelo permisivo, embed OK, cero red real. */
function deps(almacen: AlmacenFalso, fetchFeed: typeof fetch, extra: Partial<DependenciasIngesta> = {}): DependenciasIngesta {
  return {
    almacen,
    fetchImpl: fetchFeed,
    cribado: { apiKey: 'clave-de-prueba', proveedor: async () => ({ seguro: true, confianza: 0.99 }) },
    sonda: { fetchImpl: fetchFijo('', 200), esperarImpl: async () => {} },
    // Claves VACÍAS a propósito: fijan el camino «sin Data API» (feed Atom)
    // aunque el entorno de quien ejecuta los tests tenga YOUTUBE_API_KEY.
    // Los tests del descubrimiento las sobreescriben con una clave falsa.
    descubrir: { claveApi: '' },
    metadatos: { apiKey: '' },
    ...extra,
  }
}

/** Cuerpo de `playlistItems.list` con vídeos y su DUEÑO (`videoOwnerChannelId`). */
function apiPlaylist(videos: Array<{ id: string; titulo?: string; publicado?: string; dueno?: string }>): unknown {
  return {
    items: videos.map((v) => ({
      snippet: {
        title: v.titulo ?? `Vídeo ${v.id}`,
        description: 'Descripción',
        publishedAt: v.publicado ?? '2026-01-02T00:00:00Z',
        // Dueño de la LISTA, que en una playlist curada NO es el del vídeo.
        channelId: 'UCdeLaListaCuradaXXXXXXX',
        videoOwnerChannelId: v.dueno ?? 'UC07-dOwgza1IguKA86jqxNA',
        resourceId: { kind: 'youtube#video', videoId: v.id },
        thumbnails: { high: { url: `https://i.ytimg.com/vi/${v.id}/hq.jpg` } },
      },
    })),
  }
}

/** Espía de red que devuelve JSON y apunta las URLs llamadas. */
function espiaJson(cuerpo: unknown): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(String(url))
    return { status: 200, ok: true, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

/** Reloj del descubrimiento: dentro de la ventana de los ítems de `apiPlaylist`. */
const AHORA_DESCUBRIMIENTO = (): Date => new Date('2026-01-03T00:00:00.000Z')

// ── Prueba exigida nº 5 · idempotencia ──────────────────────────────────────

test('IDEMPOTENCIA: dos ejecuciones sobre la misma respuesta insertan una vez', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  // Sin fecha de publicación a propósito: así el cursor no filtra nada y lo que
  // impide el duplicado es la restricción única, que es justo lo que se prueba.
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada para la ansiedad' }])

  const primera = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(primera.insertados, 1)
  assert.equal(almacen.contenido.size, 1)

  const segunda = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(segunda.insertados, 0)
  assert.equal(segunda.duplicados, 1)
  assert.equal(almacen.contenido.size, 1, 'content_items no debe crecer')
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'inserted')
})

test('IDEMPOTENCIA: un candidato ya registrado no vuelve a pagar el modelo', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada' }])

  let llamadasModelo = 0
  const d = deps(almacen, fetchFijo(xml), {
    cribado: {
      apiKey: 'k',
      proveedor: async () => {
        llamadasModelo++
        return { seguro: true, confianza: 0.99 }
      },
    },
  })

  await ejecutarIngesta({ tipo: 'videos', deps: d })
  assert.equal(llamadasModelo, 1)
  await ejecutarIngesta({ tipo: 'videos', deps: d })
  assert.equal(llamadasModelo, 1, 're-analizar lo ya decidido es pagar dos veces por nada')
})

// ── Prueba exigida nº 6 · reanudación ───────────────────────────────────────

test('REANUDACIÓN: con presupuestoMs = 1 sale incompleta, guarda cursor y continúa sin repetir', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([
    { id: 'vid00000001', titulo: 'Uno: respiración', publicado: '2026-01-01T00:00:00Z' },
    { id: 'vid00000002', titulo: 'Dos: sueño', publicado: '2026-01-02T00:00:00Z' },
    { id: 'vid00000003', titulo: 'Tres: duelo', publicado: '2026-01-03T00:00:00Z' },
  ])

  // Reloj artificial: cada consulta avanza 10 ms, así que el presupuesto de 1 ms
  // se agota justo después del primer ítem.
  const relojIncremental = (): (() => number) => {
    let t = 0
    return () => (t += 10)
  }

  const primera = await ejecutarIngesta({
    tipo: 'videos',
    presupuestoMs: 1,
    deps: deps(almacen, fetchFijo(xml), { ahora: relojIncremental() }),
  })
  assert.equal(primera.completado, false, 'debe declararse incompleta')
  assert.equal(primera.insertados, 1)
  // El más antiguo primero: el cursor es monótono creciente.
  assert.equal(almacen.fuentes.get('yt:test')?.fuente.cursor, '2026-01-01T00:00:00.000Z')

  const segunda = await ejecutarIngesta({
    tipo: 'videos',
    presupuestoMs: 1,
    deps: deps(almacen, fetchFijo(xml), { ahora: relojIncremental() }),
  })
  assert.equal(segunda.insertados, 1)
  assert.equal(segunda.duplicados, 0, 'el cursor debe evitar volver a mirar v1')
  assert.equal(almacen.contenido.size, 2)
  assert.ok(almacen.contenido.has('youtube:vid00000002'))
  assert.equal(almacen.fuentes.get('yt:test')?.fuente.cursor, '2026-01-02T00:00:00.000Z')
})

test('con presupuesto de sobra, una fuente pequeña se completa de una pasada', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([
    { id: 'vid00000001', titulo: 'Uno', publicado: '2026-01-01T00:00:00Z' },
    { id: 'vid00000002', titulo: 'Dos', publicado: '2026-01-02T00:00:00Z' },
  ])
  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(r.completado, true)
  assert.equal(r.insertados, 2)
})

// ── Prueba exigida nº 9 · backoff y deshabilitado ───────────────────────────

test('CAMINO DE FALLO: tres 429 seguidos dejan cooldown en el futuro y la fuente deja de llamarse', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const contador = { n: 0 }
  const f429 = fetchFijo('', 429, contador)

  // Reloj del almacén con desfase: entre ejecución y ejecución «pasa» una hora,
  // que es lo que deja vencer el cooldown de los primeros reintentos. Sin este
  // avance, el propio backoff impediría llegar al tercer fallo — que es
  // exactamente la propiedad que se quiere demostrar.
  let desfase = 0
  almacen.reloj = () => Date.now() + desfase

  for (let i = 0; i < 3; i++) {
    const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, f429) })
    assert.equal(r.errores, 1, `la ejecución ${i + 1} debería haber llamado a la fuente y fallado`)
    desfase += 60 * 60 * 1000
  }
  assert.equal(contador.n, 3)
  // Se vuelve al presente: el cooldown del tercer fallo sigue en el futuro.
  desfase = 0

  const fila = almacen.fuentes.get('yt:test')
  assert.equal(fila?.enabled, true, 'un 429 NO deshabilita: significa «ahora no», no «nunca»')
  assert.equal(fila?.fuente.fallosConsecutivos, 3)
  assert.ok((fila?.cooldownUntil ?? 0) > Date.now(), 'el cooldown debe quedar en el futuro')

  // Cuarta ejecución: la fuente está en cooldown y NO se vuelve a llamar.
  const cuarta = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, f429) })
  assert.equal(cuarta.fuentesVistas, 0)
  assert.equal(contador.n, 3, 'no debería haber una cuarta petición')
})

test('CAMINO DE FALLO: un 404 deshabilita la fuente y deja el motivo escrito', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())

  await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo('', 404)) })

  const fila = almacen.fuentes.get('yt:test')
  assert.equal(fila?.enabled, false, 'un feed que devuelve 404 no va a mejorar solo')
  assert.equal(fila?.motivo, 'http_404')

  const siguiente = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo('', 404)) })
  assert.equal(siguiente.fuentesVistas, 0)
})

test('una fuente rota no impide que las demás se ingieran', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente({ ...fuenteYoutube(), key: 'yt:rota', handle: 'ROTA' })
  almacen.agregarFuente({ ...fuenteYoutube(), key: 'yt:buena', handle: 'BUENA' })

  const xml = feedYoutube([{ id: 'vid00000009', titulo: 'Respiración guiada' }])
  const fetchSelectivo = (async (url: string) => {
    if (String(url).includes('ROTA')) return { status: 500, text: async () => '' } as unknown as Response
    return { status: 200, text: async () => xml } as unknown as Response
  }) as unknown as typeof fetch

  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchSelectivo) })
  assert.equal(r.errores, 1)
  assert.equal(r.insertados, 1)
})

// ── Estados del pipeline ────────────────────────────────────────────────────

test('«approved» exige cribado seguro Y embed embebible', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada para la ansiedad' }])

  await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'approved')
})

test('embed «desconocido» deja el ítem PENDING, no rejected', async () => {
  // Trampa nº 2: confundir «no sé» con «no» archivaría contenido bueno en silencio.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), { sonda: { fetchImpl: fetchFijo('', 503), esperarImpl: async () => {} } }),
  })
  assert.equal(r.pendientes, 1)
  assert.equal(r.rechazados.embed, 0)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'pending')
})

test('embed 401 rechaza el ítem por embed, no por seguridad', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), { sonda: { fetchImpl: fetchFijo('', 401), esperarImpl: async () => {} } }),
  })
  assert.equal(r.rechazados.embed, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'rejected')
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'rejected_embed')
})

test('el filtro de seguridad rechaza y lo deja registrado como rejected_safety', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Cura tu depresion en 7 dias sin medicacion' }])

  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(r.rechazados.seguridad, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'rejected')
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'rejected_safety')
})

test('SIN clave de moderación no se aprueba NADA: todo va a la cola humana', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada para la ansiedad' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), { cribado: { apiKey: null } }),
  })
  assert.equal(r.insertados, 0)
  assert.equal(r.pendientes, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'pending')
})

test('el default nunca es approved: un feed vacío no publica nada', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo('<feed></feed>')) })
  assert.equal(almacen.contenido.size, 0)
  assert.equal(r.insertados, 0)
})

test('el tope de ítems por ejecución se respeta', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube(
    Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, titulo: `Vídeo ${i} de respiración` })),
  )
  const r = await ejecutarIngesta({ tipo: 'videos', maxItems: 3, deps: deps(almacen, fetchFijo(xml)) })
  assert.equal(almacen.contenido.size, 3)
  assert.equal(r.completado, false)
})

// ── Prueba exigida nº 10 · reverificación ───────────────────────────────────

test('REVERIFICACIÓN: un approved cuyo oEmbed pasa a 401 queda rejected', async () => {
  const almacen = new AlmacenFalso()
  almacen.aprobados = [{ id: 'uuid-1', platform: 'youtube', externalId: 'vid00000001' }]
  almacen.contenido.set('youtube:vid00000001', {
    item: { externalId: 'uuid-1' } as CandidatoContenido,
    state: 'approved',
  })

  const r = await ejecutarIngesta({
    tipo: 'reverificar',
    deps: { almacen, sonda: { fetchImpl: fetchFijo('', 401), esperarImpl: async () => {} } },
  })
  assert.equal(r.rechazados.embed, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'rejected')
  assert.equal(almacen.estado.get(CLAVE_CURSOR_REVERIFICACION) ?? null, null, 'página incompleta: el cursor se reinicia')
})

test('REVERIFICACIÓN: un timeout NO retira nada — el ítem sigue approved', async () => {
  // Si «desconocido» retirase contenido, cada hipo de red vaciaría un poco más
  // el feed y la degradación sería invisible.
  const almacen = new AlmacenFalso()
  almacen.aprobados = [{ id: 'uuid-1', platform: 'youtube', externalId: 'vid00000001' }]
  almacen.contenido.set('youtube:vid00000001', {
    item: { externalId: 'uuid-1' } as CandidatoContenido,
    state: 'approved',
  })

  const queLanza = (async () => {
    throw new Error('timeout')
  }) as unknown as typeof fetch

  const r = await ejecutarIngesta({
    tipo: 'reverificar',
    deps: { almacen, sonda: { fetchImpl: queLanza, esperarImpl: async () => {} } },
  })
  assert.equal(r.rechazados.embed, 0)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'approved')
})

test('REVERIFICACIÓN: purga el log en el mismo paso', async () => {
  const almacen = new AlmacenFalso()
  await ejecutarIngesta({ tipo: 'reverificar', deps: { almacen } })
  assert.equal(almacen.purgadas, 1)
})

// ── Cableado de las guardas de B21 ──────────────────────────────────────────
//
// Lo que se protege aquí NO es que las guardas funcionen —eso lo prueban
// canalesPermitidos.test.ts e idiomaAudio.test.ts— sino la POLÍTICA del
// orquestador: qué estado recibe cada veredicto. Es donde un descuido convierte
// «no lo sé» en «rechazado» y archiva contenido bueno en silencio.

const RESOLUTOR_OMS = async (): Promise<string> => 'UC07-dOwgza1IguKA86jqxNA'

test('🔴 «no está configurado» NO apaga el pipeline', async () => {
  // Sin YOUTUBE_API_KEY no hay resolutor ni consulta de idioma. Si eso mandara
  // todo a la cola humana, añadir las guardas habría dejado la ingesta sin
  // aprobar nada — a cambio de cero seguridad, porque ingest_sources ya es una
  // lista curada a mano. Es el caso REAL de Darma hoy.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respirar hondo', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })

  assert.equal(r.insertados, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'approved')
})

test('🔴 un vídeo de un canal AJENO se rechaza como rejected_channel', async () => {
  // El caso que de verdad importa: las playlists curadas (yt:ops_mirar_al_futuro,
  // yt:who_social_connection) PUEDEN llevar material de terceros. Sin esta guarda
  // entraría en el feed como si fuera de la OMS.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'De otro canal', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), { canal: { resolutor: async () => 'UCAjenoAjenoAjenoAjeno12' } }),
  })

  assert.equal(r.rechazados.canal, 1)
  assert.equal(r.insertados, 0)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'rejected')
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'rejected_channel')
})

test('🔴 un resolutor CAÍDO deja el ítem pending, nunca rechazado', async () => {
  // La diferencia con la prueba de arriba es la única que importa: allí se
  // preguntó y la respuesta fue «no»; aquí no hubo respuesta. Confundirlas
  // archivaría contenido bueno cada vez que la red hipa.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Red caída', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      canal: { resolutor: async () => { throw new Error('ECONNRESET') } },
    }),
  })

  assert.equal(r.pendientes, 1)
  assert.equal(r.rechazados.canal, 0)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'pending')
})

test('🔴 audio declarado en inglés → rejected_language, no rejected_quality', async () => {
  // El incidente real de DataLaps: título traducido, audio en inglés. Registrarlo
  // como rejected_quality mentiría sobre la causa, que es justo lo que se
  // consultará cuando alguien pregunte por qué no entra nada de una fuente.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: "Benny's Story", publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      canal: { resolutor: RESOLUTOR_OMS },
      idioma: {
        apiKey: 'clave-de-prueba',
        fetchImpl: fetchJson({ items: [{ snippet: { defaultAudioLanguage: 'en-US' } }] }),
      },
    }),
  })

  assert.equal(r.rechazados.idioma, 1)
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'rejected_language')
})

test('audio declarado en español pasa las dos guardas y llega a approved', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Mirar al Futuro', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      canal: { resolutor: RESOLUTOR_OMS },
      idioma: {
        apiKey: 'clave-de-prueba',
        fetchImpl: fetchJson({ items: [{ snippet: { defaultAudioLanguage: 'es-419' } }] }),
      },
    }),
  })

  assert.equal(r.insertados, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'approved')
})

test('las guardas corren ANTES del modelo: un canal ajeno no paga cribado', async () => {
  // Si el orden se invirtiera, cada vídeo descartable gastaría una llamada al
  // modelo — y el cupo diario es el recurso más caro del pipeline.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Ajeno', publicado: '2026-01-02T00:00:00Z' }])
  let llamadasAlModelo = 0

  await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      canal: { resolutor: async () => 'UCAjenoAjenoAjenoAjeno12' },
      cribado: {
        apiKey: 'clave-de-prueba',
        proveedor: async () => {
          llamadasAlModelo++
          return { seguro: true, confianza: 0.99 }
        },
      },
    }),
  })

  assert.equal(llamadasAlModelo, 0, 'no se debe pagar al modelo por algo ya descartado')
})

// ── Cableado del descubrimiento por la Data API (B21 §1) ────────────────────
//
// Lo que se protege aquí es la POLÍTICA del orquestador, no el módulo
// `descubrir.ts` (ese tiene sus propias pruebas): con clave la API manda y el
// feed no se toca; sin clave o sin cuota, el feed Atom sigue vivo — la API es
// una mejora, no una dependencia.

test('B21 · una fuente youtube se lee por playlistItems.list y el feed Atom NO se descarga', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuentePlaylist())
  const feed = { n: 0 }
  const api = espiaJson(apiPlaylist([{ id: 'vid00000001', titulo: 'Respirar hondo' }]))
  const cuota = crearContadorCuota()

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo('<feed></feed>', 200, feed), {
      cuota,
      descubrir: { claveApi: 'clave-de-prueba', fetchImpl: api.fetchImpl, ahora: AHORA_DESCUBRIMIENTO },
    }),
  })

  assert.equal(r.insertados, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'approved')
  assert.equal(feed.n, 0, 'con la API disponible, el feed Atom no se descarga')
  assert.ok(api.urls[0]?.includes('/youtube/v3/playlistItems?'), 'la vía es playlistItems.list')
  assert.ok(!api.urls.some((u) => u.includes('/youtube/v3/search')), 'search.list cuesta 100× y aquí no pinta nada')
  assert.equal(cuota.gastadas(), 1, 'una playlist = UNA unidad')
})

test('B21 · el videoOwnerChannelId sobrevive a normalizar() y alimenta la allowlist', async () => {
  // El pedido de PEDIDOS.md: sin `channelId` en los tipos, la allowlist perdía
  // el dato que el descubrimiento ya había pagado. Aquí un vídeo de TERCEROS
  // dentro de una playlist curada se rechaza SIN gastar ni un videos.list.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuentePlaylist())
  const api = espiaJson(apiPlaylist([{ id: 'vid00000001', dueno: 'UCAjenoAjenoAjenoAjeno12' }]))
  const cuota = crearContadorCuota()

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo('<feed></feed>'), {
      cuota,
      descubrir: { claveApi: 'clave-de-prueba', fetchImpl: api.fetchImpl, ahora: AHORA_DESCUBRIMIENTO },
    }),
  })

  assert.equal(r.rechazados.canal, 1)
  assert.equal(almacen.log.get('youtube:vid00000001')?.decision, 'rejected_channel')
  assert.equal(cuota.gastadas(), 1, 'solo la unidad de la playlist: la identidad ya venía del descubrimiento')
})

test('B21 · con la cuota cortada, el descubrimiento cae al feed Atom y el feed NO se apaga', async () => {
  // La propiedad que más importa del cableado: agotar la cuota no puede
  // silenciar /animo al día siguiente. El feed Atom no necesita cuota.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuentePlaylist())
  const api = espiaJson(apiPlaylist([{ id: 'vid00000009' }]))
  const cuota = crearContadorCuota({ presupuesto: 0 })
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respiración guiada', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      cuota,
      descubrir: { claveApi: 'clave-de-prueba', fetchImpl: api.fetchImpl, ahora: AHORA_DESCUBRIMIENTO },
    }),
  })

  assert.equal(api.urls.length, 0, 'el corte llega ANTES de la llamada, no después')
  assert.equal(r.insertados, 1, 'el feed Atom siguió trayendo contenido')
  assert.ok(cuota.resumen().cortes.presupuesto_agotado >= 1, 'el corte queda contado: es la alarma temprana')
})

test('B21 · la duración de videos.list llega al ítem: el +1 deja de valer ~54 s para todo', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Mirar al Futuro', publicado: '2026-01-02T00:00:00Z' }])
  const cuota = crearContadorCuota()

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      cuota,
      metadatos: {
        apiKey: 'clave-de-prueba',
        fetchImpl: fetchJson({
          items: [
            {
              snippet: { channelId: 'UC07-dOwgza1IguKA86jqxNA', defaultAudioLanguage: 'es-419' },
              contentDetails: { duration: 'PT12M30S' },
            },
          ],
        }),
      },
    }),
  })

  assert.equal(r.insertados, 1)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.item.durationSeconds, 750)
  assert.equal(cuota.gastadas(), 1, 'canal + idioma + duración: UNA sola unidad')
})

test('B21 · orden embed → canal → idioma: un vídeo no incrustable no gasta ni una unidad', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Bloqueado', publicado: '2026-01-02T00:00:00Z' }])
  const metadatos = espiaJson({ items: [] })
  const cuota = crearContadorCuota()

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      cuota,
      sonda: { fetchImpl: fetchFijo('', 401), esperarImpl: async () => {} },
      metadatos: { apiKey: 'clave-de-prueba', fetchImpl: metadatos.fetchImpl },
    }),
  })

  assert.equal(r.rechazados.embed, 1)
  assert.equal(metadatos.urls.length, 0, 'videos.list no se llama para un vídeo ya muerto')
  assert.equal(cuota.gastadas(), 0)
})

// ── El cupo diario PERSISTENTE (migración 0214) ─────────────────────────────

test('B21 · la corrida reserva del cupo diario y devuelve el sobrante al terminar', async () => {
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Mirar al Futuro', publicado: '2026-01-02T00:00:00Z' }])

  await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      metadatos: {
        apiKey: 'clave-de-prueba',
        fetchImpl: fetchJson({
          items: [{ snippet: { channelId: 'UC07-dOwgza1IguKA86jqxNA', defaultAudioLanguage: 'es' } }],
        }),
      },
    }),
  })

  assert.deepEqual(almacen.cuotaReservas, [{ unidades: PRESUPUESTO_POR_CORRIDA, tope: TOPE_DIARIO_PERSISTENTE }])
  // Se gastó 1 unidad (el videos.list compartido): vuelve todo lo demás.
  assert.deepEqual(almacen.cuotaDevueltas, [PRESUPUESTO_POR_CORRIDA - 1])
})

test('B21 · sin clave de API no se reserva cupo diario: cero round-trips a Postgres', async () => {
  // El caso REAL de hoy en producción. Reservar presupuesto que nadie puede
  // gastar solo añadiría latencia y ruido al contador.
  const almacen = new AlmacenFalso()
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respirar hondo', publicado: '2026-01-02T00:00:00Z' }])

  const r = await ejecutarIngesta({ tipo: 'videos', deps: deps(almacen, fetchFijo(xml)) })

  assert.equal(r.insertados, 1, 'el pipeline sigue aprobando, como antes de la Data API')
  assert.equal(almacen.cuotaReservas.length, 0)
  assert.equal(almacen.cuotaDevueltas.length, 0)
})

test('B21 · si el cupo diario concede 0, nada gasta y el ítem cae a la cola humana, no a rechazo', async () => {
  // Fail-closed de verdad: con clave configurada pero el día agotado, «no pude
  // comprobar el idioma» es pending — jamás una aprobación ni un rechazo.
  const almacen = new AlmacenFalso()
  almacen.cuotaConcedida = 0
  almacen.agregarFuente(fuenteYoutube())
  const xml = feedYoutube([{ id: 'vid00000001', titulo: 'Respirar hondo', publicado: '2026-01-02T00:00:00Z' }])
  const metadatos = espiaJson({ items: [] })

  const r = await ejecutarIngesta({
    tipo: 'videos',
    deps: deps(almacen, fetchFijo(xml), {
      metadatos: { apiKey: 'clave-de-prueba', fetchImpl: metadatos.fetchImpl },
    }),
  })

  assert.equal(almacen.cuotaReservas.length, 1, 'lo intentó y Postgres dijo que no quedaba')
  assert.equal(metadatos.urls.length, 0, 'sin presupuesto no sale ni una llamada')
  assert.equal(r.pendientes, 1)
  assert.equal(r.rechazados.idioma, 0)
  assert.equal(almacen.contenido.get('youtube:vid00000001')?.state, 'pending')
  assert.equal(almacen.cuotaDevueltas.length, 0, 'con 0 concedidas no hay nada que devolver')
})
