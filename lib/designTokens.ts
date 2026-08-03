// ============================================================================
// Tokens de marca de Darma — SSOT para las superficies que no pueden usar
// var(--token) de CSS: emails, PDFs, imágenes Open Graph generadas y cualquier
// sitio donde haya que escribir un hex a mano.
//
// El motivo de que este archivo exista es empírico y se repite en todos los
// proyectos: en cuanto un color hay que teclearlo, aparecen tres versiones de
// ese color y la que ve el usuario acaba siendo la que no es la marca.
//
// ── CONTRASTE: MEDIDO, NO ESTIMADO ─────────────────────────────────────────
// Todos los ratios de este archivo están CALCULADOS con la fórmula de
// luminancia relativa de WCAG 2.1, no estimados a ojo. Si cambias un valor,
// vuelve a calcularlo — `contrastRatio()` está exportada abajo justo para eso,
// y hay un test que verifica los números documentados.
//
// Umbrales WCAG: AA texto normal 4.5:1 · AA texto grande (≥24px, o ≥19px en
// negrita) 3:1 · AAA texto normal 7:1.
//
// Esto NO es burocracia de accesibilidad. Darma se usa de noche, en la cama,
// con el brillo al mínimo y a menudo con los ojos llorosos. Un texto a 3.9:1 es
// perfectamente legible en un monitor calibrado a las once de la mañana y no se
// lee a las tres de la madrugada, que es cuando la app hace falta.
// ============================================================================

// ── Superficies ─────────────────────────────────────────────────────────────
/** Fondo de la app. Casi negro pero con un punto de azul: el negro puro (#000)
 *  produce halo con texto claro en OLED y cansa en lecturas largas. */
export const BG = '#0e1116'

/** Panel/tarjeta, un escalón por encima del fondo. La jerarquía se construye
 *  con luminancia, no con bordes: menos ruido visual en pantallas llenas de
 *  texto de gente contando cosas duras. */
export const PANEL = '#161b22'

/** Tinta principal. 16.82:1 sobre BG y 15.39:1 sobre PANEL — AAA de sobra.
 *  Es blanco roto, no blanco puro: #ffffff sobre #0e1116 da 18.4:1 y produce
 *  fatiga en párrafos largos. */
export const INK = '#eef2f7'

// ── Acentos ─────────────────────────────────────────────────────────────────
/**
 * 🔴 ACENTO PRIMARIO — NO USAR COMO TEXTO NORMAL.
 *
 * Contraste MEDIDO: 4.35:1 sobre BG · 3.98:1 sobre PANEL.
 * Falla AA de texto normal (4.5:1) en LAS DOS superficies. Solo cumple el 3:1
 * de texto grande, y sobre PANEL va justo (3.98).
 *
 * Usos válidos: rellenos, botones, bordes, iconos decorativos, gráficos,
 * titulares grandes. Para texto de párrafo o enlaces en línea usa ACCENT_INK.
 */
export const ACCENT = '#7c5cff'

/**
 * Versión legible del acento, para TEXTO sobre fondo oscuro.
 * Contraste MEDIDO: 6.56:1 sobre BG · 6.00:1 sobre PANEL. AA en ambas.
 * Es el mismo violeta aclarado, no un color nuevo: existe precisamente para que
 * nadie tenga que inventarse un violeta cuando ACCENT no se lee.
 */
export const ACCENT_INK = '#9d86ff'

/**
 * 🔴 Violeta para RELLENO con texto blanco encima.
 * Blanco sobre ACCENT da 4.35:1 — falla AA. Blanco sobre ACCENT_FILL da
 * 5.55:1 — AA. Si haces un botón violeta con texto blanco, el fondo es este.
 */
export const ACCENT_FILL = '#6a45f5'

/** Acento secundario (verde menta): confirmaciones, karma ganado, progreso.
 *  MEDIDO: 9.59:1 sobre BG · 8.77:1 sobre PANEL. AAA como texto.
 *  🔴 Como RELLENO exige tinta OSCURA: blanco sobre #26d0a5 da 1.97:1, que es
 *  ilegible. Con BG encima da 9.59:1. */
export const ACCENT2 = '#26d0a5'

// ── Semántica ───────────────────────────────────────────────────────────────
/** Aviso. MEDIDO: 10.34:1 sobre BG · 9.46:1 sobre PANEL. AAA como texto.
 *  🔴 Como relleno, tinta oscura: blanco sobre #ffb020 da 1.83:1. */
export const WARN = '#ffb020'

/** Error/peligro. MEDIDO: 6.36:1 sobre BG · 5.82:1 sobre PANEL. AA como texto.
 *  🔴 Como relleno, tinta oscura: blanco sobre #ff5d73 da 2.97:1, falla.
 *
 *  NOTA DE PRODUCTO, no de diseño: este rojo NO se usa para el contenido de
 *  crisis. Pintar de rojo el post de alguien que está mal lo señala como una
 *  alarma del sistema en vez de como una persona. La superficie de crisis usa
 *  ACCENT2 (calma) y el rojo se reserva para errores de la aplicación. */
export const DANGER = '#ff5d73'

/** Dorado: logros, niveles, Frutos de bienestar.
 *  MEDIDO: 11.27:1 sobre BG · 10.31:1 sobre PANEL. AAA como texto.
 *  🔴 Como relleno, tinta oscura: blanco sobre #f2c14e da 1.68:1, el peor de
 *  toda la paleta. */
export const GOLD = '#f2c14e'

/** Tinta secundaria (metadatos, marcas de tiempo).
 *  MEDIDO: 7.74:1 sobre BG · 7.08:1 sobre PANEL. AAA. */
export const MUTED = '#9aa7b8'

/**
 * Tinta que va ENCIMA de cualquier relleno claro (ACCENT2, WARN, GOLD, DANGER).
 * Es el mismo valor que BG, pero NO es lo mismo conceptualmente y no debe
 * fusionarse: BG es una superficie y podría cambiar el día que exista tema
 * claro; ON_FILL es tinta sobre un relleno de color fijo y no cambia nunca.
 */
export const ON_FILL = '#0e1116'

/**
 * Resumen legible por máquina de qué se puede usar como texto y qué no.
 * Existe para que la revisión de un PR pueda comprobarlo sin releer los
 * comentarios, y para el test que verifica los ratios documentados.
 */
export const TEXT_SAFETY = {
  ink: { hex: INK, onBg: 16.82, onPanel: 15.39, safeAsBodyText: true },
  muted: { hex: MUTED, onBg: 7.74, onPanel: 7.08, safeAsBodyText: true },
  accent: { hex: ACCENT, onBg: 4.35, onPanel: 3.98, safeAsBodyText: false },
  accentInk: { hex: ACCENT_INK, onBg: 6.56, onPanel: 6.0, safeAsBodyText: true },
  accent2: { hex: ACCENT2, onBg: 9.59, onPanel: 8.77, safeAsBodyText: true },
  warn: { hex: WARN, onBg: 10.34, onPanel: 9.46, safeAsBodyText: true },
  danger: { hex: DANGER, onBg: 6.36, onPanel: 5.82, safeAsBodyText: true },
  gold: { hex: GOLD, onBg: 11.27, onPanel: 10.31, safeAsBodyText: true },
} as const

/** Paleta agrupada, para pasarla entera a un generador de imágenes OG o a una
 *  plantilla de email. */
export const DARMA_PALETTE = {
  bg: BG,
  panel: PANEL,
  ink: INK,
  muted: MUTED,
  accent: ACCENT,
  accentInk: ACCENT_INK,
  accentFill: ACCENT_FILL,
  accent2: ACCENT2,
  warn: WARN,
  danger: DANGER,
  gold: GOLD,
  onFill: ON_FILL,
} as const

// ── Tipografía ──────────────────────────────────────────────────────────────
// En email y PDF hay que declarar fallbacks reales: ningún cliente de correo
// carga tus woff2 y algunos ni siquiera respetan @font-face.
export const FONT_DISPLAY = "'Outfit', 'Segoe UI', Arial, sans-serif"
export const FONT_BODY = "'Inter', 'Segoe UI', Arial, sans-serif"
export const FONT_MONO = "ui-monospace, 'SF Mono', 'Courier New', monospace"

// ── Escalas ─────────────────────────────────────────────────────────────────
/** Espaciado base 4px. Una sola escala evita el "16, 18, 20, 21" que aparece
 *  en cuanto cada pantalla decide su propio margen. */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 } as const

/** Radios. Generosos a propósito: las esquinas duras leen como "sistema" y
 *  Darma no quiere leerse como un sistema. */
export const RADIUS = { sm: 8, md: 12, lg: 20, pill: 999 } as const

// ── Utilidad de verificación ────────────────────────────────────────────────

/** Luminancia relativa WCAG 2.1 de un color #rrggbb. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`[darma] color no válido: ${hex}`)
  const int = parseInt(m[1]!, 16)

  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

/**
 * Ratio de contraste WCAG entre dos colores. Simétrico.
 * Úsala ANTES de documentar un número en este archivo; no estimes.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** ¿Cumple AA para texto normal (4.5:1)? */
export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5
}

/** ¿Cumple AA para texto grande (3:1)? */
export function meetsAALarge(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 3
}
