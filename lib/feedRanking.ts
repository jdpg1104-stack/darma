// ============================================================================
// Feed "Para ti" — ranking hot (SSOT en TypeScript)
//
// ESPEJO EXACTO de public.compute_hot_score() en
// supabase/migrations/0001_core.sql. En Darma el hot score está MATERIALIZADO
// en la columna posts.hot_score y lo mantiene un trigger, así que el orden del
// feed es un index scan sobre idx_posts_hot y no un cálculo sobre un pool: eso
// es lo que hace que el feed siga costando lo mismo con 100 000 usuarios que
// con 100. Este archivo NO es el que ordena el feed en producción — es la
// fuente de verdad legible de la fórmula, la que usan los tests para vigilar
// que SQL y TypeScript no se separen, y la que aplica el boost (que sí es de
// lectura, ver más abajo).
//
// La fórmula es el "hot" de Reddit (pública, anclada a la edad) combinada con
// los pesos del Heavy Ranker de X adaptados a Darma: la conversación pesa mucho
// más que el aplauso, porque en una red de apoyo emocional que alguien se
// detenga a ESCRIBIR es la señal cara y honesta; votar es barato y no acompaña
// a nadie.
//
// Si cambias un peso aquí, cámbialo en 0001_core.sql. Lo vigila
// lib/economySync.test.ts, que lee el .sql con fs y compara.
// ============================================================================

// ── Pesos de la señal social (SSOT) ─────────────────────────────────────────
// s = W_UPVOTE·upvotes + W_REPLY·respuestas
//
// - W_UPVOTE = 1     → el voto es la unidad base.
// - W_REPLY  = 13.5  → cada respuesta vale ~13,5 votos. Deliberadamente alto.
//   En Darma una respuesta es una ESCUCHA validada (ver el trigger
//   comments_on_validated): es la unidad de valor de toda la red.
export const W_UPVOTE = 1
export const W_REPLY = 13.5

// ── Novedad ─────────────────────────────────────────────────────────────────
// Ancla temporal del hot de Reddit: epoch en segundos de una fecha fija.
// 2026-01-01T00:00:00Z = 1767225600, el literal que aparece en el SQL.
// El score crece con el tiempo, así que los posts nuevos salen por delante y
// los viejos necesitan mucha señal para sostenerse — sin recalcular nada.
export const EPOCH_ANCHOR_SECONDS = Math.floor(Date.UTC(2026, 0, 1) / 1000)

// Divisor de la novedad. Con log10, cada ×10 en la señal social equivale a
// GRAVITY_SECONDS de antigüedad; 45 000 s ≈ 12,5 h (el tuning clásico de
// Reddit: "un orden de magnitud de votos = 12,5 h de ventaja").
export const GRAVITY_SECONDS = 45000

// ── Boost ───────────────────────────────────────────────────────────────────
// Un boost (cuesta 50 de karma gastable, ver lib/karma.ts) sube un post
// durante una ventana temporal. Se expresa como un bono ADITIVO en las mismas
// unidades que el término de novedad, no como un multiplicador del score:
//
//   · El score es una suma de un logaritmo y un tiempo; multiplicarlo no
//     significa nada (¿qué es "el doble" de un logaritmo?) y además invierte el
//     signo en los posts con señal negativa, premiando lo que se ha hundido.
//   · Como bono aditivo sí es explicable a la persona que lo paga y auditable:
//     +1.0 = exactamente lo que aporta multiplicar por 10 la señal social, o
//     GRAVITY_SECONDS (12,5 h) de frescura. "Tu post rinde como si tuviera 10×
//     los apoyos, durante la ventana".
//
// El boost es lo ÚNICO que se calcula en lectura: la columna posts.hot_score
// almacena siempre el score SIN boost, para que el índice keyset sea estable y
// para que un boost que expira no obligue a reescribir filas.
export const BOOST_BONUS = 1.0

// ── LÍNEA ROJA DEL BOOST ────────────────────────────────────────────────────
// El dinero (o el karma) NO compra excepciones a la seguridad. Un boost:
//
//   · NO resucita contenido moderado. Si state !== 'active', el post no está en
//     el feed y el boost no lo devuelve. Ni siquiera llega aquí: la política
//     RLS posts_read ya lo filtra en Postgres.
//   · NO se aplica a contenido en riesgo alto o crítico. Un post marcado por
//     lib/crisis.ts no es material promocionable: promocionarlo sería convertir
//     la angustia de alguien en inventario. Va a la cola de revisión humana y a
//     la persona se le devuelve el karma (lo resuelve la capa de API).
//   · NO desplaza ni oculta contenido de crisis. El carril de crisis no es este
//     feed: es idx_posts_risk, una cola aparte que no se ordena por hot_score.
//     Ningún valor de BOOST_BONUS puede sacar nada de esa cola.
//
// Estas tres reglas están implementadas en `isBoostEligible` y hay tests que
// las fijan. Si algún día "producto" pide una excepción, la respuesta es no.

/** Estados de una entrada, espejo del enum public.entry_state. */
export type EntryState = 'active' | 'hidden' | 'removed'

/** Nivel de riesgo, espejo del enum public.risk_level. */
export type RiskLevel = 'none' | 'low' | 'high' | 'critical'

/** Forma mínima que necesita el ranking. Espejo parcial de public.posts. */
export interface HotScoreRow {
  upvote_count: number | null
  reply_count: number | null
  created_at: string
}

/** Fila del feed: lo que hace falta para rankear con boost y con seguridad. */
export interface FeedRow extends HotScoreRow {
  id: string
  boost_until?: string | null
  risk?: RiskLevel | null
  state?: EntryState | null
}

/**
 * Score hot de un post. Función PURA. Espejo exacto de compute_hot_score():
 *
 *   s     = W_UPVOTE·upvotes + W_REPLY·replies
 *   score = sign(s)·log10(max(|s|, 1)) + (epoch(created_at) − ANCHOR) / GRAVITY
 *
 * NO depende del "ahora": el hot de Reddit está anclado a la edad del ítem, así
 * que un post puntúa igual se lea cuando se lea. Eso es justo lo que permite
 * materializarlo en columna y paginar por keyset sin que el orden se mueva bajo
 * los pies del usuario entre página y página.
 */
export function computeHotScore(row: HotScoreRow): number {
  const upvotes = row.upvote_count ?? 0
  const replies = row.reply_count ?? 0
  const s = W_UPVOTE * upvotes + W_REPLY * replies

  const order = Math.log10(Math.max(Math.abs(s), 1))
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0

  const createdEpoch = Math.floor(new Date(row.created_at).getTime() / 1000)
  const seconds = createdEpoch - EPOCH_ANCHOR_SECONDS

  return sign * order + seconds / GRAVITY_SECONDS
}

/**
 * ¿Puede este post recibir el bono de boost AHORA MISMO?
 *
 * Las tres condiciones son AND y ninguna es negociable (ver "LÍNEA ROJA" arriba):
 * ventana vigente + estado activo + riesgo bajo o nulo.
 */
export function isBoostEligible(row: FeedRow, now: Date = new Date()): boolean {
  // 1. Moderación: lo oculto o retirado no vuelve por dinero.
  if (row.state != null && row.state !== 'active') return false

  // 2. Crisis: el contenido en riesgo no se promociona jamás.
  const risk = row.risk ?? 'none'
  if (risk === 'high' || risk === 'critical') return false

  // 3. Ventana temporal.
  if (!row.boost_until) return false
  const until = new Date(row.boost_until).getTime()
  if (!Number.isFinite(until)) return false // fecha corrupta → sin boost
  return until > now.getTime()
}

/**
 * Score efectivo para ordenar el feed = hot score materializado + bono de boost.
 *
 * `storedHotScore` permite pasar el valor de la columna (lo normal en el camino
 * caliente: te lo dio Postgres, no hay que recalcularlo). Si no se pasa, se
 * calcula — útil en tests y para previsualizar un post que aún no existe.
 */
export function effectiveScore(row: FeedRow, now: Date = new Date(), storedHotScore?: number | null): number {
  const base = storedHotScore ?? computeHotScore(row)
  return isBoostEligible(row, now) ? base + BOOST_BONUS : base
}

/**
 * Ordena (descendente) una COPIA del arreglo. No muta la entrada.
 * Desempate por id descendente — el mismo criterio que idx_posts_hot
 * `(hot_score desc, id desc)`, para que el orden en memoria y el de Postgres
 * coincidan y el cursor keyset no se salte ni repita filas.
 */
export function rankFeed<T extends FeedRow>(rows: T[], now: Date = new Date()): T[] {
  return [...rows]
    .map((row) => ({ row, score: effectiveScore(row, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0
    })
    .map((x) => x.row)
}

// ============================================================================
// Cursor keyset sobre (hot_score, id)
//
// POR QUÉ NUNCA OFFSET: con `offset 10000` Postgres lee y descarta 10 000 filas
// en cada página — el coste crece con la profundidad y a cientos de miles de
// usuarios el feed se cae solo. Con keyset la consulta es siempre
//
//   where state = 'active' and (hot_score, id) < (:score, :id)
//   order by hot_score desc, id desc limit :n
//
// que es un index scan de exactamente :n filas sobre idx_posts_hot, cueste lo
// que cueste la profundidad. Además es estable ante inserciones: con OFFSET, un
// post nuevo desplaza todo y el usuario ve elementos repetidos al paginar.
//
// El cursor se serializa en base64url para que sea opaco (nadie debería
// construirlo a mano) y seguro en una query string. NO va firmado a propósito:
// no protege nada — es una posición pública en un orden público, y falsificarlo
// solo te lleva a otro punto del mismo feed. Firmarlo daría una falsa sensación
// de seguridad sobre datos que RLS ya protege.
// ============================================================================

/** Posición en el feed: el par que ordena idx_posts_hot. */
export interface FeedCursor {
  hotScore: number
  id: string
}

const CURSOR_SEP = '|'

/** Serializa una posición del feed a un token opaco url-safe. */
export function encodeCursor(cursor: FeedCursor): string {
  if (!Number.isFinite(cursor.hotScore)) {
    throw new Error('[darma] hotScore del cursor no es finito')
  }
  if (!cursor.id) throw new Error('[darma] cursor sin id')

  // El id es un uuid (nunca contiene '|'), así que un separador simple basta y
  // evita meter JSON en la url.
  const raw = `${cursor.hotScore}${CURSOR_SEP}${cursor.id}`
  return Buffer.from(raw, 'utf8').toString('base64url')
}

/**
 * Deserializa un cursor. Devuelve `null` ante CUALQUIER entrada inválida en vez
 * de lanzar: un cursor corrupto es una url mal pegada, no un error del sistema,
 * y la respuesta correcta es servir la primera página, no un 500.
 */
export function decodeCursor(token: string | null | undefined): FeedCursor | null {
  if (!token) return null
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const sep = raw.indexOf(CURSOR_SEP)
    if (sep <= 0) return null

    const hotScore = Number(raw.slice(0, sep))
    const id = raw.slice(sep + 1)

    if (!Number.isFinite(hotScore)) return null
    // uuid v4 canónico: si no lo es, no vale como clave del keyset.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null

    return { hotScore, id }
  } catch {
    return null
  }
}

/** Cursor de la última fila de una página, o `null` si la página está vacía. */
export function nextCursorFrom(rows: Array<{ id: string; hot_score: number }>): string | null {
  const last = rows.at(-1)
  return last ? encodeCursor({ hotScore: last.hot_score, id: last.id }) : null
}
