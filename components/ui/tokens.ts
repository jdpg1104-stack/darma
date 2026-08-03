// ============================================================================
// Tokens DERIVADOS del sistema de diseño.
//
// Los tokens base viven en `app/globals.css` (dueño F4) y no se tocan. Aquí
// solo hay lo que este bloque necesita y no existe allí, expresado siempre como
// una cadena CSS que el navegador resuelve: `var(--x)` o `color-mix(...)`.
// Ningún valor de este archivo es un color literal — el único `#000` que
// aparece es el negro puro con el que se oscurece una mezcla, no un color de
// marca.
//
// Por qué en TypeScript y no solo en CSS: los CSS Modules no se pueden importar
// desde una prueba de Node, y estos valores son justamente los que hay que
// verificar (ver la tabla medida en `contraste.ts`). Teniéndolos aquí, la
// prueba resuelve la mezcla con `mezclarOklab()` y mide el ratio real.
// ============================================================================

import type { KarmaLevel } from '@/lib/karma'

/**
 * Nivel público de una persona. Alias de `KarmaLevel` de `lib/karma.ts`:
 * `CONTRATOS.md` §2 lo llama `Nivel` y los doce bloques que consumen esta UI
 * leen ese documento, así que el nombre del contrato tiene que existir.
 * Es un alias, no un tipo nuevo: si `lib/karma.ts` añade un nivel, esto lo
 * hereda y el compilador rompe en todos los sitios a la vez, que es lo que
 * queremos. (Pedido a F3 en PEDIDOS.md para que `Nivel` salga de `lib/karma`.)
 */
export type Nivel = KarmaLevel

/**
 * Violeta de RELLENO para el botón primario.
 *
 * `--accent` (#7c5cff) con texto blanco encima da 4,35:1 y AA pide 4,5:1. Falla
 * por 0,15, y `font-weight: 700` a 16 px NO cuenta como texto grande (eso
 * empieza en 18,66 px en negrita). Oscurecer un 14 % en oklab —que preserva el
 * tono percibido mucho mejor que hacerlo en sRGB— lo lleva a **6,10:1**: AA con
 * margen, y el violeta se sigue percibiendo como el mismo violeta.
 *
 * Se expone como cadena y NO como hex a propósito: si F4 cambia `--accent`,
 * esto se mueve con él en vez de quedarse desincronizado.
 * Anotado en PEDIDOS.md para que F4 lo promueva a token global.
 */
export const ACCENT_FILL = 'color-mix(in oklab, var(--accent) 86%, #000)'

/**
 * Nivel → token de color. Es la ÚNICA fuente de qué color le corresponde a cada
 * nivel; ningún componente decide el suyo.
 *
 * Ojo: son los tokens BASE. Como color de texto solo valen en tema oscuro (ver
 * la tabla de `contraste.ts`); en tema claro los componentes usan las variantes
 * `--darma-*-ui`, que `light-dark()` intercambia solo. Por eso este mapa se usa
 * para aros, bordes y símbolos, nunca para pintar un párrafo.
 */
export const COLOR_POR_NIVEL: Readonly<Record<Nivel, string>> = {
  semilla: 'var(--muted)',
  brote: 'var(--accent2)',
  guia: 'var(--accent)',
  mentor: 'var(--gold)',
}

/**
 * Escala de tamaños del Avatar, en píxeles. Cerrada a propósito: con un `number`
 * libre aparecen catorce tamaños distintos en seis pantallas y el feed deja de
 * tener ritmo vertical.
 *   24 → en línea con texto · 32 → comentario · 40 → tarjeta de post
 *   56 → cabecera de hilo   · 80 → perfil
 */
export const TAMANOS_AVATAR = [24, 32, 40, 56, 80] as const

/**
 * Variantes legibles de los acentos para TEMA CLARO.
 *
 * El hallazgo que las hace necesarias: sobre blanco, `--danger` da 2,97:1 —no
 * llega ni al 3:1 que WCAG exige a un icono— y `--accent2` da 1,97:1. Un icono
 * de crisis invisible en tema claro no es un detalle estético.
 *
 * Se aplican con `light-dark()`, que lee el `color-scheme` que ya declara
 * `globals.css`: en oscuro devuelve el token tal cual (donde ya cumple de
 * sobra), en claro la mezcla. Una sola declaración, sin duplicar los dos
 * selectores de tema, y sin tocar nada de F4.
 *
 * El porcentaje de cada mezcla está elegido por medición, no a ojo: es el más
 * alto (= el más fiel al color de marca) que supera su umbral. Ver
 * PARES_CONTRASTE en `contraste.ts`.
 */
export const MEZCLAS_TEMA_CLARO = {
  /** #be4354 · 5,10:1 sobre --panel claro. Icono y borde del BotonCrisis. */
  danger: { token: 'var(--danger)', pct: 0.8 },
  /** #10745a · 5,73:1. Relleno del MedidorKarma y acento de Tarjeta. */
  accent2: { token: 'var(--accent2)', pct: 0.65 },
  /** #795f23 · 6,05:1. Símbolo de nivel e Insignia. */
  gold: { token: 'var(--gold)', pct: 0.6 },
  /** #6b4fde · 5,53:1. Aro de nivel guía y bordes de acento. */
  accent: { token: 'var(--accent)', pct: 0.9 },
  /** #865b0b · 5,97:1. Chip de aviso. */
  warn: { token: 'var(--warn)', pct: 0.62 },
} as const

/** Nombre de la custom property que cada componente declara para un acento. */
export type ClaveMezcla = keyof typeof MEZCLAS_TEMA_CLARO

/**
 * Genera la declaración `light-dark(...)` de un acento. Documenta el patrón que
 * los `.module.css` escriben a mano (un CSS Module no puede importar de aquí),
 * y da a la prueba el valor exacto que verificar.
 */
export function tokenLegible(clave: ClaveMezcla): string {
  const { token, pct } = MEZCLAS_TEMA_CLARO[clave]
  return `light-dark(color-mix(in oklab, ${token} ${Math.round(pct * 100)}%, #000), ${token})`
}
