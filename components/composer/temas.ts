// ============================================================================
// Temas del composer — lista CERRADA
//
// Cerrada y no texto libre por una razón de escala, no de estética: B02 (feed) y
// B06 (ranking) filtran e indexan por `posts.topic`. Con texto libre habría que
// normalizar acentos, mayúsculas y sinónimos en cada consulta —o guardar una
// columna derivada que se desincroniza—, y «Ansiedad», «ansiedad » y «ANSIEDAD»
// serían tres temas distintos en el mismo índice.
//
// La lista es corta a propósito. Veinte temas obligan a elegir y elegir cuesta
// justo cuando la persona menos capacidad tiene de decidir nada; `otro` existe
// para que nadie se quede sin publicar por no encontrarse en la lista.
// ============================================================================

export const TEMAS = [
  'ansiedad',
  'duelo',
  'soledad',
  'trabajo',
  'familia',
  'pareja',
  'salud',
  'identidad',
  'dinero',
  'otro',
] as const

export type TemaDarma = (typeof TEMAS)[number]

/**
 * La etiqueta visible NO vive aquí: está en el catálogo, bajo
 * `publicar.temas.<valor>`. El valor es lo que viaja a la base de datos y no
 * puede cambiar; el copy sí cambia —y además cambia con el idioma—, así que se
 * resuelve al pintar con `t('publicar.temas.' + valor)`.
 */
export function esTemaDarma(valor: unknown): valor is TemaDarma {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor)
}

// ── Tipo de publicación ─────────────────────────────────────────────────────
// Espejo del enum `public.post_kind` de 0001_core.sql. Si divergen, la base
// rechaza un valor que la UI ofreció.

export const TIPOS_POST = ['desahogo', 'pregunta', 'gratitud'] as const
export type TipoPost = (typeof TIPOS_POST)[number]

/**
 * Igual que los temas: la etiqueta está en `publicar.tipos.<valor>` y la línea
 * que explica qué se espera de cada tipo, en `publicar.ayudaTipo.<valor>`.
 * `feed/TarjetaPost.tsx` pinta el chip del tipo con esas mismas claves, así que
 * la etiqueta de un post es la misma en el composer y en el feed.
 */
export function esTipoPost(valor: unknown): valor is TipoPost {
  return typeof valor === 'string' && (TIPOS_POST as readonly string[]).includes(valor)
}

// ── Longitud del cuerpo ─────────────────────────────────────────────────────
// COPIA LITERAL del CHECK de `posts.body` en 0001_core.sql:
//   check (char_length(body) between 20 and 5000)
// Si aquí pusiéramos otro número, la base rechazaría textos que la UI aceptó y
// la persona vería un error genérico después de haber escrito.
export const CUERPO_MIN = 20
export const CUERPO_MAX = 5000
/** A partir de aquí el contador avisa en ámbar: queda poco, no se ha pasado. */
export const CUERPO_AVISO = 4500
