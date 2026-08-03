// ============================================================================
// B11 · Pruebas de las colas y de las guardas de las rutas
//
// Los Route Handlers viven en `app/`, y `npm test` solo mira bajo `lib/`
// (`node --test --experimental-strip-types "lib/**/*.test.ts"`). Un test en
// `app/` no se ejecuta NUNCA. Por eso toda la lógica que se puede probar —
// cursor, límites, permiso, rate limit del reporte— vive en `lib/ai/` y las
// rutas son envoltorios finos sobre ella. Lo que queda en la ruta es zod +
// `manejarRuta`, y eso lo cubre B18 con Playwright.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  codificarCursor,
  decodificarCursor,
  normalizarLimite,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
} from './cola.ts'
import { parsearSemillaSuperadmin, ROL_MINIMO_MODERACION } from './acceso.ts'
import { cumpleRol, ORDEN_ROLES } from '../../app/(admin)/_lib/acceso.ts'
import { LIMITE_REPORTE } from './modelo.ts'
import { __resetMemoryBuckets, rateLimitMemory } from '../rateLimit.ts'

// ── Cursor ──────────────────────────────────────────────────────────────────

test('el cursor es opaco y viaja de ida y vuelta', () => {
  const cursor = codificarCursor({ s: 4, t: '2026-08-03T10:00:00.000Z' })
  // Opaco de verdad: no se lee el contenido a simple vista.
  assert.equal(cursor.includes('2026'), false)
  assert.deepEqual(decodificarCursor(cursor), { s: 4, t: '2026-08-03T10:00:00.000Z' })
})

test('un cursor manipulado devuelve null en vez de lanzar', () => {
  for (const basura of ['', 'no-es-base64!!', 'YWJj', undefined, null, 'W10']) {
    assert.doesNotThrow(() => decodificarCursor(basura))
  }
  assert.equal(decodificarCursor('no-es-base64!!'), null)
  // Un array no es un cursor: si pasara, `cursor.t` sería undefined y la
  // consulta devolvería la primera página en bucle.
  assert.equal(decodificarCursor(codificarCursor([] as unknown as Record<string, string>)), null)
})

test('el límite se normaliza y nunca pasa de 50 (CONTRATOS §5)', () => {
  assert.equal(normalizarLimite(undefined), LIMITE_POR_DEFECTO)
  assert.equal(normalizarLimite(0), LIMITE_POR_DEFECTO)
  assert.equal(normalizarLimite(-3), LIMITE_POR_DEFECTO)
  assert.equal(normalizarLimite('abc'), LIMITE_POR_DEFECTO)
  assert.equal(normalizarLimite(10), 10)
  assert.equal(normalizarLimite(10.9), 10)
  assert.equal(normalizarLimite(1000), LIMITE_MAXIMO)
})

// ── Guarda de moderador (prueba 11 de la ficha) ─────────────────────────────

// El permiso REAL lo decide `tiene_rol_admin()` en Postgres y no se puede
// probar aquí sin base: lo que se prueba es la jerarquía que esa función aplica
// (`ar.role >= p_minimo`), que es la parte pura y espejo del enum de la base.
test('la moderación exige `moderador`: soporte no llega, operaciones y superadmin sí', () => {
  assert.equal(ROL_MINIMO_MODERACION, 'moderador')
  assert.equal(cumpleRol('soporte', ROL_MINIMO_MODERACION), false)
  assert.equal(cumpleRol('moderador', ROL_MINIMO_MODERACION), true)
  assert.equal(cumpleRol('operaciones', ROL_MINIMO_MODERACION), true)
  assert.equal(cumpleRol('superadmin', ROL_MINIMO_MODERACION), true)
  // Si alguien reordena el enum en la base sin reordenar esto, la comparación
  // `>=` deja de significar lo mismo en los dos sitios.
  assert.ok(ORDEN_ROLES.indexOf(ROL_MINIMO_MODERACION) > ORDEN_ROLES.indexOf('soporte'))
})

test('MODERATION_ADMIN_IDS ya no autoriza: es solo semilla del primer superadmin', () => {
  // La función sobrevive para el script de bootstrap, pero no está en ningún
  // camino de decisión. Que siga siendo un parser puro es todo lo que se le pide.
  assert.equal(parsearSemillaSuperadmin(undefined).size, 0)
  assert.equal(parsearSemillaSuperadmin('').size, 0)
  const semilla = parsearSemillaSuperadmin(' AAAA-1 , bbbb-2 ; cccc-3 ')
  assert.deepEqual([...semilla].sort(), ['aaaa-1', 'bbbb-2', 'cccc-3'])
})

test('el código de error de la guarda no menciona tablas, SQL ni la fuente del rol', async () => {
  // `sin_permiso` es un 403 con un mensaje escrito por nosotros. El detalle
  // interno se queda en el log; el cliente ve un enum estable y una frase.
  const { ErrorApi } = await import('../auth/errores.ts')
  const error = new ErrorApi('sin_permiso')
  assert.equal(error.code, 'sin_permiso')
  assert.equal(error.status, 403)
  for (const filtracion of [
    'moderation_flags',
    'crisis_events',
    'select',
    'MODERATION_ADMIN_IDS',
    'service_role',
    // Ahora que el rol sale de la base, el 403 tampoco puede delatar de DÓNDE.
    'admin_roles',
    'tiene_rol_admin',
    'moderador',
  ]) {
    assert.equal(error.message.toLowerCase().includes(filtracion.toLowerCase()), false)
  }
})

// ── Rate limit del reporte (prueba 12 de la ficha) ─────────────────────────

test('el reporte 11 en una hora se rechaza con retryAfter', () => {
  __resetMemoryBuckets()
  const clave = `report:33333333-3333-3333-3333-333333333333`
  const ventanaMs = LIMITE_REPORTE.ventanaSegundos * 1000

  for (let i = 1; i <= LIMITE_REPORTE.limite; i++) {
    const r = rateLimitMemory(clave, LIMITE_REPORTE.limite, ventanaMs)
    assert.equal(r.ok, true, `el reporte ${i} debería pasar`)
  }

  const undecimo = rateLimitMemory(clave, LIMITE_REPORTE.limite, ventanaMs)
  assert.equal(undecimo.ok, false, 'el reporte 11 debe rechazarse')
  assert.ok(undecimo.retryAfter > 0, 'el 429 tiene que llevar retryAfter en segundos')
  __resetMemoryBuckets()
})

test('el límite de reporte es por persona, no global', () => {
  __resetMemoryBuckets()
  const ventanaMs = LIMITE_REPORTE.ventanaSegundos * 1000
  for (let i = 0; i < LIMITE_REPORTE.limite; i++) {
    rateLimitMemory('report:usuario-a', LIMITE_REPORTE.limite, ventanaMs)
  }
  assert.equal(rateLimitMemory('report:usuario-a', LIMITE_REPORTE.limite, ventanaMs).ok, false)
  // Que a una persona la hayan limitado no puede silenciar a otra.
  assert.equal(rateLimitMemory('report:usuario-b', LIMITE_REPORTE.limite, ventanaMs).ok, true)
  __resetMemoryBuckets()
})
