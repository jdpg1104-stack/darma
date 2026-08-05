// ============================================================================
// Tests del generador de assets de marca.
//
// El test que de verdad importa es el primero: los CINCO PNG que anuncia el
// manifest y el layout EXISTEN en public/ y miden lo que dicen medir. Un
// og.png anunciado y roto es peor que ninguno (era el motivo por el que el
// layout no anunciaba imagen), y un icono del manifest con dimensiones
// mentirosas es un icono que Android descarta en silencio.
//
// El resto fija los contratos de extracción: los tokens salen de globals.css
// y el lema del catálogo — si cualquiera de los dos cambia de forma, el
// script debe FALLAR (y regenerarse los assets), no congelar la marca vieja.
//
// A propósito NO se ejecuta la generación aquí: rasterizar exige sharp (la
// copia que vive bajo node_modules/next) y tarda; la suite corre en cada
// push. Se verifica el ARTEFACTO comprometido, no el proceso.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ASSETS_GENERADOS,
  componerOgSvg,
  dimensionesPng,
  extraerLema,
  extraerTokens,
  familiaParaSvg,
  sinComentariosXml,
  verificarHexesDelIcono,
} from './generarAssets.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

const CSS_REAL = readFileSync(join(RAIZ, 'app', 'globals.css'), 'utf8')
const CATALOGO_REAL = readFileSync(join(RAIZ, 'messages', 'es.json'), 'utf8')

// ── Los artefactos comprometidos ────────────────────────────────────────────

test('los cinco PNG existen en public/ y miden exactamente lo declarado', () => {
  for (const [nombre, esperado] of Object.entries(ASSETS_GENERADOS)) {
    const bytes = readFileSync(join(RAIZ, 'public', nombre))
    const real = dimensionesPng(bytes)
    assert.deepEqual(
      real,
      { ancho: esperado.ancho, alto: esperado.alto },
      `${nombre}: mide ${real.ancho}×${real.alto} y debía medir ${esperado.ancho}×${esperado.alto}. ` +
        'Regenera con: node --experimental-strip-types scripts/design/generarAssets.ts',
    )
  }
})

test('el manifest no anuncia ningún icono PNG que no exista o mienta de tamaño', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(RAIZ, 'public', 'manifest.json'), 'utf8'))
  assert.ok(typeof manifest === 'object' && manifest !== null, 'manifest.json no es un objeto')
  const iconos = (manifest as { icons?: Array<{ src: string; sizes: string; type: string }> }).icons
  assert.ok(Array.isArray(iconos) && iconos.length > 0, 'manifest.json sin icons')

  const pngs = iconos.filter((i) => i.type === 'image/png')
  assert.ok(pngs.length >= 4, 'el manifest debe anunciar los cuatro PNG (any y maskable, 192 y 512)')

  for (const icono of pngs) {
    const bytes = readFileSync(join(RAIZ, 'public', icono.src.replace(/^\//, '')))
    const real = dimensionesPng(bytes)
    assert.equal(
      icono.sizes,
      `${real.ancho}x${real.alto}`,
      `${icono.src}: el manifest declara ${icono.sizes} y el archivo mide ${real.ancho}×${real.alto}`,
    )
  }
})

// ── Extracción de tokens ────────────────────────────────────────────────────

test('extraerTokens lee los tokens reales de globals.css como hex planos', () => {
  const tokens = extraerTokens(CSS_REAL)
  for (const clave of ['bg', 'ink', 'muted', 'accent', 'accent2'] as const) {
    assert.match(tokens[clave], /^#[0-9a-f]{6}$/i, `--${clave} no es un hex plano`)
  }
  // La pila del sistema, normalizada para un atributo XML: sin comillas dobles.
  assert.ok(tokens.fontSans.includes('system-ui'))
  assert.ok(!tokens.fontSans.includes('"'))
})

test('extraerTokens falla si un token desaparece, en vez de inventar un color', () => {
  assert.throws(() => extraerTokens(':root { --bg: #0e1116; }'), /--ink/)
})

test('familiaParaSvg colapsa el valor multilínea y cambia las comillas', () => {
  assert.equal(familiaParaSvg('system-ui,\n    "Segoe UI",  Roboto'), "system-ui, 'Segoe UI', Roboto")
})

// ── El lema ─────────────────────────────────────────────────────────────────

test('el lema sale EXACTO del catálogo, no de una copia en el script', () => {
  assert.equal(extraerLema(CATALOGO_REAL), 'escuchar es lo que da derecho a hablar')
})

test('extraerLema falla si el título del catálogo cambia de forma', () => {
  assert.throws(() => extraerLema('{"comun":{"og":{"titulo":"Otra cosa"}}}'), /ya no encaja/)
  assert.throws(() => extraerLema('{"comun":{}}'), /comun\.og\.titulo/)
})

// ── Composición del OG ──────────────────────────────────────────────────────

test('el SVG del OG lleva el lema, los tokens y el lienzo 1200×630', () => {
  const tokens = extraerTokens(CSS_REAL)
  const svg = componerOgSvg(tokens, 'escuchar es lo que da derecho a hablar')
  assert.ok(svg.includes('width="1200" height="630"'))
  assert.ok(svg.includes('escuchar es lo que da derecho a hablar'))
  assert.ok(svg.includes(tokens.bg) && svg.includes(tokens.ink) && svg.includes(tokens.accent))
  // El texto va escapado: un lema con `&` no debe romper el XML.
  assert.ok(componerOgSvg(tokens, 'a & b').includes('a &amp; b'))
})

// ── Guardas de los SVG fuente ───────────────────────────────────────────────

test('los SVG del icono solo pintan hexes que son tokens de globals.css', () => {
  const tokens = extraerTokens(CSS_REAL)
  for (const archivo of ['icono-darma.svg', 'icono-darma-maskable.svg']) {
    const svg = sinComentariosXml(readFileSync(join(RAIZ, 'public', archivo), 'utf8'))
    verificarHexesDelIcono(svg, tokens) // lanza si hay un hex inventado
  }
  assert.throws(() => verificarHexesDelIcono('<rect fill="#ff0000"/>', tokens), /#ff0000/)
})

test('sinComentariosXml quita los comentarios con dobles guiones que librsvg rechaza', () => {
  assert.equal(sinComentariosXml('<svg><!-- --bg y --accent --><rect/></svg>'), '<svg><rect/></svg>')
})

// ── Lector de IHDR ──────────────────────────────────────────────────────────

test('dimensionesPng rechaza lo que no es un PNG', () => {
  assert.throws(() => dimensionesPng(Buffer.from('<svg></svg>')), /firma/)
})
