// ============================================================================
// Guard de economía · TypeScript contra SQL
//
// La autoridad de la economía de Darma es Postgres (`karma_weights`,
// `award_karma()`, la columna generada `profiles.level`, el trigger
// `posts_consume_credit()` y `compute_hot_score()`). TypeScript replica esos
// números para pintar la UI y previsualizar. Si los dos lados se separan, la app
// promete un número y la base paga otro — y en una red que se sostiene sobre
// karma y reciprocidad, un contrato mostrado que no se cumple destruye la
// confianza mucho más rápido que un error 500.
//
// Este guard no confía en que nadie se acuerde: lee las migraciones con `fs`,
// extrae los literales y los compara uno a uno con las constantes de
// `lib/karma.ts`, `lib/reciprocity.ts` y `lib/feedRanking.ts`. Sale con código 1
// y un informe que dice QUÉ valor difiere, EN QUÉ archivo y EN QUÉ LÍNEA.
//
// CONTRATOS.md §8 lo pide explícitamente: «Nunca los copies a un tercer sitio:
// impórtalos. Hay un test que verifica que TS y SQL coinciden».
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  KARMA_WEIGHTS,
  KARMA_LEVELS,
  DAILY_KARMA_CAP,
  SPENDABLE_PCT,
  type KarmaKind,
} from '../../lib/karma.ts'
import { LISTENS_PER_POST } from '../../lib/reciprocity.ts'
import {
  W_UPVOTE,
  W_REPLY,
  GRAVITY_SECONDS,
  EPOCH_ANCHOR_SECONDS,
  computeHotScore,
} from '../../lib/feedRanking.ts'

/** Una diferencia entre el valor de TypeScript y el literal escrito en el SQL. */
export interface Discrepancia {
  /** Identificador estable del valor: 'comment_validated.reputation', 'DAILY_KARMA_CAP'… */
  clave: string
  enTypeScript: number | string
  enSql: number | string
  archivoSql: string
  lineaSql: number
}

/** Nombres de archivo que aparecen en el informe. */
export const ARCHIVO_0001 = 'supabase/migrations/0001_core.sql'
export const ARCHIVO_0002 = 'supabase/migrations/0002_comunidad.sql'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

/** Tolerancia de la comparación numérica de la fórmula del hot score. */
export const TOLERANCIA = 1e-9

// ── Utilidades de localización ──────────────────────────────────────────────

/** Número de línea (1-based) del carácter `indice` dentro de `texto`. */
export function lineaDe(texto: string, indice: number): number {
  if (indice < 0) return 0
  let linea = 1
  for (let i = 0; i < indice && i < texto.length; i++) {
    if (texto.charCodeAt(i) === 10) linea++
  }
  return linea
}

/** Línea donde aparece por primera vez una expresión regular. 0 si no aparece. */
function lineaDeRegex(texto: string, re: RegExp): number {
  const m = re.exec(texto)
  return m ? lineaDe(texto, m.index) : 0
}

// ── karma_weights ───────────────────────────────────────────────────────────

interface FilaSql {
  kind: string
  reputation: number
  spendablePct: number
  description: string
  countsToCap: boolean
  linea: number
}

/**
 * Extrae las filas del `insert into public.karma_weights`.
 *
 * Se parsea con expresión regular y no con un parser de SQL a propósito: lo que
 * hay que vigilar es el LITERAL que alguien escribe en la migración, no el
 * árbol sintáctico. Un parser normalizaría `0.300` y `.3` al mismo valor y
 * perdería la línea exacta, que es justo lo que hace accionable el informe.
 */
export function parsearPesosSql(sql: string): FilaSql[] {
  const insert = /insert\s+into\s+public\.karma_weights[^;]+;/is.exec(sql)
  if (!insert) return []

  const base = insert.index
  const cuerpo = insert[0]

  const filaRe =
    /\(\s*'([a-z_]+)'\s*,\s*(-?\d+)\s*,\s*([\d.]+)\s*,\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*\)/g

  const filas: FilaSql[] = []
  let m: RegExpExecArray | null
  while ((m = filaRe.exec(cuerpo)) !== null) {
    filas.push({
      kind: m[1]!,
      reputation: Number(m[2]),
      spendablePct: Number(m[3]),
      description: m[4]!.replace(/''/g, "'"),
      countsToCap: m[5] === 'true',
      linea: lineaDe(sql, base + m.index),
    })
  }
  return filas
}

function compararPesos(sql: string): Discrepancia[] {
  const out: Discrepancia[] = []
  const filas = parsearPesosSql(sql)

  if (filas.length === 0) {
    out.push({
      clave: 'karma_weights',
      enTypeScript: Object.keys(KARMA_WEIGHTS).length,
      enSql: 'no se encontró el INSERT de karma_weights',
      archivoSql: ARCHIVO_0001,
      lineaSql: 0,
    })
    return out
  }

  const porKind = new Map(filas.map((f) => [f.kind, f]))
  const lineaInsert = lineaDeRegex(sql, /insert\s+into\s+public\.karma_weights/i)

  for (const [kind, peso] of Object.entries(KARMA_WEIGHTS) as [KarmaKind, (typeof KARMA_WEIGHTS)[KarmaKind]][]) {
    const fila = porKind.get(kind)
    if (!fila) {
      out.push({
        clave: `karma_weights.${kind}`,
        enTypeScript: 'definido en lib/karma.ts',
        enSql: 'AUSENTE',
        archivoSql: ARCHIVO_0001,
        lineaSql: lineaInsert,
      })
      continue
    }

    if (fila.reputation !== peso.reputation) {
      out.push({
        clave: `${kind}.reputation`,
        enTypeScript: peso.reputation,
        enSql: fila.reputation,
        archivoSql: ARCHIVO_0001,
        lineaSql: fila.linea,
      })
    }
    if (Math.abs(fila.spendablePct - peso.spendablePct) > TOLERANCIA) {
      out.push({
        clave: `${kind}.spendable_pct`,
        enTypeScript: peso.spendablePct,
        enSql: fila.spendablePct,
        archivoSql: ARCHIVO_0001,
        lineaSql: fila.linea,
      })
    }
    if (fila.countsToCap !== peso.countsToCap) {
      out.push({
        clave: `${kind}.counts_to_cap`,
        enTypeScript: String(peso.countsToCap),
        enSql: String(fila.countsToCap),
        archivoSql: ARCHIVO_0001,
        lineaSql: fila.linea,
      })
    }
    if (fila.description !== peso.description) {
      out.push({
        clave: `${kind}.description`,
        enTypeScript: peso.description,
        enSql: fila.description,
        archivoSql: ARCHIVO_0001,
        lineaSql: fila.linea,
      })
    }
  }

  // Al revés: una clase que exista en SQL y no en TypeScript es igual de grave.
  // Es exactamente el hueco que dejó 'karma_spend' antes de existir: el ledger
  // registraba gastos con la clase 'comment_validated' para satisfacer la FK y
  // la pantalla de transparencia del karma mentía.
  for (const fila of filas) {
    if (!(fila.kind in KARMA_WEIGHTS)) {
      out.push({
        clave: `karma_weights.${fila.kind}`,
        enTypeScript: 'AUSENTE en KARMA_WEIGHTS',
        enSql: fila.reputation,
        archivoSql: ARCHIVO_0001,
        lineaSql: fila.linea,
      })
    }
  }

  return out
}

// ── Tope diario, fracción gastable, niveles y reciprocidad ──────────────────

function compararTopeDiario(sql: string): Discrepancia[] {
  // El literal vive dentro de award_karma(): `least(v_grant, greatest(0, 120 - v_earned_today))`.
  const re = /greatest\s*\(\s*0\s*,\s*(\d+)\s*-\s*v_earned_today\s*\)/i
  const m = re.exec(sql)
  if (!m) {
    return [
      {
        clave: 'DAILY_KARMA_CAP',
        enTypeScript: DAILY_KARMA_CAP,
        enSql: 'no se encontró el tope dentro de award_karma()',
        archivoSql: ARCHIVO_0001,
        lineaSql: lineaDeRegex(sql, /function\s+public\.award_karma/i),
      },
    ]
  }
  const enSql = Number(m[1])
  if (enSql === DAILY_KARMA_CAP) return []
  return [
    {
      clave: 'DAILY_KARMA_CAP',
      enTypeScript: DAILY_KARMA_CAP,
      enSql,
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDe(sql, m.index),
    },
  ]
}

function compararFraccionGastable(sql: string): Discrepancia[] {
  // `spendable_pct numeric(4,3) not null default 0.300`
  const re = /spendable_pct\s+numeric\([^)]*\)\s+not\s+null\s+default\s+([\d.]+)/i
  const m = re.exec(sql)
  if (!m) {
    return [
      {
        clave: 'SPENDABLE_PCT.default',
        enTypeScript: SPENDABLE_PCT,
        enSql: 'no se encontró el default de karma_weights.spendable_pct',
        archivoSql: ARCHIVO_0001,
        lineaSql: 0,
      },
    ]
  }
  const enSql = Number(m[1])
  if (Math.abs(enSql - SPENDABLE_PCT) <= TOLERANCIA) return []
  return [
    {
      clave: 'SPENDABLE_PCT.default',
      enTypeScript: SPENDABLE_PCT,
      enSql,
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDe(sql, m.index),
    },
  ]
}

function compararNiveles(sql: string): Discrepancia[] {
  const out: Discrepancia[] = []

  // El CASE de la columna generada `profiles.level`.
  const caseRe = /generated\s+always\s+as\s*\(([\s\S]*?)\)\s*stored/i
  const bloque = caseRe.exec(sql)
  if (!bloque) {
    return [
      {
        clave: 'KARMA_LEVELS',
        enTypeScript: KARMA_LEVELS.map((l) => `${l.level}:${l.min}`).join(' '),
        enSql: 'no se encontró la columna generada profiles.level',
        archivoSql: ARCHIVO_0001,
        lineaSql: 0,
      },
    ]
  }

  const base = bloque.index
  const cuerpo = bloque[1]!
  const ramaRe = /karma_reputation\s*>=\s*(\d+)\s*then\s*'([a-z]+)'/gi

  const ramas: Array<{ min: number; level: string; linea: number }> = []
  let m: RegExpExecArray | null
  while ((m = ramaRe.exec(cuerpo)) !== null) {
    ramas.push({
      min: Number(m[1]),
      level: m[2]!,
      linea: lineaDe(sql, base + bloque[0]!.indexOf(cuerpo) + m.index),
    })
  }

  // KARMA_LEVELS está de mayor a menor, igual que el CASE; 'semilla' es el else
  // y por eso no tiene rama con umbral.
  const conUmbral = KARMA_LEVELS.filter((l) => l.min > 0)

  for (const def of conUmbral) {
    const rama = ramas.find((r) => r.level === def.level)
    if (!rama) {
      out.push({
        clave: `KARMA_LEVELS.${def.level}`,
        enTypeScript: def.min,
        enSql: 'AUSENTE en el CASE de profiles.level',
        archivoSql: ARCHIVO_0001,
        lineaSql: lineaDe(sql, base),
      })
      continue
    }
    if (rama.min !== def.min) {
      out.push({
        clave: `KARMA_LEVELS.${def.level}`,
        enTypeScript: def.min,
        enSql: rama.min,
        archivoSql: ARCHIVO_0001,
        lineaSql: rama.linea,
      })
    }
  }

  return out
}

function compararReciprocidad(sql: string): Discrepancia[] {
  const out: Discrepancia[] = []

  // OJO: la búsqueda se acota al CUERPO de posts_consume_credit(). Buscando en
  // el archivo entero, `listen_credits >= N` casaba antes con el CHECK de la
  // columna (`check (listen_credits >= 0)`) y el guard denunciaba un 0 que no
  // tenía nada que ver con la reciprocidad. Un guard con falsos positivos se
  // desactiva a la semana.
  const fn = /create\s+or\s+replace\s+function\s+public\.posts_consume_credit[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(sql)
  if (!fn) {
    return [
      {
        clave: 'LISTENS_PER_POST',
        enTypeScript: LISTENS_PER_POST,
        enSql: 'no se encontró la función posts_consume_credit()',
        archivoSql: ARCHIVO_0001,
        lineaSql: 0,
      },
    ]
  }

  const cuerpo = fn[1]!
  const base = fn.index + fn[0]!.indexOf(cuerpo)

  // El descuento: `listen_credits - 3`.
  const descuento = /listen_credits\s*-\s*(\d+)/i.exec(cuerpo)
  if (!descuento) {
    out.push({
      clave: 'LISTENS_PER_POST.descuento',
      enTypeScript: LISTENS_PER_POST,
      enSql: 'no se encontró `listen_credits - N` en posts_consume_credit()',
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDeRegex(sql, /function\s+public\.posts_consume_credit/i),
    })
  } else if (Number(descuento[1]) !== LISTENS_PER_POST) {
    out.push({
      clave: 'LISTENS_PER_POST.descuento',
      enTypeScript: LISTENS_PER_POST,
      enSql: Number(descuento[1]),
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDe(sql, base + descuento.index),
    })
  }

  // El umbral del WHERE: `listen_credits >= 3`. Descuento y umbral son dos
  // literales distintos en la misma sentencia; si alguien cambia uno y no el
  // otro, el crédito se descuenta mal o se regala.
  const umbral = /listen_credits\s*>=\s*(\d+)/i.exec(cuerpo)
  if (!umbral) {
    out.push({
      clave: 'LISTENS_PER_POST.umbral',
      enTypeScript: LISTENS_PER_POST,
      enSql: 'no se encontró `listen_credits >= N` en posts_consume_credit()',
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDeRegex(sql, /function\s+public\.posts_consume_credit/i),
    })
  } else if (Number(umbral[1]) !== LISTENS_PER_POST) {
    out.push({
      clave: 'LISTENS_PER_POST.umbral',
      enTypeScript: LISTENS_PER_POST,
      enSql: Number(umbral[1]),
      archivoSql: ARCHIVO_0001,
      lineaSql: lineaDe(sql, base + umbral.index),
    })
  }

  return out
}

// ── Hot score ───────────────────────────────────────────────────────────────

/** Constantes de `compute_hot_score()` tal y como están escritas en el SQL. */
export interface ConstantesHot {
  wUpvote: number
  wReply: number
  gravity: number
  ancla: number
  linea: number
}

/**
 * Extrae los cuatro literales de `compute_hot_score()`:
 *
 *   sign(1.0 * p_upvotes + 13.5 * p_replies)
 *   * log(10, greatest(abs(1.0 * p_upvotes + 13.5 * p_replies), 1))
 *   + (extract(epoch from p_created) - 1767225600) / 45000.0
 */
export function parsearHotSql(sql: string): ConstantesHot | null {
  const fn = /create\s+or\s+replace\s+function\s+public\.compute_hot_score[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(sql)
  if (!fn) return null

  const cuerpo = fn[1]!
  const pesos = /([\d.]+)\s*\*\s*p_upvotes\s*\+\s*([\d.]+)\s*\*\s*p_replies/i.exec(cuerpo)
  const tiempo = /from\s+p_created\s*\)\s*-\s*(\d+)\s*\)\s*\/\s*([\d.]+)/i.exec(cuerpo)

  if (!pesos || !tiempo) return null

  return {
    wUpvote: Number(pesos[1]),
    wReply: Number(pesos[2]),
    ancla: Number(tiempo[1]),
    gravity: Number(tiempo[2]),
    linea: lineaDe(sql, fn.index),
  }
}

/**
 * Evalúa la fórmula del SQL **con las constantes leídas del SQL**, en
 * JavaScript.
 *
 * Por qué así y no ejecutando `select compute_hot_score(...)` contra Postgres:
 * el guard tiene que correr en cada PR, en segundos y sin base de datos. Lo que
 * se compara es la FÓRMULA (misma forma, mismos literales) frente a la
 * implementación de TypeScript. La igualdad numérica real contra Postgres se
 * comprueba en la suite de RLS/pgTAP, que sí tiene la base delante.
 */
export function evaluarHotSql(c: ConstantesHot, upvotes: number, replies: number, createdEpoch: number): number {
  const s = c.wUpvote * upvotes + c.wReply * replies
  const signo = s > 0 ? 1 : s < 0 ? -1 : 0
  return signo * Math.log10(Math.max(Math.abs(s), 1)) + (createdEpoch - c.ancla) / c.gravity
}

function compararHotScore(sql: string): Discrepancia[] {
  const out: Discrepancia[] = []
  const c = parsearHotSql(sql)

  if (!c) {
    return [
      {
        clave: 'compute_hot_score',
        enTypeScript: 'computeHotScore() en lib/feedRanking.ts',
        enSql: 'no se pudo parsear compute_hot_score()',
        archivoSql: ARCHIVO_0001,
        lineaSql: lineaDeRegex(sql, /function\s+public\.compute_hot_score/i),
      },
    ]
  }

  const pares: Array<[string, number, number]> = [
    ['W_UPVOTE', W_UPVOTE, c.wUpvote],
    ['W_REPLY', W_REPLY, c.wReply],
    ['GRAVITY_SECONDS', GRAVITY_SECONDS, c.gravity],
    ['EPOCH_ANCHOR_SECONDS', EPOCH_ANCHOR_SECONDS, c.ancla],
  ]

  for (const [clave, ts, enSql] of pares) {
    if (Math.abs(ts - enSql) > TOLERANCIA) {
      out.push({ clave, enTypeScript: ts, enSql, archivoSql: ARCHIVO_0001, lineaSql: c.linea })
    }
  }

  // Y ahora la prueba que de verdad importa: 20 pares de valores por las dos
  // implementaciones. Comparar constantes sueltas no detecta que alguien
  // cambie `log(10, …)` por `ln(…)` o el signo de un término.
  const muestras: Array<[number, number]> = [
    [0, 0], [1, 0], [0, 1], [3, 2], [10, 0], [0, 10], [25, 4], [100, 12],
    [999, 1], [1, 999], [7, 7], [50, 3], [0, 100], [4, 0], [17, 9],
    [1000, 1000], [2, 1], [8, 5], [64, 0], [0, 64],
  ]

  const anclaMs = EPOCH_ANCHOR_SECONDS * 1000
  for (let i = 0; i < muestras.length; i++) {
    const [up, re] = muestras[i]!
    // Instantes repartidos alrededor del ancla, incluidos anteriores (delta
    // negativo): el término temporal cambia de signo y ahí es donde una fórmula
    // mal transcrita se separa.
    const createdMs = anclaMs + (i - 10) * 3_600_000
    const created = new Date(createdMs).toISOString()

    const enTs = computeHotScore({ upvote_count: up, reply_count: re, created_at: created })
    const enSql = evaluarHotSql(c, up, re, Math.floor(createdMs / 1000))

    if (Math.abs(enTs - enSql) > TOLERANCIA) {
      out.push({
        clave: `computeHotScore(${up}, ${re})`,
        enTypeScript: enTs,
        enSql,
        archivoSql: ARCHIVO_0001,
        lineaSql: c.linea,
      })
    }
  }

  return out
}

// ── 0002: clases de karma referenciadas desde los triggers ──────────────────

function compararReferencias0002(sql: string): Discrepancia[] {
  const out: Discrepancia[] = []
  const re = /award_karma\s*\(\s*[^,]+,\s*'([a-z_]+)'/gi

  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const kind = m[1]!
    if (!(kind in KARMA_WEIGHTS)) {
      out.push({
        clave: `award_karma('${kind}')`,
        enTypeScript: 'AUSENTE en KARMA_WEIGHTS',
        enSql: kind,
        archivoSql: ARCHIVO_0002,
        lineaSql: lineaDe(sql, m.index),
      })
    }
  }

  return out
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Compara los valores de la economía en TypeScript con los literales de las dos
 * migraciones. Devuelve `[]` cuando todo coincide.
 */
export function compararEconomia(sql0001: string, sql0002: string): Discrepancia[] {
  return [
    ...compararPesos(sql0001),
    ...compararTopeDiario(sql0001),
    ...compararFraccionGastable(sql0001),
    ...compararNiveles(sql0001),
    ...compararReciprocidad(sql0001),
    ...compararHotScore(sql0001),
    ...compararReferencias0002(sql0002),
  ]
}

/** Informe legible. Una línea por discrepancia, con archivo y línea. */
export function formatearInforme(hallazgos: readonly Discrepancia[]): string {
  if (hallazgos.length === 0) {
    return '[guardEconomia] OK · TypeScript y SQL dicen exactamente lo mismo.'
  }

  const lineas = hallazgos.map(
    (d) =>
      `  ✗ ${d.clave}\n` +
      `      TypeScript: ${d.enTypeScript}\n` +
      `      SQL:        ${d.enSql}\n` +
      `      → ${d.archivoSql}:${d.lineaSql}`,
  )

  return [
    `[guardEconomia] ${hallazgos.length} discrepancia(s) entre la economía de TypeScript y la de SQL:`,
    '',
    ...lineas,
    '',
    'Cómo arreglarlo: NO ajustes el test. Mira cuál de los dos lados cambiaste',
    'y cambia el otro. La autoridad es Postgres (CONTRATOS.md §8); lib/karma.ts,',
    'lib/reciprocity.ts y lib/feedRanking.ts son su espejo.',
    'Si el valor correcto es el de TypeScript, NO edites una migración aplicada:',
    'añade `supabase/migrations/0NNN_<bloque>_<tema>.sql`.',
  ].join('\n')
}

/** Lee las migraciones del repositorio y ejecuta la comparación. */
export function comprobarRepositorio(raiz: string = RAIZ): Discrepancia[] {
  const sql0001 = readFileSync(join(raiz, 'supabase', 'migrations', '0001_core.sql'), 'utf8')
  const sql0002 = readFileSync(join(raiz, 'supabase', 'migrations', '0002_comunidad.sql'), 'utf8')
  return compararEconomia(sql0001, sql0002)
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Contrato de proceso común a los cuatro guards: 0 si todo está bien, 1 si hay
// hallazgos, y un informe legible en stdout. Nada de salidas silenciosas.

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hallazgos = comprobarRepositorio()
  console.error(formatearInforme(hallazgos))
  process.exit(hallazgos.length === 0 ? 0 : 1)
}
