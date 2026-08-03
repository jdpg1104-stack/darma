// ============================================================================
// B10 · Casos 9 y 10 de HANDOFF/B10.md.
//
//  9 · keyset del hilo: tres páginas de 50 sobre 500 mensajes no repiten ni se
//      saltan ninguno.
// 10 · Realtime: un payload con otro `refuge_id` se descarta, y tras una
//      reconexión se rellena desde el último id sin dejar huecos.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import type { MensajeDescifrado } from '@/lib/crypto/tipos'
import {
  aceptarPayload,
  faltanMasPaginas,
  fusionarMensajes,
  pendientesDeRellenar,
  ultimoId,
} from './hilo.dominio.ts'
import { cursorHilo, leerCursorHilo } from '../../app/api/refuges/_dominio/validacion.ts'

const SALA = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTRA_SALA = '9f2504e0-4f89-11d3-9a0c-0305e82c3302'

function mensaje(id: number, texto = `mensaje ${id}`): MensajeDescifrado {
  return {
    id,
    refugeId: SALA,
    senderId: 'aaaaaaaa-0000-0000-0000-000000000001',
    encVersion: 1,
    kind: 'text',
    createdAt: new Date(1_700_000_000_000 + id).toISOString(),
    texto,
    ilegiblePorClave: false,
  }
}

// ── 10 · Realtime ───────────────────────────────────────────────────────────

test('FALLO · un payload de OTRA sala se descarta', () => {
  assert.equal(aceptarPayload(SALA, { refuge_id: SALA }), true)
  assert.equal(aceptarPayload(SALA, { refuge_id: OTRA_SALA }), false)
  assert.equal(aceptarPayload(SALA, {}), false)
  assert.equal(aceptarPayload(SALA, { refuge_id: 42 }), false)
  assert.equal(aceptarPayload(SALA, { refuge_id: null }), false)
})

test('tras una reconexión se piden SOLO los mensajes por encima del último id', () => {
  const tengo = [mensaje(12), mensaje(11), mensaje(10)]
  const recibidos = [mensaje(14), mensaje(13), mensaje(12), mensaje(11)]

  const pendientes = pendientesDeRellenar(recibidos, ultimoId(tengo))
  assert.deepEqual(pendientes.map((m) => m.id), [14, 13])

  const fusionados = fusionarMensajes(tengo, pendientes)
  assert.deepEqual(fusionados.map((m) => m.id), [14, 13, 12, 11, 10], 'sin huecos y sin duplicados')
})

test('un mensaje que llega por el canal Y por el relleno se pinta UNA vez', () => {
  const tengo = [mensaje(5)]
  const porRealtime = [mensaje(6)]
  const porRelleno = [mensaje(6), mensaje(7)]

  const fusionados = fusionarMensajes(fusionarMensajes(tengo, porRealtime), porRelleno)
  assert.deepEqual(fusionados.map((m) => m.id), [7, 6, 5])
  assert.equal(new Set(fusionados.map((m) => m.id)).size, fusionados.length)
})

test('un mensaje que antes era ilegible y ahora se descifra SUSTITUYE al viejo', () => {
  const cerrado: MensajeDescifrado = { ...mensaje(9), texto: null, ilegiblePorClave: true }
  const abierto = mensaje(9, 'ya tengo la llave')

  const fusionados = fusionarMensajes([cerrado], [abierto])
  assert.equal(fusionados.length, 1)
  assert.equal(fusionados[0].texto, 'ya tengo la llave')
  assert.equal(fusionados[0].ilegiblePorClave, false)
})

test('una página de relleno llena que no llega al último id conocido pide más', () => {
  // Estaba en el 100, vuelvo y la página trae del 200 al 151: entre 101 y 150
  // hay un agujero y hay que seguir pidiendo hacia atrás.
  const pagina = Array.from({ length: 50 }, (_, i) => mensaje(200 - i))
  assert.equal(faltanMasPaginas(pagina, 100, 50), true)

  // Si la página no viene llena, no hay nada más que pedir.
  assert.equal(faltanMasPaginas(pagina.slice(0, 10), 100, 50), false)
  // Y si engancha justo con lo que tenía, tampoco.
  const contigua = Array.from({ length: 50 }, (_, i) => mensaje(150 - i))
  assert.equal(faltanMasPaginas(contigua, 100, 50), false)
})

// ── 9 · keyset del hilo ─────────────────────────────────────────────────────

test('500 mensajes, tres páginas de 50: ni uno repetido ni uno saltado', () => {
  // Simula el `where id < :cursor order by id desc limit 50` del servidor sobre
  // 500 mensajes sembrados. Los ids NO son consecutivos a propósito: en una
  // tabla real hay huecos (mensajes retirados, `identity` que salta), y un
  // keyset que solo funcione con ids seguidos es un keyset roto.
  const todos = Array.from({ length: 500 }, (_, i) => mensaje(1 + i * 3)).sort((a, b) => b.id - a.id)

  function pagina(cursor: number | null, limite = 50) {
    const candidatos = cursor === null ? todos : todos.filter((m) => m.id < cursor)
    return candidatos.slice(0, limite)
  }

  let cursor: number | null = null
  let acumulado: MensajeDescifrado[] = []

  for (let i = 0; i < 3; i++) {
    const items = pagina(cursor)
    assert.equal(items.length, 50, `la página ${i + 1} tiene que venir llena`)

    acumulado = fusionarMensajes(acumulado, items)

    // El cursor viaja opaco y vuelve entero: es la ida y vuelta real de la API.
    const opaco = cursorHilo(items[items.length - 1].id)
    cursor = leerCursorHilo(opaco)
  }

  assert.equal(acumulado.length, 150, 'tres páginas de 50 son 150 mensajes distintos')
  assert.equal(new Set(acumulado.map((m) => m.id)).size, 150, 'ninguno repetido')

  // Y son EXACTAMENTE los 150 más recientes: ninguno saltado.
  assert.deepEqual(acumulado.map((m) => m.id), todos.slice(0, 150).map((m) => m.id))
})

test('el keyset no se descoloca si entran mensajes nuevos mientras se pagina', () => {
  // El problema clásico de OFFSET: publicar mientras alguien lee desplaza la
  // ventana y repite o salta filas. Con keyset sobre el id, la página 2 empieza
  // donde acabó la 1 pase lo que pase por arriba.
  const iniciales = Array.from({ length: 100 }, (_, i) => mensaje(100 - i))
  const primeraPagina = iniciales.slice(0, 50)
  const cursor = leerCursorHilo(cursorHilo(primeraPagina[primeraPagina.length - 1].id))

  // Llegan 10 mensajes nuevos por arriba entre página y página.
  const conNuevos = [...Array.from({ length: 10 }, (_, i) => mensaje(110 - i)), ...iniciales]

  const segundaPagina = conNuevos.filter((m) => m.id < (cursor as number)).slice(0, 50)
  const idsPrimera = new Set(primeraPagina.map((m) => m.id))

  assert.equal(segundaPagina.some((m) => idsPrimera.has(m.id)), false, 'nada repetido')
  assert.deepEqual(segundaPagina.map((m) => m.id), iniciales.slice(50, 100).map((m) => m.id))
})
