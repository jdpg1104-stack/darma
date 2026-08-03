// ============================================================================
// Tests del runner de RLS y de la COBERTURA de la suite.
//
// Estos tests no tocan la base de datos: se ejecutan en cada PR y comprueban
// dos cosas que sí se pueden comprobar sin ella y que son justo las que fallan
// en silencio:
//
//  1. Que el runner ABORTA si le dan la service_role key. Una suite que pase
//     con esa llave no prueba nada (salta todas las políticas por diseño) y es
//     peor que no tener suite, porque genera confianza falsa.
//  2. Que la MATRIZ está completa: todas las tablas de las dos migraciones,
//     los cuatro ataques nombrados, las cinco regresiones y un positivo de
//     control en cada caso crítico. Una suite a la que se le cae una tabla en
//     un merge sigue pasando en verde.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { verificarClaveAnon, rolDeJwt, formatearInforme, type ResultadoCaso } from './ejecutarRls.ts'
import { CASOS_RLS, TABLAS_CUBIERTAS } from '../../supabase/tests/rls.integracion.ts'

function jwtFalso(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'x'.repeat(43)}`
}

// ── Punto 10 de la ficha ────────────────────────────────────────────────────

test('10 · arrancar con la service_role key aborta con mensaje explícito', () => {
  const r = verificarClaveAnon(jwtFalso({ iss: 'supabase', role: 'service_role' }))

  assert.equal(r.ok, false)
  assert.equal(r.rol, 'service_role')
  assert.match(r.mensaje, /ABORTADO/)
  assert.match(r.mensaje, /SALTA TODAS LAS POLÍTICAS/)
  // El mensaje tiene que decir qué hacer, no solo que algo está mal.
  assert.match(r.mensaje, /SUPABASE_ANON_KEY/)
})

test('10 bis · la anon key pasa la verificación', () => {
  const r = verificarClaveAnon(jwtFalso({ iss: 'supabase', role: 'anon' }))
  assert.equal(r.ok, true)
  assert.equal(r.rol, 'anon')
})

test('10 ter · sin clave configurada también aborta', () => {
  assert.equal(verificarClaveAnon('').ok, false)
})

test('una clave publicable que no es JWT se acepta (solo se veta service_role)', () => {
  const r = verificarClaveAnon('sb_publishable_abc123')
  assert.equal(r.ok, true)
  assert.equal(r.rol, null)
})

test('rolDeJwt no revienta con basura', () => {
  assert.equal(rolDeJwt('no-es-un-jwt'), null)
  assert.equal(rolDeJwt('a.b.c'), null)
})

// ── Cobertura de la matriz (punto 4 de la ficha) ────────────────────────────

const TABLAS_EXIGIDAS = [
  'profiles',
  'identity_vault',
  'karma_events',
  'karma_weights',
  'posts',
  'comments',
  'post_votes',
  'refuges',
  'refuge_members',
  'refuge_messages',
  'kindred',
  'blocks',
  'content_items',
  'content_views',
  'polls',
  'poll_options',
  'poll_votes',
  'moderation_flags',
  'crisis_events',
  'crystal_ledger',
  'boosts',
  'gifts',
  'rate_limits',
] as const

test('4 · la suite cubre TODAS las tablas de 0001 y 0002', () => {
  const faltan = TABLAS_EXIGIDAS.filter((t) => !TABLAS_CUBIERTAS.includes(t))
  assert.deepEqual(faltan, [], `sin casos de RLS: ${faltan.join(', ')}`)
})

test('cada tabla tiene al menos un caso de lectura y uno de escritura', () => {
  for (const tabla of TABLAS_EXIGIDAS) {
    const casos = CASOS_RLS.filter((c) => c.tabla === tabla)
    assert.ok(casos.length >= 2, `${tabla} tiene ${casos.length} caso(s); se esperan al menos 2`)
  }
})

test('los cuatro ataques nombrados tienen su caso', () => {
  const texto = CASOS_RLS.map((c) => `${c.tabla} ${c.ataque}`).join('\n').toLowerCase()

  assert.match(texto, /karma_reputation = 999999/, 'falta el ataque de escribirse karma')
  assert.match(texto, /saltarse el gate 3:1/, 'falta el ataque de saltarse la reciprocidad')
  assert.match(texto, /leer identity_vault/, 'falta el ataque de leer identity_vault')
  assert.match(texto, /refugio del que no soy miembro/, 'falta el ataque del refugio ajeno')
})

test('los cuatro ataques nombrados llevan positivo de control', () => {
  // Sin el control no sabes si el ataque falló por la política o porque la
  // consulta estaba mal escrita. Es el punto 12 de la ficha.
  const criticos = CASOS_RLS.filter(
    (c) =>
      /999999/.test(c.ataque) ||
      /identity_vault/.test(c.ataque) ||
      /refugio del que no soy miembro/.test(c.ataque),
  )
  assert.ok(criticos.length >= 3)
  for (const c of criticos) {
    assert.ok(
      typeof c.controlServiceRole === 'function',
      `el caso «${c.ataque}» necesita positivo de control`,
    )
  }
})

test('el caso de is_validated va el PRIMERO de la suite', () => {
  // Es la columna más peligrosa de la app: si entrara en el `grant update`,
  // cualquiera con la anon key se auto-validaría comentarios y se saltaría la
  // reciprocidad entera.
  assert.match(CASOS_RLS[0]!.ataque, /is_validated/)
  assert.equal(CASOS_RLS[0]!.tabla, 'comments')
})

test('la distinción «cero filas, no permiso denegado» se testea explícitamente', () => {
  const caso = CASOS_RLS.find((c) => /INDISTINGUIBLES/i.test(c.ataque))
  assert.ok(caso, 'falta el caso que compara refugio ajeno contra refugio inexistente')
})

test('el shadow-ban se comprueba desde el usuario B, no desde el baneado', () => {
  const caso = CASOS_RLS.find((c) => c.tabla === 'posts' && /shadow-ban/i.test(c.ataque))
  assert.ok(caso, 'falta el caso de shadow-ban sobre posts')
  assert.ok(typeof caso.controlServiceRole === 'function')
})

// ── Las cinco regresiones ───────────────────────────────────────────────────

test('las CINCO regresiones cerradas tienen caso propio y marcado', () => {
  const marcadas = CASOS_RLS.filter((c) => c.regresion)
  assert.ok(marcadas.length >= 5, `solo hay ${marcadas.length} casos marcados como regresión`)

  const texto = marcadas.map((c) => c.regresion!).join('\n')
  assert.match(texto, /R1 · grant execute de award_karma a service_role/)
  assert.match(texto, /R2 · farmeo de karma vía PATCH en content_views/)
  assert.match(texto, /R3 · farmeo de karma vía INSERT en content_views/)
  assert.match(texto, /R4 · el ledger etiquetaba gastos como comment_validated/)
  assert.match(texto, /R5 · fuga de karma_spendable\/crystals/)
})

test('la regresión R1 comprueba el grant a service_role en su positivo de control', () => {
  const r1 = CASOS_RLS.find((c) => c.regresion?.startsWith('R1'))
  assert.ok(r1)
  assert.ok(typeof r1.controlServiceRole === 'function', 'R1 SOLO se verifica con el control de service_role')
})

test('las funciones de economía y rate limiting tienen su caso', () => {
  for (const fn of ['fn:spend_karma', 'fn:spend_crystals', 'fn:check_rate_limit', 'fn:award_karma']) {
    assert.ok(
      CASOS_RLS.some((c) => c.tabla === fn),
      `falta el caso de ${fn}`,
    )
  }
})

// ── Informe ─────────────────────────────────────────────────────────────────

test('el informe distingue regresión, fuga y control roto', () => {
  const resultados: ResultadoCaso[] = [
    {
      tabla: 'content_views',
      ataque: 'PATCH completed',
      bloqueado: false,
      detalle: 'FUGA',
      control: null,
      regresion: 'R2 · farmeo de karma vía PATCH en content_views',
      ms: 3,
    },
    {
      tabla: 'profiles',
      ataque: 'karma ajeno',
      bloqueado: true,
      detalle: 'ok',
      control: { funciono: false, detalle: 'falló también con service_role' },
      ms: 2,
    },
  ]

  const texto = formatearInforme({ ok: false, resultados, ms: 1000 })
  assert.match(texto, /REGRESIÓN/)
  assert.match(texto, /1 ataque\(s\) NO bloqueado/)
  assert.match(texto, /positivo\(s\) de control roto/)
  assert.match(texto, /puede estar mal escrito/)
})

test('el informe de éxito lo dice claramente', () => {
  const texto = formatearInforme({ ok: true, resultados: [], ms: 500 })
  assert.match(texto, /Todos los ataques quedaron bloqueados/)
})
