// ============================================================================
// Contraste WCAG 2.1 — la red de seguridad del sistema de diseño
//
// Este es el ÚNICO archivo del bloque B16 donde se escribe un hex, y es a
// propósito: para comprobar un ratio hay que resolver el color, y `var(--x)` no
// se puede resolver fuera del navegador. Los valores de aquí son una COPIA de
// lectura de los tokens de `app/globals.css` (dueño F4) hecha para poder
// medirlos; ningún componente los importa para pintar.
//
// Por qué existe: un sistema de diseño se degrada por acumulación de retoques
// pequeños ("subo un poco el gris de los metadatos"), no por una decisión mala.
// La prueba de `ui.test.ts` recorre PARES_CONTRASTE y falla si alguien mueve un
// token por debajo de su mínimo. Sin esa prueba, la degradación es invisible
// hasta que alguien no puede leer la app.
//
// Y no es burocracia: Darma se usa de noche, con el brillo al mínimo y a veces
// llorando. Un texto a 3,9:1 se lee perfectamente en un monitor a las once de
// la mañana y no se lee a las tres de la madrugada, que es cuando hace falta.
//
// ── UMBRALES ────────────────────────────────────────────────────────────────
//   AA texto normal ............ 4,5:1
//   AA texto grande ............ 3:1   (≥24 px, o ≥18,66 px en negrita)
//   AA componentes y gráficos .. 3:1   (bordes, iconos, indicadores de estado)
//   AAA texto normal ........... 7:1
//
// ── TABLA MEDIDA (WCAG 2.1, calculada con ratioContraste, no estimada) ───────
// Es la tabla de §Seguridad de HANDOFF/B16.md, verificada aquí una a una. Donde
// el número real difiere del de la ficha, manda el de aquí y se anota.
//
// | Par                                             | Ratio  | Veredicto                                  |
// |-------------------------------------------------|--------|--------------------------------------------|
// | --accent #7c5cff sobre --bg oscuro #0e1116      |  4,35  | ✅ componente/texto grande · ❌ texto normal |
// | --accent #7c5cff sobre blanco #ffffff           |  4,35  | ❌ texto normal, en claro tampoco           |
// | --on-accent #ffffff sobre relleno --accent      |  4,35  | ❌ por 0,15 → usar ACCENT_FILL             |
// | --on-accent #ffffff sobre ACCENT_FILL #644ad1   |  6,10  | ✅ AA (la ficha estimaba ~5,2; es mejor)   |
// | --accent2 #26d0a5 sobre --bg oscuro             |  9,59  | ✅ texto en tema oscuro                     |
// | --accent2 #26d0a5 sobre --panel claro #ffffff   |  1,97  | ❌ invisible → solo relleno en claro        |
// | --on-accent2 #06201a sobre relleno --accent2    |  8,66  | ✅                                          |
// | --danger #ff5d73 sobre --bg oscuro              |  6,36  | ✅ oscuro                                   |
// | --danger #ff5d73 sobre blanco #ffffff           |  2,97  | ❌ ni como texto NI como icono/borde (<3)   |
// | --gold #f2c14e sobre --bg oscuro                | 11,27  | ✅ oscuro                                   |
// | --gold #f2c14e sobre blanco #ffffff             |  1,68  | ❌ claro                                    |
// | --muted #9aa7b8 sobre --panel2 #1c232d          |  6,47  | ✅                                          |
// | --muted #5b6879 sobre #ffffff (tema claro)      |  5,67  | ✅ (la ficha decía 5,68; diferencia de redondeo) |
//
// ── DERIVADOS DE ESTE BLOQUE (color-mix en oklab, ver tokens.ts) ─────────────
// El hallazgo importante: en TEMA CLARO los cuatro acentos fallan incluso el
// 3:1 de componente. --danger sobre blanco da 2,97 — un icono de crisis que no
// se distingue del fondo. Por eso cada acento tiene una variante «legible»
// mezclada con negro en oklab, activada con light-dark(). Medidas:
//
// | Derivado (tema claro)                     | Resuelve | Sobre --panel | Sobre --panel2 |
// |-------------------------------------------|----------|---------------|----------------|
// | ACCENT_FILL   = accent  86% + #000        | #644ad1  | 6,10 (blanco encima) | —        |
// | --darma-danger-ui  = danger  80% + #000   | #be4354  | 5,10          | 4,53           |
// | --darma-accent2-ui = accent2 65% + #000   | #10745a  | 5,73          | 5,09           |
// | --darma-gold-ui    = gold    60% + #000   | #795f23  | 6,05          | 5,38           |
// | --darma-accent-ui  = accent  90% + #000   | #6b4fde  | 5,53          | 4,92           |
//
// En tema oscuro las variantes «-ui» son el token tal cual (9,59 / 6,36 /
// 11,27 / 3,98 sobre --panel), así que light-dark() no las toca.
// ============================================================================

/** Umbral AA para texto normal. */
export const AA_TEXTO = 4.5
/** Umbral AA para texto grande (≥24 px, o ≥18,66 px en negrita) y para
 *  componentes de interfaz: bordes, iconos e indicadores de estado. */
export const AA_GRANDE = 3

const HEX = /^#([0-9a-f]{6})$/i

/**
 * Luminancia relativa WCAG 2.1 de un `#rrggbb`.
 *
 * Lanza `TypeError` con un hex inválido en vez de devolver `NaN`: un `NaN` hace
 * que TODA comparación posterior sea `false`, y una comprobación de contraste
 * que nunca se cumple es indistinguible de una que nunca se ejecuta. Preferimos
 * que reviente la prueba a que apruebe en silencio.
 */
export function luminanciaRelativa(hex: string): number {
  const m = HEX.exec(hex.trim())
  if (!m) throw new TypeError(`[darma/ui] color no válido: ${hex}`)

  const entero = Number.parseInt(m[1]!, 16)
  const canales = [(entero >> 16) & 0xff, (entero >> 8) & 0xff, entero & 0xff].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * canales[0]! + 0.7152 * canales[1]! + 0.0722 * canales[2]!
}

/** Ratio de contraste WCAG 2.1 entre dos colores. Simétrico: (L1+0,05)/(L2+0,05). */
export function ratioContraste(a: string, b: string): number {
  const la = luminanciaRelativa(a)
  const lb = luminanciaRelativa(b)
  const [alto, bajo] = la > lb ? [la, lb] : [lb, la]
  return (alto + 0.05) / (bajo + 0.05)
}

/**
 * ¿El par cumple AA?
 *
 * @param grande `true` para texto ≥24 px (o ≥18,66 px en negrita) y para
 *        componentes de interfaz (bordes, iconos): el umbral baja a 3:1.
 *        Ojo: `font-weight: 700` a 16 px NO es texto grande.
 */
export function cumpleAA(texto: string, fondo: string, grande = false): boolean {
  return ratioContraste(texto, fondo) >= (grande ? AA_GRANDE : AA_TEXTO)
}

// ── color-mix(in oklab, …) reproducido en TypeScript ────────────────────────
// Los tokens derivados de tokens.ts son cadenas `color-mix(...)` que solo el
// navegador resuelve. Sin esta función, la tabla de arriba sería justo lo que
// este archivo existe para impedir: números estimados. Con ella, la prueba
// resuelve el mismo color que pintará el navegador y mide el ratio de verdad.

const aLineal = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const aGamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

function aOklab(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim())
  if (!m) throw new TypeError(`[darma/ui] color no válido: ${hex}`)
  const entero = Number.parseInt(m[1]!, 16)
  const [r, g, b] = [(entero >> 16) & 0xff, (entero >> 8) & 0xff, entero & 0xff].map((c) =>
    aLineal(c / 255),
  ) as [number, number, number]

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m2 = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return [
    0.2104542553 * l + 0.793617785 * m2 - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m2 + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m2 - 0.808675766 * s,
  ]
}

function desdeOklab(L: number, A: number, B: number): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3

  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(Math.min(1, Math.max(0, aGamma(v))) * 255))

  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Equivalente de `color-mix(in oklab, a <pct>%, b)`.
 * @param pct fracción [0,1] del primer color. 0,86 = «86 %».
 */
export function mezclarOklab(a: string, b: string, pct: number): string {
  const A = aOklab(a)
  const B = aOklab(b)
  return desdeOklab(
    A[0] * pct + B[0] * (1 - pct),
    A[1] * pct + B[1] * (1 - pct),
    A[2] * pct + B[2] * (1 - pct),
  )
}

// ── La tabla, legible por máquina ───────────────────────────────────────────

/** Superficies de referencia, copiadas de `app/globals.css`. */
export const SUPERFICIES = {
  oscuro: { bg: '#0e1116', panel: '#161b22', panel2: '#1c232d', ink: '#eef2f7', muted: '#9aa7b8' },
  claro: { bg: '#f6f8fb', panel: '#ffffff', panel2: '#eef2f7', ink: '#131820', muted: '#5b6879' },
} as const

/** Acentos. Invariantes al tema: en `globals.css` no se redefinen en claro. */
export const ACENTOS = {
  accent: '#7c5cff',
  accent2: '#26d0a5',
  warn: '#ffb020',
  danger: '#ff5d73',
  gold: '#f2c14e',
  onAccent: '#ffffff',
  onAccent2: '#06201a',
} as const

export interface ParContraste {
  /** Qué combinación es, en palabras. */
  readonly nombre: string
  readonly texto: string
  readonly fondo: string
  /** Ratio MEDIDO con ratioContraste. La prueba verifica que sigue siendo este. */
  readonly ratio: number
  /** Umbral exigido a ESTE par según su uso real en los componentes. */
  readonly minimo: number
  /** Dónde se usa. Si un par no se usa en ningún sitio, no debería estar aquí. */
  readonly uso: string
}

/**
 * Todos los pares que los componentes de este bloque pintan de verdad, más los
 * pares prohibidos que la ficha documenta (con `minimo: 0`, porque lo que se
 * verifica de ellos es que SIGUEN fallando: si un día `--accent` sobre blanco
 * pasara de 4,5, querríamos enterarnos, no que el aviso caducara en silencio).
 */
export const PARES_CONTRASTE: readonly ParContraste[] = [
  // ── Texto principal y secundario, las dos superficies, los dos temas ──────
  { nombre: 'ink sobre bg (oscuro)', texto: '#eef2f7', fondo: '#0e1116', ratio: 16.82, minimo: AA_TEXTO, uso: 'texto de la app' },
  { nombre: 'ink sobre panel (oscuro)', texto: '#eef2f7', fondo: '#161b22', ratio: 15.39, minimo: AA_TEXTO, uso: 'Tarjeta, Dialogo, BotonCrisis' },
  { nombre: 'ink sobre panel2 (oscuro)', texto: '#eef2f7', fondo: '#1c232d', ratio: 14.07, minimo: AA_TEXTO, uso: 'Chip, Boton secundario' },
  { nombre: 'ink sobre panel (claro)', texto: '#131820', fondo: '#ffffff', ratio: 17.81, minimo: AA_TEXTO, uso: 'Tarjeta, Dialogo, BotonCrisis' },
  { nombre: 'ink sobre panel2 (claro)', texto: '#131820', fondo: '#eef2f7', ratio: 15.84, minimo: AA_TEXTO, uso: 'Chip, Boton secundario' },
  { nombre: 'muted sobre panel (oscuro)', texto: '#9aa7b8', fondo: '#161b22', ratio: 7.08, minimo: AA_TEXTO, uso: 'descripción de EstadoVacio, metadatos' },
  { nombre: 'muted sobre panel2 (oscuro)', texto: '#9aa7b8', fondo: '#1c232d', ratio: 6.47, minimo: AA_TEXTO, uso: 'Chip neutro, pista del MedidorKarma' },
  { nombre: 'muted sobre panel (claro)', texto: '#5b6879', fondo: '#ffffff', ratio: 5.67, minimo: AA_TEXTO, uso: 'descripción de EstadoVacio, metadatos' },
  { nombre: 'muted sobre panel2 (claro)', texto: '#5b6879', fondo: '#eef2f7', ratio: 5.05, minimo: AA_TEXTO, uso: 'Chip neutro, pista del MedidorKarma' },
  { nombre: 'muted sobre bg (claro)', texto: '#5b6879', fondo: '#f6f8fb', ratio: 5.33, minimo: AA_TEXTO, uso: 'Boton fantasma' },

  // ── Rellenos con tinta encima. Invariantes al tema. ───────────────────────
  { nombre: 'on-accent sobre ACCENT_FILL', texto: '#ffffff', fondo: '#644ad1', ratio: 6.1, minimo: AA_TEXTO, uso: 'Boton primario — el motivo de que ACCENT_FILL exista' },
  { nombre: 'on-accent2 sobre accent2', texto: '#06201a', fondo: '#26d0a5', ratio: 8.66, minimo: AA_TEXTO, uso: 'Insignia de mentor rellena, Chip de logro relleno' },
  { nombre: 'on-accent2 sobre danger', texto: '#06201a', fondo: '#ff5d73', ratio: 5.75, minimo: AA_TEXTO, uso: 'Boton variante peligro' },
  { nombre: 'on-accent2 sobre gold', texto: '#06201a', fondo: '#f2c14e', ratio: 10.18, minimo: AA_TEXTO, uso: 'Insignia rellena' },
  { nombre: 'on-accent2 sobre warn', texto: '#06201a', fondo: '#ffb020', ratio: 9.34, minimo: AA_TEXTO, uso: 'Chip de aviso relleno' },

  // ── Bordes, iconos e indicadores: 3:1 basta, pero hay que cumplirlo. ──────
  { nombre: 'ACCENT_FILL sobre bg (oscuro) — borde del botón', texto: '#644ad1', fondo: '#0e1116', ratio: 3.1, minimo: AA_GRANDE, uso: 'silueta del Boton primario sobre el fondo' },
  { nombre: 'ACCENT_FILL sobre bg (claro) — borde del botón', texto: '#644ad1', fondo: '#f6f8fb', ratio: 5.73, minimo: AA_GRANDE, uso: 'silueta del Boton primario sobre el fondo' },
  { nombre: 'danger sobre panel (oscuro) — icono de crisis', texto: '#ff5d73', fondo: '#161b22', ratio: 5.82, minimo: AA_GRANDE, uso: 'BotonCrisis: borde e icono' },
  { nombre: 'danger-ui sobre panel (claro) — icono de crisis', texto: '#be4354', fondo: '#ffffff', ratio: 5.1, minimo: AA_GRANDE, uso: 'BotonCrisis: borde e icono' },
  { nombre: 'accent2 sobre panel (oscuro) — barra de progreso', texto: '#26d0a5', fondo: '#161b22', ratio: 8.77, minimo: AA_GRANDE, uso: 'MedidorKarma, acento de Tarjeta' },
  { nombre: 'accent2-ui sobre panel (claro) — barra de progreso', texto: '#10745a', fondo: '#ffffff', ratio: 5.73, minimo: AA_GRANDE, uso: 'MedidorKarma, acento de Tarjeta' },
  { nombre: 'accent2 sobre panel2 (oscuro) — relleno del medidor', texto: '#26d0a5', fondo: '#1c232d', ratio: 8.02, minimo: AA_GRANDE, uso: 'MedidorKarma sobre su carril' },
  { nombre: 'accent2-ui sobre panel2 (claro) — relleno del medidor', texto: '#10745a', fondo: '#eef2f7', ratio: 5.09, minimo: AA_GRANDE, uso: 'MedidorKarma sobre su carril' },
  { nombre: 'gold sobre panel (oscuro) — símbolo de nivel', texto: '#f2c14e', fondo: '#161b22', ratio: 10.31, minimo: AA_GRANDE, uso: 'Insignia de mentor, acento de logro' },
  { nombre: 'gold-ui sobre panel (claro) — símbolo de nivel', texto: '#795f23', fondo: '#ffffff', ratio: 6.05, minimo: AA_GRANDE, uso: 'Insignia de mentor, acento de logro' },
  { nombre: 'accent-ui sobre panel (claro) — aro de nivel guía', texto: '#6b4fde', fondo: '#ffffff', ratio: 5.53, minimo: AA_GRANDE, uso: 'Avatar con aro, Insignia de guía' },
  { nombre: 'accent sobre panel (oscuro) — aro de nivel guía', texto: '#7c5cff', fondo: '#161b22', ratio: 3.98, minimo: AA_GRANDE, uso: 'Avatar con aro, Insignia de guía' },

  // ── Pares PROHIBIDOS. minimo 0: se verifica el número, no que aprueben. ───
  { nombre: '⛔ accent como texto sobre bg oscuro', texto: '#7c5cff', fondo: '#0e1116', ratio: 4.35, minimo: 0, uso: 'PROHIBIDO como texto normal: falla AA por 0,15' },
  { nombre: '⛔ accent como texto sobre blanco', texto: '#7c5cff', fondo: '#ffffff', ratio: 4.35, minimo: 0, uso: 'PROHIBIDO como texto normal en tema claro' },
  { nombre: '⛔ on-accent blanco sobre relleno accent', texto: '#ffffff', fondo: '#7c5cff', ratio: 4.35, minimo: 0, uso: 'PROHIBIDO: por eso el Boton primario usa ACCENT_FILL' },
  { nombre: '⛔ accent2 sobre panel claro', texto: '#26d0a5', fondo: '#ffffff', ratio: 1.97, minimo: 0, uso: 'PROHIBIDO en tema claro, ni como icono' },
  { nombre: '⛔ danger sobre panel claro', texto: '#ff5d73', fondo: '#ffffff', ratio: 2.97, minimo: 0, uso: 'PROHIBIDO en claro: ni siquiera llega al 3:1 de icono' },
  { nombre: '⛔ gold sobre panel claro', texto: '#f2c14e', fondo: '#ffffff', ratio: 1.68, minimo: 0, uso: 'PROHIBIDO en tema claro' },
]
