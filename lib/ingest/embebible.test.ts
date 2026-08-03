import test from 'node:test'
import assert from 'node:assert/strict'

import { sondaEmbed, sondaEmbedVarios } from './embebible.ts'

/** Doble de `fetch`: ni un byte de red en los tests. */
function fetchConEstado(status: number, contarEn?: { n: number }): typeof fetch {
  return (async () => {
    if (contarEn) contarEn.n++
    return { status } as Response
  }) as unknown as typeof fetch
}

const sinEsperar = async (): Promise<void> => {}

// ── Prueba exigida nº 4 ─────────────────────────────────────────────────────

test('200 → embebible', async () => {
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(200), esperarImpl: sinEsperar }), 'embebible')
})

test('401 → no_embebible (el dueño bloqueó la reproducción fuera de YouTube)', async () => {
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(401), esperarImpl: sinEsperar }), 'no_embebible')
})

test('404 → ausente_o_privado', async () => {
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(404), esperarImpl: sinEsperar }), 'ausente_o_privado')
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(400), esperarImpl: sinEsperar }), 'ausente_o_privado')
})

test('500, 429 y timeout → desconocido (y NO rechazan el ítem)', async () => {
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(500), esperarImpl: sinEsperar }), 'desconocido')
  assert.equal(await sondaEmbed('vid', { fetchImpl: fetchConEstado(429), esperarImpl: sinEsperar }), 'desconocido')

  const queLanza = (async () => {
    throw new Error('timeout')
  }) as unknown as typeof fetch
  assert.equal(await sondaEmbed('vid', { fetchImpl: queLanza, esperarImpl: sinEsperar }), 'desconocido')
})

test('«desconocido» es un valor PROPIO: nunca coincide con «no_embebible»', async () => {
  // Es la trampa nº 2 de la ficha. Si algún día alguien "simplifica" el tipo a un
  // booleano, este test es el que se pone rojo.
  const r = await sondaEmbed('vid', { fetchImpl: fetchConEstado(503), esperarImpl: sinEsperar })
  assert.equal(r, 'desconocido')
  assert.notEqual(r, 'no_embebible')
})

// ── Reintentos ──────────────────────────────────────────────────────────────

test('429 y 5xx se REINTENTAN; 401 y 404 no', async () => {
  const c429 = { n: 0 }
  await sondaEmbed('vid', { fetchImpl: fetchConEstado(429, c429), reintentos: 2, esperarImpl: sinEsperar })
  assert.equal(c429.n, 3, '429 debería intentarse 1 + 2 veces')

  const c401 = { n: 0 }
  await sondaEmbed('vid', { fetchImpl: fetchConEstado(401, c401), reintentos: 2, esperarImpl: sinEsperar })
  assert.equal(c401.n, 1, '401 es una respuesta firme: no se reintenta')

  const c404 = { n: 0 }
  await sondaEmbed('vid', { fetchImpl: fetchConEstado(404, c404), reintentos: 2, esperarImpl: sinEsperar })
  assert.equal(c404.n, 1)
})

test('un id vacío no genera petición y devuelve desconocido', async () => {
  const c = { n: 0 }
  assert.equal(await sondaEmbed('', { fetchImpl: fetchConEstado(200, c), esperarImpl: sinEsperar }), 'desconocido')
  assert.equal(c.n, 0)
})

test('sondaEmbedVarios deduplica ids y responde por cada uno', async () => {
  const c = { n: 0 }
  const mapa = await sondaEmbedVarios(['a', 'b', 'a'], {
    fetchImpl: fetchConEstado(200, c),
    esperarImpl: sinEsperar,
    concurrencia: 2,
  })
  assert.equal(mapa.size, 2)
  assert.equal(c.n, 2, 'el id repetido no debería consultarse dos veces')
  assert.equal(mapa.get('a'), 'embebible')
})
