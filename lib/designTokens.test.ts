// Verifica que los ratios de contraste DOCUMENTADOS en lib/designTokens.ts son
// los ratios REALES. El fallo que este test previene es concreto y ha ocurrido
// en otros proyectos: alguien estima "esto será como 4.6, AA", lo escribe como
// si lo hubiera medido, y llega a producción un texto ilegible con un comentario
// que jura lo contrario.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BG, PANEL, INK, ACCENT, ACCENT_INK, ACCENT_FILL, ACCENT2, WARN, DANGER, GOLD, ON_FILL,
  TEXT_SAFETY, DARMA_PALETTE,
  contrastRatio, relativeLuminance, meetsAA, meetsAALarge,
} from './designTokens.ts'

const cerca = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol

test('contrastRatio: casos de referencia conocidos', () => {
  assert.ok(cerca(contrastRatio('#ffffff', '#000000'), 21))
  assert.equal(contrastRatio('#123456', '#123456'), 1)
  // Simétrico.
  assert.equal(contrastRatio(BG, INK), contrastRatio(INK, BG))
})

test('relativeLuminance rechaza un color mal escrito', () => {
  assert.throws(() => relativeLuminance('no-es-un-color'))
  assert.throws(() => relativeLuminance('#fff'))
})

test('todos los tokens son hex de 6 dígitos', () => {
  for (const [nombre, hex] of Object.entries(DARMA_PALETTE)) {
    assert.match(hex, /^#[0-9a-f]{6}$/, `${nombre} no es un hex de 6 dígitos`)
  }
})

test('los ratios documentados en TEXT_SAFETY son los ratios reales', () => {
  for (const [nombre, spec] of Object.entries(TEXT_SAFETY)) {
    const real = { onBg: contrastRatio(spec.hex, BG), onPanel: contrastRatio(spec.hex, PANEL) }
    assert.ok(cerca(real.onBg, spec.onBg), `${nombre} sobre BG: documentado ${spec.onBg}, real ${real.onBg.toFixed(2)}`)
    assert.ok(cerca(real.onPanel, spec.onPanel), `${nombre} sobre PANEL: documentado ${spec.onPanel}, real ${real.onPanel.toFixed(2)}`)
  }
})

test('safeAsBodyText coincide con AA real sobre AMBAS superficies', () => {
  for (const [nombre, spec] of Object.entries(TEXT_SAFETY)) {
    const aa = meetsAA(spec.hex, BG) && meetsAA(spec.hex, PANEL)
    assert.equal(spec.safeAsBodyText, aa, `${nombre}: safeAsBodyText dice ${spec.safeAsBodyText} pero AA real es ${aa}`)
  }
})

test('🔴 ACCENT NO vale como texto normal — está documentado y sigue siendo cierto', () => {
  assert.equal(meetsAA(ACCENT, BG), false)
  assert.equal(meetsAA(ACCENT, PANEL), false)
  // Sí vale para texto grande, que es su uso permitido.
  assert.equal(meetsAALarge(ACCENT, BG), true)
})

test('ACCENT_INK existe justamente para eso: AA sobre las dos superficies', () => {
  assert.ok(meetsAA(ACCENT_INK, BG))
  assert.ok(meetsAA(ACCENT_INK, PANEL))
})

test('un botón violeta con texto blanco usa ACCENT_FILL, no ACCENT', () => {
  assert.equal(meetsAA('#ffffff', ACCENT), false, 'blanco sobre ACCENT falla AA')
  assert.ok(meetsAA('#ffffff', ACCENT_FILL), 'blanco sobre ACCENT_FILL debe cumplir AA')
})

test('los rellenos claros exigen tinta oscura (ON_FILL), nunca blanco', () => {
  for (const relleno of [ACCENT2, WARN, GOLD, DANGER]) {
    assert.ok(meetsAA(ON_FILL, relleno), `ON_FILL debe leerse sobre ${relleno}`)
    assert.equal(meetsAA('#ffffff', relleno), false, `blanco sobre ${relleno} NO cumple AA`)
  }
})

test('la tinta principal alcanza AAA (7:1) — se lee de noche y con los ojos cansados', () => {
  assert.ok(contrastRatio(INK, BG) >= 7)
  assert.ok(contrastRatio(INK, PANEL) >= 7)
})

test('BG y PANEL se distinguen entre sí pero sin crear un borde duro', () => {
  const r = contrastRatio(BG, PANEL)
  assert.ok(r > 1.05 && r < 1.5, `separación de superficies fuera de rango: ${r.toFixed(2)}`)
})
