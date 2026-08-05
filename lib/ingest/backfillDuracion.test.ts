import test from 'node:test'
import assert from 'node:assert/strict'

import { backfillDuracion, type AlmacenBackfill } from './backfillDuracion.ts'
import { crearContadorCuota, PRESUPUESTO_POR_CORRIDA, TOPE_DIARIO_PERSISTENTE } from './cuota.ts'

// ── Doble del almacén, acotado al puerto del backfill ───────────────────────

class AlmacenBackfillFalso implements AlmacenBackfill {
  filas: Array<{ id: string; externalId: string; duracion: number | null }> = []
  reservas: Array<{ unidades: number; tope: number }> = []
  devueltas: number[] = []
  concedidas: number | null = null

  async videosSinDuracion(cursor: string | null, limite: number): Promise<Array<{ id: string; externalId: string }>> {
    return this.filas
      .filter((f) => f.duracion === null)
      .filter((f) => (cursor ? f.id > cursor : true))
      .slice(0, limite)
      .map((f) => ({ id: f.id, externalId: f.externalId }))
  }

  async guardarDuracion(id: string, segundos: number): Promise<void> {
    const fila = this.filas.find((f) => f.id === id)
    // Espejo del `.is('duration_seconds', null)` del almacén real.
    if (fila && fila.duracion === null) fila.duracion = segundos
  }

  async reservarCuotaYoutube(unidades: number, tope: number): Promise<number> {
    this.reservas.push({ unidades, tope })
    return this.concedidas ?? unidades
  }

  async devolverCuotaYoutube(unidades: number): Promise<void> {
    this.devueltas.push(unidades)
  }
}

/** `videos.list` falso: cada id resuelve a la duración ISO indicada (o a nada). */
function fetchVideos(duraciones: Record<string, string | null>): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(String(url))
    const id = /[?&]id=([^&]+)/.exec(String(url))?.[1] ?? ''
    const iso = duraciones[id]
    return {
      status: 200,
      ok: true,
      json: async () =>
        iso === undefined
          ? { items: [] }
          : { items: [{ snippet: { channelId: 'UC07-dOwgza1IguKA86jqxNA' }, contentDetails: iso === null ? {} : { duration: iso } }] },
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

const CLAVE = 'CLAVE-DE-PRUEBA-NO-REAL'

// ── Lo que promete la cabecera ──────────────────────────────────────────────

test('rellena SOLO las filas sin duración y deja el resto intacto', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [
    { id: 'a', externalId: 'vid00000001', duracion: null },
    { id: 'b', externalId: 'vid00000002', duracion: 999 },
    { id: 'c', externalId: 'vid00000003', duracion: null },
  ]
  const red = fetchVideos({ vid00000001: 'PT1M30S', vid00000003: 'PT2M' })

  const r = await backfillDuracion({
    almacen,
    metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl },
    cuota: crearContadorCuota(),
  })

  assert.equal(r.sinClave, false)
  assert.equal(r.escritos, 2)
  assert.equal(almacen.filas.find((f) => f.id === 'a')?.duracion, 90)
  assert.equal(almacen.filas.find((f) => f.id === 'b')?.duracion, 999, 'una duración ya escrita no se toca')
  assert.equal(almacen.filas.find((f) => f.id === 'c')?.duracion, 120)
  assert.equal(red.urls.length, 2, 'una unidad por vídeo pendiente, ni una más')
})

test('IDEMPOTENCIA: la segunda ejecución no reescribe ni vuelve a pagar', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [{ id: 'a', externalId: 'vid00000001', duracion: null }]
  const red = fetchVideos({ vid00000001: 'PT1M' })
  const opciones = () => ({
    almacen,
    metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl },
    cuota: crearContadorCuota(),
  })

  await backfillDuracion(opciones())
  const segunda = await backfillDuracion(opciones())

  assert.equal(segunda.vistos, 0, 'la fila rellenada desaparece de la consulta: no hay nada que ver')
  assert.equal(red.urls.length, 1, 'la segunda pasada no gasta ni una unidad')
})

test('🔴 la cuota corta ANTES de la llamada y el corte queda contado', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [
    { id: 'a', externalId: 'vid00000001', duracion: null },
    { id: 'b', externalId: 'vid00000002', duracion: null },
    { id: 'c', externalId: 'vid00000003', duracion: null },
  ]
  const red = fetchVideos({ vid00000001: 'PT1M', vid00000002: 'PT1M', vid00000003: 'PT1M' })

  const r = await backfillDuracion({
    almacen,
    metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl },
    cuota: crearContadorCuota({ presupuesto: 2, reservaVerificacion: 0 }),
  })

  assert.equal(r.escritos, 2)
  assert.equal(r.cortesCuota, 1)
  assert.equal(red.urls.length, 2, 'la tercera llamada NO salió: el corte es antes, no después')
  assert.equal(almacen.filas.find((f) => f.id === 'c')?.duracion, null, 'queda para la siguiente ejecución')
})

test('🔴 sin clave no toca ni la red, ni el cupo, ni la base', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [{ id: 'a', externalId: 'vid00000001', duracion: null }]
  const red = fetchVideos({ vid00000001: 'PT1M' })

  const r = await backfillDuracion({ almacen, metadatos: { apiKey: '', fetchImpl: red.fetchImpl } })

  assert.equal(r.sinClave, true)
  assert.equal(r.vistos, 0)
  assert.equal(red.urls.length, 0)
  assert.equal(almacen.reservas.length, 0, 'no se reserva un presupuesto que nadie puede gastar')
})

test('una API que no contesta o no da duración deja la fila NULL, jamás un número inventado', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [
    { id: 'a', externalId: 'vid00000001', duracion: null }, // items vacío (borrado/privado)
    { id: 'b', externalId: 'vid00000002', duracion: null }, // sin contentDetails.duration
    { id: 'c', externalId: 'vid00000003', duracion: null }, // directo: P0D
  ]
  const red = fetchVideos({ vid00000002: null, vid00000003: 'P0D' })

  const r = await backfillDuracion({
    almacen,
    metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl },
    cuota: crearContadorCuota(),
  })

  assert.equal(r.escritos, 0)
  assert.equal(r.sinRespuesta, 1)
  assert.equal(r.sinDuracion, 2)
  assert.ok(almacen.filas.every((f) => f.duracion === null))
})

test('sin contador propio, reserva del cupo diario y devuelve el sobrante', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = [{ id: 'a', externalId: 'vid00000001', duracion: null }]
  const red = fetchVideos({ vid00000001: 'PT1M' })

  await backfillDuracion({ almacen, metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl } })

  assert.deepEqual(almacen.reservas, [{ unidades: PRESUPUESTO_POR_CORRIDA, tope: TOPE_DIARIO_PERSISTENTE }])
  assert.deepEqual(almacen.devueltas, [PRESUPUESTO_POR_CORRIDA - 1])
})

test('respeta el tope de vídeos por ejecución', async () => {
  const almacen = new AlmacenBackfillFalso()
  almacen.filas = Array.from({ length: 5 }, (_, i) => ({
    id: `id${i}`,
    externalId: `vid0000000${i}`,
    duracion: null,
  }))
  const red = fetchVideos(Object.fromEntries(almacen.filas.map((f) => [f.externalId, 'PT1M'])))

  const r = await backfillDuracion({
    almacen,
    metadatos: { apiKey: CLAVE, fetchImpl: red.fetchImpl },
    cuota: crearContadorCuota(),
    maxVideos: 3,
  })

  assert.equal(r.vistos, 3)
  assert.equal(r.escritos, 3)
})
