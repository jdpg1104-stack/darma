// ============================================================================
// Generación DETERMINISTA de datos de siembra
//
// Todo lo que hay aquí es puro y reproducible a partir de una semilla: la misma
// `SEED_SEMILLA` produce byte a byte la misma base. Eso importa por una razón
// que no es estética — un `EXPLAIN ANALYZE` solo es comparable contra otro
// `EXPLAIN ANALYZE` sobre los MISMOS datos. Si la siembra fuera aleatoria, la
// medición de la semana que viene no diría si el índice nuevo mejora o si esta
// vez tocó una distribución más amable.
//
// ── POR QUÉ LA DISTRIBUCIÓN NO ES UNIFORME ─────────────────────────────────
//
// Una siembra uniforme es la forma más eficaz de engañarse a uno mismo. Con
// 1 000 000 de posts repartidos por igual entre 100 000 autores, cada autor
// tiene 10 posts, todos los `hot_score` están agrupados, las estadísticas del
// planificador son perfectas y CUALQUIER plan parece rápido. La producción no
// se parece a eso en nada:
//
//   · Autores: ley de potencias. El 1 % escribe el 30 %. Eso es lo que hace que
//     `idx_posts_author` tenga que saltar a un rango enorme para unos pocos
//     autores y a tres filas para casi todos — el caso que revienta la página
//     de perfil si el índice está mal.
//   · Tiempo: 18 meses con picos nocturnos. Una red de apoyo emocional tiene su
//     hora punta a las dos de la madrugada, y el feed "Recientes"
//     (`idx_posts_new`) se lee sobre esa densidad, no sobre una recta.
//   · Señal social: cola larga (Pareto). La mayoría de posts no recibe nada y
//     unos pocos concentran toda la conversación. Es lo que separa los
//     `hot_score` y hace que el keyset tenga que recorrer de verdad el índice.
//   · Estado y riesgo: ~5 % no activos y ~2 % de riesgo alto. Los índices
//     PARCIALES (`where state='active'`, `where risk in ('high','critical')`)
//     solo demuestran su valor si existen filas que excluyen.
// ============================================================================

import { createHash } from 'node:crypto'

/** PRNG mulberry32: 32 bits de estado, misma secuencia en cualquier máquina. */
export function crearAzar(semilla: number): () => number {
  let a = semilla >>> 0
  return function siguiente(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * uuid determinista a partir de una sal textual (`"7:post:41235"`).
 *
 * POR QUÉ SHA-256 Y NO EL PRNG. Un mulberry32 tiene 32 bits de estado: como
 * mucho puede producir 2³² uuids distintos, así que con 100 000 perfiles la
 * probabilidad de colisión (paradoja del cumpleaños) es de aproximadamente una
 * colisión ESPERADA por siembra. Una colisión en la clave primaria hace fallar
 * el COPY a mitad — y el modo de fallo bonito sería ese; el feo es una
 * colisión entre `posts` de dos ejecuciones distintas.
 *
 * Con un hash de la sal, el id de la fila `i` se calcula en O(1) sin guardar
 * ningún array: la fase de comentarios puede referirse al post 837 421 sin que
 * la fase de posts haya dejado un millón de uuids en memoria.
 *
 * No se usa `crypto.randomUUID()`: no acepta semilla, y sin semilla la siembra
 * deja de ser reproducible (ver la cabecera).
 */
export function idDeterminista(sal: string): string {
  const h = createHash('sha256').update(sal, 'utf8').digest('hex')
  // Marca de versión 4 y variante RFC 4122. Postgres aceptaría cualquier
  // hexadecimal, pero un uuid que no lo parece confunde a quien depura.
  const v = `4${h.slice(13, 16)}`
  const r = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${r}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

/**
 * PREFIJO RESERVADO. Todo lo sembrado lleva este prefijo en el alias, y
 * `--limpiar` borra exactamente eso y nada más.
 *
 * Es la diferencia entre un script reversible y un `truncate` con buena
 * intención: si mañana alguien siembra sobre una base de desarrollo que ya
 * tiene cuentas de prueba de otro bloque, el limpiado no se las lleva por
 * delante.
 */
export const PREFIJO_SEED = 'seed_'

const PALABRAS: readonly string[] = [
  'luna', 'rio', 'nube', 'faro', 'brisa', 'valle', 'roble', 'niebla',
  'aurora', 'sendero', 'raiz', 'orilla', 'duna', 'cauce', 'musgo', 'eco',
] as const

/**
 * Alias sembrado. Cumple el CHECK de `profiles.alias`
 * (3–24 caracteres, `^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$`) y es único por índice, que
 * es lo que permite hacer COPY de 100 000 filas sin colisionar con el UNIQUE.
 */
export function aliasSembrado(indice: number): string {
  return `${PREFIJO_SEED}${PALABRAS[indice % PALABRAS.length]}_${indice.toString(36)}`
}

export function avatarSeedSembrado(azar: () => number): string {
  let s = ''
  for (let i = 0; i < 8; i += 1) s += Math.floor(azar() * 256).toString(16).padStart(2, '0')
  return s
}

// ── Distribución de autores ─────────────────────────────────────────────────

/**
 * Elige el autor de un post con ley de potencias.
 *
 * Tres tramos, calibrados para que el 1 % de los autores acumule ~30 % de los
 * posts y el 10 % acumule ~60 %:
 *
 *   30 % de los posts → el 1 % más prolífico
 *   30 % de los posts → el 9 % siguiente
 *   40 % de los posts → el 90 % restante
 *
 * Se hace por tramos y no con una Zipf continua porque el resultado es
 * explicable con una frase y verificable con un `group by` de tres líneas. Una
 * Zipf con exponente ajustado a ojo produce la misma forma y nadie sabe decir
 * qué cola tiene.
 */
export function autorDePost(azar: () => number, nAutores: number): number {
  const u = azar()
  const cima = Math.max(1, Math.floor(nAutores * 0.01))
  const medio = Math.max(cima + 1, Math.floor(nAutores * 0.1))

  if (u < 0.3) return Math.floor(azar() * cima)
  if (u < 0.6) return cima + Math.floor(azar() * (medio - cima))
  return medio + Math.floor(azar() * (nAutores - medio))
}

// ── Distribución temporal ───────────────────────────────────────────────────

export const MESES_DE_HISTORIA = 18

/**
 * Pesos horarios (0–23). Pico entre las 22:00 y las 02:00.
 *
 * No es un adorno: la hora del día es lo que decide la densidad de
 * `idx_posts_new`, y el feed "Recientes" lee siempre la punta de ese índice. Un
 * reparto plano haría que la primera página costase lo mismo que cualquier
 * otra, que es exactamente la conclusión falsa que se busca evitar.
 */
const PESOS_HORA: readonly number[] = [
  6, 4, 2, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 8,
] as const

const TOTAL_PESOS = PESOS_HORA.reduce((a, b) => a + b, 0)

function horaPonderada(azar: () => number): number {
  let u = azar() * TOTAL_PESOS
  for (let h = 0; h < 24; h += 1) {
    u -= PESOS_HORA[h]
    if (u <= 0) return h
  }
  return 23
}

/**
 * Instante de creación dentro de los últimos `MESES_DE_HISTORIA`, con sesgo
 * hacia lo reciente (más actividad cuanto más cerca de hoy) y pico nocturno.
 */
export function creadoEn(azar: () => number, ahora: Date): Date {
  const dias = Math.floor(MESES_DE_HISTORIA * 30.4)
  // u² concentra la masa cerca de 0 → cerca de hoy. Una red que crece tiene más
  // posts del mes pasado que de hace un año, y el tamaño del índice caliente
  // depende de eso.
  const u = azar()
  const diasAtras = Math.floor(u * u * dias)

  const d = new Date(ahora.getTime() - diasAtras * 86400000)
  d.setUTCHours(horaPonderada(azar), Math.floor(azar() * 60), Math.floor(azar() * 60), 0)
  return d
}

// ── Señal social ────────────────────────────────────────────────────────────

/**
 * Cola larga tipo Pareto por transformada inversa: `x = (1/u)^(1/alpha) − 1`.
 *
 * `alpha` alto = cola corta. Con alpha ≈ 1,3 la mayoría de posts se queda en 0
 * o 1 y unos pocos llegan a cientos, que es la forma real de la conversación.
 */
export function colaLarga(azar: () => number, alpha: number, maximo: number): number {
  const u = Math.max(azar(), 1e-9)
  return Math.min(maximo, Math.floor(Math.pow(1 / u, 1 / alpha) - 1))
}

// ── Espejo EXACTO de public.compute_hot_score() ─────────────────────────────
//
// Se recalcula AQUÍ porque la siembra desactiva `trg_posts_hot` (un trigger por
// fila sobre un millón de inserciones es la diferencia entre minutos y horas).
// Y si se desactiva el trigger hay que escribir el valor bueno: un millón de
// posts con `hot_score = 0` deja `idx_posts_hot` degenerado en una constante,
// el planificador deja de poder usarlo para ordenar, y toda la medición del
// feed pasa a ser una ficción cómoda.
//
// Los literales 1767225600 y 45000.0 son los mismos de 0001_core.sql y de
// lib/feedRanking.ts. Si cambian allí, cambian aquí.
export const W_UPVOTE = 1
export const W_REPLY = 13.5
export const EPOCH_ANCLA = 1767225600
export const GRAVEDAD = 45000

export function hotScore(upvotes: number, replies: number, creado: Date): number {
  const s = W_UPVOTE * upvotes + W_REPLY * replies
  const orden = Math.log10(Math.max(Math.abs(s), 1))
  const signo = s > 0 ? 1 : s < 0 ? -1 : 0
  return signo * orden + (Math.floor(creado.getTime() / 1000) - EPOCH_ANCLA) / GRAVEDAD
}

// ── Texto sintético ─────────────────────────────────────────────────────────

const FRAGMENTOS: readonly string[] = [
  'texto de siembra sin contenido real',
  'fila generada para pruebas de carga',
  'este cuerpo no procede de ninguna persona',
  'relleno determinista de banco de pruebas',
  'material sintetico para medir el plan de consulta',
] as const

/**
 * Cuerpo sintético de longitud controlada.
 *
 * NUNCA texto que parezca un desahogo real. Una base de pruebas acaba en un
 * portátil, en una captura de pantalla y en un ticket; que su contenido sea
 * obviamente artificial evita que alguien la confunda con datos de producción y
 * la trate con menos cuidado del debido. Y respeta el CHECK de longitud
 * (`posts.body` 20–5000, `comments.body` 40–4000).
 */
export function cuerpoSintetico(azar: () => number, minimo: number, maximo: number): string {
  const objetivo = minimo + Math.floor(azar() * (maximo - minimo))
  let texto = ''
  while (texto.length < objetivo) {
    texto += `${FRAGMENTOS[Math.floor(azar() * FRAGMENTOS.length)]} `
  }
  return texto.slice(0, objetivo).trimEnd().padEnd(minimo, 'x')
}

// ── Clasificaciones ─────────────────────────────────────────────────────────

export type EstadoEntrada = 'active' | 'hidden' | 'removed'
export type NivelRiesgo = 'none' | 'low' | 'high' | 'critical'
export type TipoPost = 'desahogo' | 'pregunta' | 'gratitud'

/** ~5 % no activos: es lo que da sentido a los índices parciales del feed. */
export function estadoDePost(azar: () => number): EstadoEntrada {
  const u = azar()
  if (u < 0.035) return 'hidden'
  if (u < 0.05) return 'removed'
  return 'active'
}

/** ~2 % de riesgo alto o crítico: el tamaño real de `idx_posts_risk`. */
export function riesgoDePost(azar: () => number): NivelRiesgo {
  const u = azar()
  if (u < 0.005) return 'critical'
  if (u < 0.02) return 'high'
  if (u < 0.12) return 'low'
  return 'none'
}

export function tipoDePost(azar: () => number): TipoPost {
  const u = azar()
  if (u < 0.62) return 'desahogo'
  if (u < 0.88) return 'pregunta'
  return 'gratitud'
}

const TEMAS: readonly string[] = [
  'ansiedad', 'duelo', 'soledad', 'trabajo', 'familia', 'pareja',
  'estudios', 'sueno', 'autoestima', 'gratitud',
] as const

export function temaDePost(azar: () => number): string | null {
  // Un 20 % sin tema: la columna es nullable y una consulta que filtre por tema
  // tiene que vérselas con los NULL de verdad.
  return azar() < 0.2 ? null : TEMAS[Math.floor(azar() * TEMAS.length)]
}
