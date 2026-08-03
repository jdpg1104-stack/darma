// ============================================================================
// Moderación de calidad — el portero del karma y de la reciprocidad
//
// Un comentario solo cuenta cuando `comments.is_validated` pasa a true. Ese
// flanco dispara `trg_comments_validated`, que hace TRES cosas en la misma
// transacción: +1 crédito de escucha, +10 de karma y +1 al reply_count del post
// (que es el término que más pesa en el feed, W_REPLY = 13.5).
//
// Es decir: esta función decide quién cobra, quién puede publicar y qué sube en
// el feed. Es la superficie de ataque económica de toda la app. Si "ánimo 💪"
// valida, Darma se convierte en una granja de karma en una semana y la gente
// que viene a que la escuchen recibe emojis.
//
// ── CONTRATO ───────────────────────────────────────────────────────────────
// PURA y DETERMINISTA. Sin red, sin reloj, sin aleatoriedad, sin I/O. Motivos:
//   · El clasificador de IA se enchufa ENCIMA de esta base, no en su lugar. Un
//     modelo remoto tiene latencia, cuota, y días en los que responde otra cosa.
//     Las reglas de aquí son el suelo que siempre se aplica, también cuando el
//     proveedor está caído, y son gratis: filtran el 90 % del relleno antes de
//     gastar una sola llamada de pago.
//   · Determinista = auditable. Cuando alguien reclame "¿por qué no validó mi
//     comentario?" hay una `reason` concreta que se puede reproducir en un test.
//     Un veredicto que no se puede reproducir no se puede defender.
//
// ── SESGO DE ESTE FILTRO ───────────────────────────────────────────────────
// Al contrario que lib/crisis.ts, aquí un falso positivo SÍ tiene coste: negar
// la validación a alguien que escribió algo sincero pero corto es exactamente
// la experiencia que hace que esa persona no vuelva. Por eso el resultado NO es
// binario: `valid` gobierna el karma, pero `score` permite que la capa de API
// mande los casos dudosos al clasificador de IA en vez de rechazarlos de plano.
// ============================================================================

/** Longitud mínima. Coincide con el CHECK de comments.body (40..4000). */
export const MIN_COMMENT_LENGTH = 40

/** Longitud máxima, espejo del mismo CHECK. */
export const MAX_COMMENT_LENGTH = 4000

/** Umbral de `score` a partir del cual el comentario se considera válido. */
export const VALID_SCORE_THRESHOLD = 0.5

/**
 * Frases de relleno. NO se penaliza por CONTENERLAS —"ánimo, yo pasé por algo
 * parecido y lo que me ayudó fue…" es un comentario perfectamente válido que
 * empieza con una de ellas—. Se penaliza cuando el comentario es CASI SOLO
 * esto. La distinción la hace `fillerRatio`, no la simple presencia.
 */
export const FILLER_PHRASES: readonly string[] = [
  'animo', 'mucho animo', 'fuerza', 'mucha fuerza', 'un abrazo', 'abrazos',
  'lo siento', 'lo siento mucho', 'te entiendo', 'te comprendo', 'igual',
  'suerte', 'mucha suerte', 'todo pasa', 'todo mejora', 'todo saldra bien',
  'ya pasara', 'tranquilo', 'tranquila', 'calma', 'sigue adelante', 'aqui estoy',
  'estoy contigo', 'no estas solo', 'no estas sola', 'ya veras', 'echale ganas',
  'mejorate', 'cuidate', 'un saludo', 'saludos', 'apoyo', 'te apoyo',
] as const

/** Motivos de rechazo. Estables: la UI y la analítica los consumen. */
export type ModerationReason =
  | 'too_short'
  | 'too_long'
  | 'low_diversity'
  | 'filler_only'
  | 'echoes_post'
  | 'self_repetition'
  | 'ok'

export interface ModerationResult {
  /** ¿Otorga karma y crédito de escucha? */
  valid: boolean
  /** Calidad estimada en [0, 1]. Va a comments.quality_score (numeric(4,3)). */
  score: number
  /** Motivo dominante. 'ok' cuando valid es true. */
  reason: ModerationReason
  /** Todas las señales que dispararon, para depurar y para la cola de revisión. */
  signals: ModerationReason[]
}

export interface ModerationInput {
  /** El comentario a evaluar. */
  body: string
  /** Cuerpo del post al que responde, para detectar copias. Opcional. */
  postBody?: string
  /** Últimos comentarios del MISMO autor, para detectar plantillas. Opcional. */
  previousByAuthor?: readonly string[]
}

// ── Normalización ───────────────────────────────────────────────────────────

/**
 * Minúsculas, sin tildes, sin puntuación, sin emojis, espacios colapsados.
 *
 * Quitar las tildes es imprescindible: sin eso, "ánimo" y "animo" serían dos
 * cadenas distintas y la lista de relleno se esquiva con no poner el acento
 * (que además es lo que la mayoría de la gente hace al escribir rápido).
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')       // marcas diacríticas combinantes
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')     // deja fuera puntuación Y emojis
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokens (palabras) del texto normalizado. */
export function tokenize(text: string): string[] {
  const n = normalize(text)
  return n === '' ? [] : n.split(' ')
}

// ── Señales ─────────────────────────────────────────────────────────────────

/**
 * Diversidad léxica = palabras distintas / palabras totales.
 *
 * Detecta el relleno por repetición ("fuerza fuerza fuerza fuerza…", "jajajaja
 * jajaja jaja"), que es la forma más barata de superar un mínimo de longitud.
 * Umbral 0.5: en español natural, un texto de 15+ palabras rara vez baja de
 * ~0,65; por debajo de 0,5 hay repetición deliberada.
 */
export function lexicalDiversity(text: string): number {
  const tokens = tokenize(text)
  if (tokens.length === 0) return 0
  return new Set(tokens).size / tokens.length
}

/**
 * Fracción del comentario que es relleno reconocido.
 *
 * Se mide sobre TOKENS, no sobre presencia: "mucho ánimo" en un texto de 60
 * palabras da 0,03 y no penaliza; en un texto de 3 palabras da 0,67 y sí.
 */
export function fillerRatio(text: string): number {
  const tokens = tokenize(text)
  if (tokens.length === 0) return 1

  const fillerTokens = new Set(FILLER_PHRASES.flatMap((p) => p.split(' ')))
  const hits = tokens.filter((t) => fillerTokens.has(t)).length
  return hits / tokens.length
}

/**
 * Similitud de Jaccard sobre bigramas de palabras, en [0, 1].
 *
 * POR QUÉ BIGRAMAS Y NO PALABRAS SUELTAS: dos textos sobre el mismo tema
 * comparten muchas palabras ("trabajo", "ansiedad", "madre") sin ser copias —
 * con unigramas, responder al tema del post penalizaría, que es lo contrario de
 * lo que queremos. Compartir SECUENCIAS de dos palabras sí indica copia.
 *
 * POR QUÉ NO Levenshtein: es O(n·m) y se ejecuta en el camino caliente de cada
 * comentario contra los N anteriores del autor. Jaccard sobre conjuntos es
 * lineal y aquí mide lo mismo con menos coste.
 */
export function bigramSimilarity(a: string, b: string): number {
  const bigrams = (text: string): Set<string> => {
    const t = tokenize(text)
    const out = new Set<string>()
    for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i]} ${t[i + 1]}`)
    return out
  }

  const A = bigrams(a)
  const B = bigrams(b)
  // Textos de una sola palabra no tienen bigramas: no hay nada que comparar y
  // devolver 1 los marcaría a todos como copias entre sí.
  if (A.size === 0 || B.size === 0) return 0

  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

// ── Umbrales ────────────────────────────────────────────────────────────────
const MIN_DIVERSITY = 0.5
const MAX_FILLER_RATIO = 0.6
const MAX_ECHO_SIMILARITY = 0.5      // vs. el post: copiarlo no es escuchar
const MAX_SELF_SIMILARITY = 0.6      // vs. lo propio: plantilla copiada

/**
 * Evalúa un comentario. PURA.
 *
 * `score` empieza en 1 y cada señal descuenta. Es una suma de penalizaciones y
 * no un modelo: no pretende medir empatía —eso no se mide con reglas—, sino
 * separar lo que claramente NO es escucha de lo que puede serlo. El juicio fino
 * se lo dejamos al clasificador, que recibe `score` como prior.
 */
export function validateComment(input: ModerationInput): ModerationResult {
  const { body, postBody, previousByAuthor = [] } = input
  const signals: ModerationReason[] = []
  let score = 1

  const trimmed = body.trim()

  // ── Longitud. Rechazo duro: es el mismo CHECK que tiene la columna, así que
  // dejarlo pasar aquí solo produciría un error 500 de Postgres más adelante.
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { valid: false, score: 0, reason: 'too_short', signals: ['too_short'] }
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return { valid: false, score: 0, reason: 'too_long', signals: ['too_long'] }
  }

  // ── Diversidad léxica.
  const diversity = lexicalDiversity(trimmed)
  if (diversity < MIN_DIVERSITY) {
    signals.push('low_diversity')
    // Penalización proporcional: 0,49 de diversidad no es lo mismo que 0,1.
    score -= 0.6 * (1 - diversity / MIN_DIVERSITY) + 0.2
  }

  // ── Relleno.
  const filler = fillerRatio(trimmed)
  if (filler >= MAX_FILLER_RATIO) {
    signals.push('filler_only')
    score -= 0.7
  } else if (filler > 0.3) {
    // Zona gris: hay bastante fórmula pero también contenido. Baja el score sin
    // invalidar; que lo mire el clasificador.
    score -= 0.2
  }

  // ── Eco del post. Copiar el post del otro y devolvérselo no es escuchar; es
  // la técnica más común para simular longitud sin aportar nada.
  if (postBody) {
    const echo = bigramSimilarity(trimmed, postBody)
    if (echo >= MAX_ECHO_SIMILARITY) {
      signals.push('echoes_post')
      score -= 0.7
    }
  }

  // ── Repetición del propio autor: la misma plantilla pegada en 20 posts. Es
  // el patrón de farmeo más rentable, porque escribir bien una vez y pegarla
  // muchas supera cualquier filtro de calidad individual.
  let maxSelf = 0
  for (const prev of previousByAuthor) {
    const sim = bigramSimilarity(trimmed, prev)
    if (sim > maxSelf) maxSelf = sim
  }
  if (maxSelf >= MAX_SELF_SIMILARITY) {
    signals.push('self_repetition')
    score -= 0.8
  }

  score = Math.max(0, Math.min(1, score))
  const valid = signals.length === 0 || score >= VALID_SCORE_THRESHOLD

  return {
    valid,
    // 3 decimales: es la precisión exacta de comments.quality_score
    // (numeric(4,3)). Guardar más sería mentira, guardar menos, pérdida.
    score: Math.round(score * 1000) / 1000,
    reason: valid ? 'ok' : (signals[0] ?? 'ok'),
    signals,
  }
}

/** Explicación de cara a la persona. Nunca acusa: propone cómo mejorar. */
export function moderationMessage(reason: ModerationReason): string {
  switch (reason) {
    case 'too_short':
      return `Cuéntale un poco más: al menos ${MIN_COMMENT_LENGTH} caracteres. Lo que a ti te parece poco, a quien lo lee le puede cambiar el día.`
    case 'too_long':
      return 'Te has extendido mucho. Intenta quedarte en lo esencial.'
    case 'low_diversity':
      return 'Tu mensaje repite mucho las mismas palabras. Prueba a contarle algo concreto.'
    case 'filler_only':
      return 'Esto es una frase hecha. ¿Qué le dirías a alguien que quieres si estuviera pasando por esto?'
    case 'echoes_post':
      return 'Estás repitiendo lo que ha escrito. Cuéntale qué te ha hecho pensar a ti.'
    case 'self_repetition':
      return 'Ya has escrito algo casi idéntico antes. Cada persona merece una respuesta suya.'
    case 'ok':
      return 'Gracias por escuchar.'
  }
}
