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
 * Vocabulario que decide si un texto habla de salud mental SIQUIERA.
 *
 * ── POR QUÉ HIZO FALTA ESTO ────────────────────────────────────────────────
 * `TERMINOS` no puede hacer de filtro de relevancia, y durante un tiempo fue lo
 * único que había. La primera ingesta real contra las fuentes semilla (OMS, CDC,
 * OPS) trajo 80 piezas y etiquetó estas:
 *
 *   'trabajo' ← «Road safety is everyone's JOB»
 *   'trabajo' ← «WHO's extended 13th General Programme of WORK»
 *   'trabajo' ← «Ireland and WHO WORK together on assistive technology»
 *   'duelo'   ← «Llamado urgente de la OMS ante la previsión de que los casos
 *                de cáncer se dupliquen de aquí a 2050»
 *
 * Ninguna es un error de las guardas de palabra: `job` y `work` son palabras
 * enteras ahí. El fallo es de categoría — se estaba usando «¿contiene una
 * palabra de la lista?» para responder «¿es esto contenido de salud mental?».
 *
 * Y no es un problema estético. Estas piezas son las MÁS peligrosas de las 80,
 * precisamente porque llevan tema: son las únicas que pasarían el filtro de
 * chips y aparecerían ante alguien que pulsó «duelo» porque se le ha muerto
 * alguien. Un artículo de proyecciones de cáncer no es contenido irrelevante en
 * ese sitio, es contenido hiriente.
 *
 * ── QUÉ NO ARREGLA ─────────────────────────────────────────────────────────
 * Esto hace honestas las etiquetas; NO arregla el catálogo. Las fuentes semilla
 * son canales institucionales COMPLETOS —la OMS publica seguridad vial y
 * ahogamientos, no solo salud mental— y acotarlas exige elegir playlists reales,
 * que es una decisión humana. Anotado en HANDOFF/PEDIDOS.md.
 */
const SENALES_SALUD_MENTAL: readonly string[] = Object.freeze([
  // Español
  // 'emocional' A SECAS NO ESTÁ, y es deliberado: aparece en cualquier prosa
  // institucional («el impacto físico, emocional y económico del cáncer») y era
  // lo único que dejaba pasar el peor falso positivo de la primera ingesta —un
  // informe de mortalidad por cáncer etiquetado como 'duelo'—. Las locuciones sí
  // señalan; el adjetivo suelto no.
  'salud mental', 'salud emocional', 'bienestar emocional', 'emociones', 'ansiedad', 'ansioso', 'ansiosa',
  'depresion', 'deprimido', 'deprimida', 'angustia', 'panico', 'estres', 'burnout', 'desgaste',
  'duelo', 'luto', 'soledad', 'aislamiento', 'autoestima', 'autocompasion', 'terapia', 'psicologia',
  'psicologico', 'psicologica', 'psiquiatrico', 'suicidio', 'suicida', 'insomnio', 'mindfulness',
  'meditacion', 'relajacion', 'respiracion', 'autocuidado', 'apoyo emocional',
  // Sueño y descanso: son tema propio de la taxonomía, no un añadido.
  'sueno', 'dormir', 'descanso', 'pesadillas',
  // Vínculos. Va 'relaciones'/'pareja'/'limites' pero NO 'familia' a secas: una
  // nota de prensa institucional habla de familias constantemente y volveríamos
  // a abrir justo el agujero que esta puerta cierra.
  'relaciones', 'pareja', 'limites', 'vinculos',
  // Inglés
  'mental health', 'emotional', 'wellbeing', 'well being', 'anxiety', 'anxious', 'depression',
  'depressed', 'grief', 'bereavement', 'loneliness', 'lonely', 'self esteem', 'self compassion',
  'self care', 'therapy', 'psychological', 'psychiatric', 'suicide', 'suicidal', 'insomnia',
  'burnout', 'mindfulness', 'meditation', 'relaxation', 'stress',
  'sleep', 'bedtime', 'rest', 'relationships', 'boundaries',
])

/**
 * ¿El texto habla de salud mental, aunque sea de lejos?
 *
 * Es deliberadamente PERMISIVO: basta una señal. No decide si el contenido es
 * bueno —eso es la curación humana— sino si tiene sentido siquiera mirarlo. Ser
 * estricto aquí descartaría material legítimo antes de que un humano lo viera,
 * y el coste de un falso negativo lo paga el catálogo entero.
 */
export function tieneSenalDeSaludMental(texto: string): boolean {
  const normalizado = normalizarTexto(texto)
  return SENALES_SALUD_MENTAL.some((s) => contienePalabra(normalizado, s))
}

/**
 * Detecta el tema por coincidencia de términos sobre título + resumen + tags.
 * Devuelve `null` si nada casa: NO se inventa un tema.
 *
 * Exige ANTES una señal de salud mental. `TERMINOS` contiene palabras que en
 * prosa general no dicen nada del tema —'work', 'job', 'family', 'solo'— y sin
 * esta puerta cualquier nota de prensa institucional salía clasificada. Ver
 * `SENALES_SALUD_MENTAL`.
 */
export function detectarTema(texto: string): TemaContenido | null {
  if (!tieneSenalDeSaludMental(texto)) return null

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
