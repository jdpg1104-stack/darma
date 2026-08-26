// ============================================================================
// B01 · Pruebas del dominio puro del paso de edad del onboarding.
//
// Dos frentes: (1) el veredicto de `evaluarFechaDeclarada()` distingue lo que
// la pantalla necesita distinguir (cumple / no cumple / fecha imposible), y
// (2) la propiedad de privacidad que motiva todo el paso — la fecha no puede
// viajar ni persistir — afirmada sobre el CÓDIGO FUENTE, que es donde se
// rompería: ni el dominio ni el asistente pueden tocar red o storage con ella.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { esFechaDeclaradaPosible, evaluarFechaDeclarada } from './edad.ts'

const HOY = new Date('2026-08-26T12:00:00.000Z')
const CARPETA = import.meta.dirname

test('cumple: 16 justos hoy y cualquier edad por encima', () => {
  // Cumple 16 exactamente hoy: pasa desde el día del cumpleaños, no el siguiente.
  assert.equal(evaluarFechaDeclarada('2010-08-26', HOY), 'cumple')
  assert.equal(evaluarFechaDeclarada('1990-01-01', HOY), 'cumple')
})

test('noCumple: con 15, y también a un solo día del decimosexto cumpleaños', () => {
  assert.equal(evaluarFechaDeclarada('2011-08-26', HOY), 'noCumple')
  assert.equal(evaluarFechaDeclarada('2010-08-27', HOY), 'noCumple')
})

test('invalida: formato raro, fecha imposible, futura o vacía', () => {
  assert.equal(evaluarFechaDeclarada('26/08/2010', HOY), 'invalida')
  assert.equal(evaluarFechaDeclarada('2010-02-31', HOY), 'invalida')
  assert.equal(evaluarFechaDeclarada('2010-13-01', HOY), 'invalida')
  assert.equal(evaluarFechaDeclarada('2030-01-01', HOY), 'invalida')
  assert.equal(evaluarFechaDeclarada('', HOY), 'invalida')
})

test('una fecha futura es un error de tecleo, no una edad: jamás «noCumple»', () => {
  // La distinción es la razón de ser del módulo: a quien tecleó mal se le pide
  // revisar; «todavía no» se reserva para quien de verdad no llega a la edad.
  assert.notEqual(evaluarFechaDeclarada('2030-01-01', HOY), 'noCumple')
  assert.equal(esFechaDeclaradaPosible('2030-01-01', HOY), false)
  assert.equal(esFechaDeclaradaPosible('2010-08-26', HOY), true)
})

// ── La propiedad de privacidad, afirmada donde se rompería ─────────────────

test('FALLO · el dominio de edad no puede tocar red, base de datos ni storage', () => {
  const fuente = readFileSync(join(CARPETA, 'edad.ts'), 'utf8')
  for (const prohibido of ['fetch', 'supabase', 'localStorage', 'sessionStorage', 'console.']) {
    assert.ok(!fuente.includes(prohibido), `edad.ts no debe contener «${prohibido}»`)
  }
})

test('FALLO · el asistente no persiste la fecha ni la mete en ningún cuerpo de petición', () => {
  const fuente = readFileSync(join(CARPETA, 'AsistenteOnboarding.tsx'), 'utf8')

  // Nada de storage: la fecha no debe sobrevivir al paso en ningún sitio.
  assert.ok(!fuente.includes('localStorage'), 'el asistente no debe usar localStorage')
  assert.ok(!fuente.includes('sessionStorage'), 'el asistente no debe usar sessionStorage')
  assert.ok(!fuente.includes('document.cookie'), 'el asistente no debe escribir cookies')

  // Ningún cuerpo que viaje al servidor puede mencionar la fecha. Se inspeccionan
  // TODAS las serializaciones del componente, no una lista de rutas conocida.
  const cuerpos = fuente.match(/JSON\.stringify\([^)]*\)/g) ?? []
  assert.ok(cuerpos.length > 0, 'se esperaba al menos un cuerpo serializado (crear perfil)')
  for (const cuerpo of cuerpos) {
    assert.ok(
      !/fecha|nacimiento|birth/i.test(cuerpo),
      `un cuerpo de petición menciona la fecha de nacimiento: ${cuerpo}`,
    )
  }

  // Y la comprobación se hace de verdad con el dominio puro antes de crear nada.
  assert.ok(fuente.includes('evaluarFechaDeclarada'), 'el asistente debe validar con el dominio puro')
  assert.ok(fuente.includes('edadConfirmada'), 'crear perfil debe estar condicionado a la comprobación')
})
