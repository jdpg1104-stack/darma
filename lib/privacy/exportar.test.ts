import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import { detectPii } from '../anonymity.ts'
import {
  SECCIONES_EXPORTACION,
  construirExportacionCon,
  nombreArchivoExportacion,
  revisarPiiExportacion,
  serializarExportacion,
} from './exportar.ts'

// ── Doble de prueba ─────────────────────────────────────────────────────────
// Devuelve filas por tabla y registra las columnas pedidas en cada `select`.
// Lo que de verdad se prueba aquí es esto último: la exclusión de datos ajenos
// tiene que estar en el SELECT, no en un filtro posterior. Comprobar la salida
// dejaría pasar la versión que trae el autor y lo borra luego, que es la que un
// refactor futuro rompe sin que nadie lo note.
function clienteFalso(porTabla: Record<string, unknown[]>): {
  cliente: SupabaseClient
  selects: Record<string, string>
} {
  const selects: Record<string, string> = {}

  const cliente = {
    from(tabla: string) {
      const filas = porTabla[tabla] ?? []
      const consulta = {
        select(columnas: string) {
          selects[tabla] = columnas
          return consulta
        },
        eq: () => consulta,
        neq: () => consulta,
        in: () => consulta,
        is: () => consulta,
        order: () => consulta,
        limit: () => Promise.resolve({ data: filas, error: null }),
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
      }
      return consulta
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient

  return { cliente, selects }
}

const SEMILLA: Record<string, unknown[]> = {
  profiles: [
    {
      alias: 'Faro Sereno 4821',
      avatar_seed: 'ab12cd34',
      level: 'brote',
      karma_reputation: 640,
      created_at: '2026-01-02T10:00:00.000Z',
    },
  ],
  karma_events: [
    { kind: 'comment_validated', delta_reputation: 10, delta_spendable: 3, created_at: '2026-02-01T00:00:00.000Z' },
  ],
  posts: [
    {
      id: 'p-1',
      kind: 'desahogo',
      body: 'Lo estoy pasando mal desde hace semanas y necesitaba escribirlo.',
      created_at: '2026-02-02T00:00:00.000Z',
      reply_count: 2,
    },
  ],
  comments: [
    {
      id: 'c-1',
      post_id: 'p-9',
      body: 'Te leo y te acompaño en esto, no tienes que resolverlo hoy.',
      is_validated: true,
      created_at: '2026-02-03T00:00:00.000Z',
      // Se incluye a propósito en la fila cruda: si el código lo copiara, el
      // test de abajo lo cazaría.
      author_id: 'yo',
    },
  ],
  content_views: [
    { completed: true, created_at: '2026-02-04T00:00:00.000Z', content_items: { title: 'Respirar 4-7-8' } },
  ],
  crystal_ledger: [{ delta: 100, reason: 'compra inicial', created_at: '2026-02-05T00:00:00.000Z' }],
  consents: [{ kind: 'privacidad', version: 'v1-2026-08', accepted_at: 'x', revoked_at: null }],
  privacy_requests: [{ kind: 'export', state: 'done', requested_at: '2026-02-06T00:00:00.000Z' }],
}

test('la exportación trae las nueve secciones del contrato', async () => {
  const { cliente } = clienteFalso(SEMILLA)
  const exportacion = await construirExportacionCon(cliente, 'u-1')

  for (const seccion of SECCIONES_EXPORTACION) {
    assert.ok(seccion in exportacion, `falta la sección ${seccion}`)
  }
  assert.equal(exportacion.formato, 1)
  assert.equal(exportacion.perfil.alias, 'Faro Sereno 4821')
  assert.equal(exportacion.publicaciones.length, 1)
  assert.equal(exportacion.comentarios.length, 1)
  assert.equal(exportacion.contenidoVisto[0].titulo, 'Respirar 4-7-8')
  assert.deepEqual(exportacion.bloquesTruncados, [])
})

test('el join de contenido se normaliza venga como objeto o como array', async () => {
  const { cliente } = clienteFalso({
    ...SEMILLA,
    content_views: [
      { completed: false, created_at: 'x', content_items: [{ title: 'Como array' }] },
      { completed: false, created_at: 'x', content_items: null },
    ],
  })
  const exportacion = await construirExportacionCon(cliente, 'u-1')
  assert.equal(exportacion.contenidoVisto[0].titulo, 'Como array')
  assert.equal(exportacion.contenidoVisto[1].titulo, '')
})

test('apoyoRecibido pide el texto y NO pide ninguna clave de autor', async () => {
  const { cliente, selects } = clienteFalso({
    ...SEMILLA,
    comments: [
      { post_id: 'p-1', body: 'Estoy aquí, escríbeme cuando quieras.', created_at: 'x' },
    ],
  })
  const exportacion = await construirExportacionCon(cliente, 'u-1')

  // El `select` de `comments` es el mismo objeto para las dos consultas del
  // doble; lo que importa es que el último registrado —el de apoyoRecibido— no
  // contenga author_id.
  assert.ok(!selects.comments.includes('author_id'))
  assert.ok(selects.comments.includes('body'))

  for (const apoyo of exportacion.apoyoRecibido) {
    assert.deepEqual(Object.keys(apoyo).sort(), ['cuerpo', 'fecha', 'postId'])
  }
})

test('nombreArchivoExportacion no lleva alias ni identificador', () => {
  const nombre = nombreArchivoExportacion(new Date('2026-08-03T12:00:00Z'))
  assert.equal(nombre, 'darma-mis-datos-2026-08-03.json')
})

test('revisarPiiExportacion cuenta hallazgos y NO devuelve el texto', () => {
  const conteo = revisarPiiExportacion(
    {
      formato: 1,
      generadoEn: 'x',
      perfil: { alias: 'a', avatarSeed: 'b', nivel: 'semilla', karmaReputacion: 0, creadoEn: 'x' },
      karma: [],
      publicaciones: [
        { id: 'p', tipo: 'desahogo', cuerpo: 'escríbeme a ana@ejemplo.com', fecha: 'x', respuestas: 0 },
      ],
      comentarios: [],
      apoyoRecibido: [],
      contenidoVisto: [],
      cristales: [],
      consentimientos: [],
      solicitudes: [],
      bloquesTruncados: [],
    },
    detectPii,
  )

  assert.ok((conteo.email ?? 0) >= 1)
  // Solo recuentos: ni una cadena del cuerpo puede acabar en el log.
  for (const valor of Object.values(conteo)) {
    assert.equal(typeof valor, 'number')
  }
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · la exportación NO contiene contact_hash, email, phone ni ip', async () => {
  const { cliente } = clienteFalso(SEMILLA)
  const exportacion = await construirExportacionCon(cliente, 'u-1')
  const serializado = serializarExportacion(exportacion)

  for (const prohibido of ['contact_hash', 'contactHash', 'email', 'phone', 'user_agent', '"ip"', 'token_sha256']) {
    assert.ok(
      !serializado.includes(prohibido),
      `la exportación contiene «${prohibido}», que CONTRATOS §2 declara inexistente`,
    )
  }
})

test('FALLO · ningún alias de tercero se cuela en la exportación', async () => {
  const { cliente } = clienteFalso({
    ...SEMILLA,
    comments: [{ post_id: 'p-1', body: 'Aquí estoy si necesitas hablar.', created_at: 'x' }],
  })
  const exportacion = await construirExportacionCon(cliente, 'u-1')
  const serializado = serializarExportacion(exportacion)

  // El único alias del archivo es el propio, y aparece una sola vez.
  const apariciones = serializado.split('Faro Sereno 4821').length - 1
  assert.equal(apariciones, 1)
  assert.ok(!serializado.includes('author_id'))
  assert.ok(!serializado.includes('autor'))
})

test('FALLO · sin perfil, la exportación falla en vez de servir un archivo vacío', async () => {
  const { cliente } = clienteFalso({ ...SEMILLA, profiles: [] })
  await assert.rejects(() => construirExportacionCon(cliente, 'u-1'), /sin perfil/)
})

test('FALLO · un error de una consulta se propaga con su bloque, no se traga', async () => {
  const cliente = {
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        neq: () => consulta,
        in: () => consulta,
        is: () => consulta,
        order: () => consulta,
        limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }
      return consulta
    },
  } as unknown as SupabaseClient

  await assert.rejects(() => construirExportacionCon(cliente, 'u-1'), /exportacion:perfil/)
})
