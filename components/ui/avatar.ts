// ============================================================================
// Avatar determinista — geometría pura, sin React y sin red.
//
// POR QUÉ ESTÁ SEPARADO DEL .tsx: `node --test` no sabe cargar un archivo con
// JSX (no hay transpilador y este bloque no añade dependencias). Teniendo la
// geometría en un módulo `.ts` puro, la prueba mide LO QUE DE VERDAD IMPORTA
// —determinismo, distribución de tonos, ausencia de URLs— y `Avatar.tsx` queda
// como lo que debe ser: una traducción directa de estos nodos a JSX.
//
// POR QUÉ NO UNA FOTO NI UNA URL (esto no es una preferencia estética):
//   1. Anonimato. Una cara identifica; un avatar de un servicio externo revela
//      a ese servicio que esta persona estuvo en una app de salud emocional
//      cada vez que se pinta el feed.
//   2. La CSP de `next.config.ts` solo admite `img-src 'self' data: blob:` +
//      Supabase + i.ytimg.com. Un `<img src="https://dicebear…">` lo bloquearía
//      el navegador de todos modos.
//   3. Coste. 20 avatares en un feed son 20 SVG de ~350 bytes ya serializados
//      en el HTML del servidor: cero peticiones, cero JS, cero saltos de layout.
//
// DETERMINISMO ESTRICTO: mismas semillas → mismo dibujo, byte a byte, en
// servidor y en cliente. Sin `Math.random()`, sin `Date`, sin estado de módulo.
// Si esto se rompe, React avisa con un error de hidratación y, peor, la gente
// deja de reconocer a quien ya conocía.
// ============================================================================

/**
 * Semilla de reserva. `profiles.avatar_seed` es `encode(gen_random_bytes(8),
 * 'hex')` y no es nulable, pero un componente de UI no puede caerse porque un
 * bloque le pase `''` desde un estado intermedio de carga.
 */
const SEMILLA_POR_DEFECTO = 'da4ma0000000d16b'

/** Longitud máxima que se hashea. Protege de una semilla absurda (200 chars). */
const MAX_SEMILLA = 64

/**
 * FNV-1a de 32 bits.
 *
 * Elegido sobre un `hashCode` estilo Java porque `avatar_seed` son 16
 * caracteres hexadecimales (0-9a-f): un alfabeto de 16 símbolos y longitud
 * fija. Con `h*31+c` los bits altos apenas se mueven en cadenas cortas del
 * mismo alfabeto y la mitad de la comunidad acaba con el mismo tono. FNV-1a
 * multiplica por un primo de 32 bits DESPUÉS del xor, así que cada carácter
 * afecta a todos los bits. La prueba de distribución sobre 10 000 semillas
 * generadas igual que en la base es la que lo verifica.
 */
export function hashFnv1a(texto: string): number {
  let h = 0x811c9dc5
  const n = Math.min(texto.length, MAX_SEMILLA)
  for (let i = 0; i < n; i++) {
    h ^= texto.charCodeAt(i)
    // Math.imul: multiplicación de 32 bits con desbordamiento, que es
    // exactamente lo que pide FNV. Con `*` normal, JS pasa a coma flotante de
    // 64 bits y pierde los bits bajos: el hash dejaría de ser FNV.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Un nodo del dibujo. Deliberadamente cerrado: tres formas bastan. */
export type NodoAvatar =
  | { readonly tipo: 'rect'; readonly x: number; readonly y: number; readonly ancho: number; readonly alto: number; readonly relleno: string }
  | { readonly tipo: 'circulo'; readonly cx: number; readonly cy: number; readonly r: number; readonly relleno: string }
  | { readonly tipo: 'ruta'; readonly d: string; readonly relleno: string }

export interface DibujoAvatar {
  /** Rotación en grados del grupo de figuras. 0, 90, 180 o 270. */
  readonly rotacion: number
  /** Tono base en grados [0,360). Expuesto para la prueba de distribución. */
  readonly tono: number
  /** Índice de rejilla [0,8). */
  readonly rejilla: number
  readonly nodos: readonly NodoAvatar[]
}

/** Lienzo del SVG. 24 unidades: números de una o dos cifras, SVG más corto. */
export const LIENZO = 24

/**
 * Las 8 rejillas. Cada una son una o dos figuras sobre el fondo, no una malla
 * de 16 celdas: una malla serían hasta 16 `<rect>` (~900 bytes) y el
 * presupuesto de la ficha son 500 por avatar. Con 8 rejillas × 4 rotaciones ×
 * el tono, el espacio de dibujos distintos ya es de decenas de miles.
 *
 * Las figuras pueden salirse del lienzo: el propio `<svg>` recorta (overflow
 * oculto por defecto), así que una esquina de círculo grande sale gratis y no
 * hace falta ni un `clipPath` —que además obligaría a un `id` único por avatar,
 * y 20 ids repetidos en un feed son HTML inválido—.
 */
const REJILLAS: readonly ((c: string) => readonly NodoAvatar[])[] = [
  (c) => [{ tipo: 'circulo', cx: 12, cy: 12, r: 7, relleno: c }],
  (c) => [{ tipo: 'rect', x: 0, y: 0, ancho: 24, alto: 12, relleno: c }],
  (c) => [{ tipo: 'ruta', d: 'M0 24L24 0v24z', relleno: c }],
  (c) => [{ tipo: 'circulo', cx: 0, cy: 0, r: 14, relleno: c }],
  (c) => [
    { tipo: 'rect', x: 0, y: 0, ancho: 12, alto: 12, relleno: c },
    { tipo: 'rect', x: 12, y: 12, ancho: 12, alto: 12, relleno: c },
  ],
  (c) => [{ tipo: 'ruta', d: 'M12 0l12 12-12 12L0 12z', relleno: c }],
  (c) => [{ tipo: 'circulo', cx: 12, cy: 24, r: 10, relleno: c }],
  (c) => [
    { tipo: 'rect', x: 6, y: 0, ancho: 12, alto: 24, relleno: c },
    { tipo: 'circulo', cx: 12, cy: 12, r: 4, relleno: c },
  ],
]

/**
 * Color generado. `hsl()` y no un token: un avatar necesita cientos de tonos
 * distintos y ningún sistema de diseño tiene cientos de tokens. La regla «ni un
 * hex en un componente» se cumple igual —no hay ningún literal de color—, y la
 * saturación y la luminosidad están FIJAS a propósito: si la semilla eligiera
 * también la luminosidad, saldrían avatares casi negros sobre `--bg` y casi
 * blancos sobre `--panel` claro. Con L fija en 56 %/44 % ambos temas funcionan.
 */
const colorBase = (tono: number): string => `hsl(${tono} 58% 56%)`
const colorFigura = (tono: number): string => `hsl(${tono} 62% 42%)`

/**
 * Dibujo del avatar para una semilla.
 *
 * Reparto de bits del hash (cada tramo viene de una zona distinta, para que dos
 * semillas parecidas no compartan tono Y rejilla Y rotación):
 *   bits 0-8   → tono base
 *   bits 9-14  → separación del tono secundario
 *   bits 18-20 → rejilla
 *   bits 24-25 → rotación
 */
export function dibujoAvatar(semilla: string): DibujoAvatar {
  const limpia = semilla.trim()
  const h = hashFnv1a(limpia.length > 0 ? limpia : SEMILLA_POR_DEFECTO)

  const tono = h % 360
  // Separación mínima de 150° para que las dos figuras siempre contrasten en
  // tono; sin el mínimo, salen avatares de un solo color aparente.
  const tono2 = (tono + 150 + ((h >>> 9) % 60)) % 360
  const rejilla = (h >>> 18) % REJILLAS.length
  const rotacion = ((h >>> 24) % 4) * 90

  return {
    rotacion,
    tono,
    rejilla,
    nodos: [
      { tipo: 'rect', x: 0, y: 0, ancho: LIENZO, alto: LIENZO, relleno: colorBase(tono) },
      ...REJILLAS[rejilla]!(colorFigura(tono2)),
    ],
  }
}

/**
 * Texto del `aria-label`. Sin alias, el avatar es decoración pura y el
 * componente lo marca `aria-hidden`: leer «imagen» a quien navega con lector de
 * pantalla, veinte veces por feed, es ruido, no accesibilidad.
 */
export function etiquetaAvatar(alias: string | undefined): string | null {
  const a = alias?.trim()
  return a ? `Avatar de ${a}` : null
}
