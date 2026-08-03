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

/** Etiqueta visible. Se separa del valor porque el valor viaja a la base de
 *  datos y no puede cambiar; la etiqueta es copy y sí puede. */
export const ETIQUETA_TEMA: Readonly<Record<TemaDarma, string>> = {
  ansiedad: 'Ansiedad',
  duelo: 'Duelo',
  soledad: 'Soledad',
  trabajo: 'Trabajo',
  familia: 'Familia',
  pareja: 'Pareja',
  salud: 'Salud',
  identidad: 'Identidad',
  dinero: 'Dinero',
  otro: 'Otro',
}

export function esTemaDarma(valor: unknown): valor is TemaDarma {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor)
}

// ── Tipo de publicación ─────────────────────────────────────────────────────
// Espejo del enum `public.post_kind` de 0001_core.sql. Si divergen, la base
// rechaza un valor que la UI ofreció.

export const TIPOS_POST = ['desahogo', 'pregunta', 'gratitud'] as const
export type TipoPost = (typeof TIPOS_POST)[number]

export const ETIQUETA_TIPO: Readonly<Record<TipoPost, string>> = {
  desahogo: 'Desahogo',
  pregunta: 'Pregunta',
  gratitud: 'Gratitud',
}

/** Una línea que explica qué se espera de cada tipo, para que la elección no
 *  sea adivinar. */
export const AYUDA_TIPO: Readonly<Record<TipoPost, string>> = {
  desahogo: 'Necesito soltarlo y que alguien lo lea.',
  pregunta: 'Quiero saber cómo lo ha hecho otra gente.',
  gratitud: 'Algo ha ido bien y quiero contarlo.',
}

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
