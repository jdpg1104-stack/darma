// ============================================================================
// B08 · Tema e idioma. DETERMINISTAS, sin modelo.
//
// POR QUÉ SIN MODELO: el tema es un chip del feed de B07, y los chips filtran
// por una lista cerrada. Un modelo que devuelva «gestión emocional del estrés
// laboral» produce un tema que no casa con ningún chip: el contenido queda
// invisible y nadie sabe por qué. Un tema fuera de la taxonomía se guarda como
// `null` —«sin tema»—, que sí es un estado que el feed sabe pintar.
//
// El idioma sale del campo que da la fuente y se recorta a `^[a-z]{2}$` porque
// es lo que exige el CHECK de content_items. 'es-419' es 'es': una variante
// regional partiría el pool de contenido en dos sin ganancia real para nadie.
// ============================================================================

import type { CandidatoContenido, ClasificacionContenido } from './tipos.ts'
import { normalizarTexto } from './seguridad.ts'

/**
 * TAXONOMÍA CERRADA. Los chips del feed de B07 filtran por esta lista exacta.
 * Añadir un tema aquí exige añadirlo también allí: por eso se exporta.
 */
export const TAXONOMIA = [
  'ansiedad',
  'duelo',
  'sueño',
  'soledad',
  'autoestima',
  'respiración',
  'relaciones',
  'trabajo',
] as const

export type TemaContenido = (typeof TAXONOMIA)[number]

/**
 * Términos que apuntan a cada tema, ya normalizados (sin tildes, minúsculas).
 * El orden de la taxonomía es el orden de desempate: el primer tema con alguna
 * coincidencia gana. Es arbitrario pero ESTABLE, que es lo que importa para que
 * dos ejecuciones sobre el mismo ítem no lo clasifiquen distinto.
 */
const TERMINOS: Readonly<Record<TemaContenido, readonly string[]>> = {
  ansiedad: ['ansiedad', 'ansioso', 'ansiosa', 'panico', 'angustia', 'preocupacion', 'anxiety', 'panic', 'worry', 'stress', 'estres'],
  duelo: ['duelo', 'perdida', 'luto', 'fallecimiento', 'murio', 'muerte de', 'grief', 'bereavement', 'loss of'],
  'sueño': ['sueno', 'insomnio', 'dormir', 'descansar por la noche', 'pesadillas', 'sleep', 'insomnia', 'bedtime'],
  soledad: ['soledad', 'solo', 'sola', 'aislamiento', 'aislado', 'loneliness', 'lonely', 'isolation'],
  autoestima: ['autoestima', 'autocritica', 'autocompasion', 'valia', 'inseguridad', 'self esteem', 'self worth', 'self compassion'],
  'respiración': ['respiracion', 'respirar', 'diafragmatica', 'relajacion guiada', 'meditacion', 'mindfulness', 'breathing', 'breathe', 'relaxation'],
  relaciones: ['relaciones', 'pareja', 'familia', 'amistad', 'conflicto', 'limites', 'relationships', 'boundaries', 'family'],
  trabajo: ['trabajo', 'laboral', 'burnout', 'desgaste', 'jefe', 'oficina', 'work', 'workplace', 'job'],
} as const

/**
 * Recorta un código de idioma a su forma base de dos letras.
 *
 * 'es-419' → 'es', 'EN_US' → 'en', 'pt-BR' → 'pt'. Cualquier cosa que no
 * produzca exactamente dos letras devuelve `null`, y quien llama hereda el
 * idioma de la fuente. Devolver una cadena inválida haría que el insert
 * reventara contra el CHECK `^[a-z]{2}$` con el ítem ya descargado y cribado.
 */
export function recortarIdioma(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null
  const base = bruto.trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2}$/.test(base) ? base : null
}

/**
 * Detecta el tema por coincidencia de términos sobre título + resumen + tags.
 * Devuelve `null` si nada casa: NO se inventa un tema.
 */
export function detectarTema(texto: string): TemaContenido | null {
  const normalizado = normalizarTexto(texto)
  // Búsqueda por subcadena con guardas de palabra a los lados: sin ellas,
  // «solo» casaría dentro de «consolo» y medio catálogo acabaría en 'soledad'.
  for (const tema of TAXONOMIA) {
    for (const termino of TERMINOS[tema]) {
      if (contienePalabra(normalizado, termino)) return tema
    }
  }
  return null
}

function contienePalabra(texto: string, termino: string): boolean {
  let desde = 0
  for (;;) {
    const i = texto.indexOf(termino, desde)
    if (i === -1) return false
    const antes = i === 0 ? ' ' : texto[i - 1]
    const despues = i + termino.length >= texto.length ? ' ' : texto[i + termino.length]
    if (!/[\p{L}\p{N}]/u.test(antes) && !/[\p{L}\p{N}]/u.test(despues)) return true
    desde = i + 1
  }
}

/**
 * Clasificación completa de un candidato.
 *
 * @param fuenteIdioma idioma declarado por `ingest_sources.language`. Es el
 *        respaldo cuando la fuente no da idioma en el ítem o da uno irreconocible.
 */
export function clasificar(c: CandidatoContenido, fuenteIdioma: string): ClasificacionContenido {
  // El respaldo también se recorta: si alguien metiera 'es-ES' en la tabla —hoy
  // el CHECK lo impide, mañana quién sabe— heredarlo sin recortar rompería el
  // insert. Y si ni eso vale, 'es', que es el default de la columna.
  const respaldo = recortarIdioma(fuenteIdioma) ?? 'es'
  const language = recortarIdioma(c.language) ?? respaldo

  const tema = detectarTema([c.title, c.summary ?? '', ...(c.tags ?? [])].join(' '))
  // El tema que ya trae el candidato solo se respeta si está en la taxonomía.
  const temaPropio = c.topic != null && (TAXONOMIA as readonly string[]).includes(c.topic) ? (c.topic as TemaContenido) : null

  return {
    language,
    topic: temaPropio ?? tema,
    tags: normalizarTags(c.tags),
  }
}

/** Etiquetas en minúsculas, sin duplicados, sin vacías y acotadas a 10. */
export function normalizarTags(tags: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(tags)) return []
  const vistas = new Set<string>()
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const limpia = t.trim().toLowerCase().slice(0, 40)
    if (limpia.length > 0) vistas.add(limpia)
    if (vistas.size >= 10) break
  }
  return [...vistas]
}
