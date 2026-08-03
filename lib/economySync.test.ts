// ============================================================================
// EL TEST QUE IMPIDE QUE LA ECONOMÍA SE DESINCRONICE
//
// La autoridad de la economía de Darma es Postgres. TypeScript solo la replica
// para poder pintar la UI y previsualizar. Si los dos lados se separan, la app
// promete un número y la base paga otro — y en una red construida sobre karma y
// reciprocidad, un contrato que no se cumple es peor que un error 500: se
// pierde la confianza, que es lo único que hace que alguien cuente aquí lo que
// le pasa.
//
// Este test lee supabase/migrations/0001_core.sql con fs y compara los literales
// con las constantes de lib/karma.ts y lib/feedRanking.ts. No hay forma de que
// un .ts importe un .sql, así que la sincronía es manual: lo que hace este
// archivo es garantizar que, si es manual, al menos sea IMPOSIBLE olvidarla.
//
// SI ESTE TEST FALLA: no lo ajustes. Mira cuál de los dos lados cambiaste y
// cambia el otro.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KARMA_WEIGHTS, KARMA_LEVELS, DAILY_KARMA_CAP, SPENDABLE_PCT, type KarmaKind } from './karma.ts'
import { W_UPVOTE, W_REPLY, GRAVITY_SECONDS, EPOCH_ANCHOR_SECONDS } from './feedRanking.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(HERE, '..', 'supabase', 'migrations', '0001_core.sql')
const SQL = readFileSync(SQL_PATH, 'utf8')

test('la migración existe y contiene la tabla de pesos', () => {
  assert.ok(SQL.length > 1000, 'no se ha podido leer 0001_core.sql')
  assert.match(SQL, /insert into public\.karma_weights/)
})

// ── karma_weights ───────────────────────────────────────────────────────────

interface SqlWeight {
  kind: string
  reputation: number
  spendablePct: number
  countsToCap: boolean
}

/** Extrae las filas del INSERT de karma_weights tal y como están escritas. */
function parseSqlWeights(): SqlWeight[] {
  const insert = /insert into public\.karma_weights[^;]+;/s.exec(SQL)
  assert.ok(insert, 'no se encontró el INSERT de karma_weights')

  const rowRe = /\(\s*'([a-z_]+)'\s*,\s*(-?\d+)\s*,\s*([\d.]+)\s*,\s*'[^']*'\s*,\s*(true|false)\s*\)/g
  const rows: SqlWeight[] = []
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(insert[0])) !== null) {
    rows.push({
      kind: m[1]!,
      reputation: Number(m[2]),
      spendablePct: Number(m[3]),
      countsToCap: m[4] === 'true',
    })
  }
  return rows
}

test('karma_weights: el SQL define exactamente los mismos tipos que el TS', () => {
  const sqlRows = parseSqlWeights()
  assert.ok(sqlRows.length >= 6, `el INSERT de karma_weights se ha leído mal: ${sqlRows.length} filas`)

  // Comparación de CONJUNTOS en ambos sentidos: así falla tanto si el SQL añade
  // una clase que el TS no conoce (el caso de 'karma_spend') como al revés.
  const sqlKinds = sqlRows.map((r) => r.kind).sort()
  const tsKinds = Object.keys(KARMA_WEIGHTS).sort()
  assert.deepEqual(sqlKinds, tsKinds, 'los tipos de evento del SQL y del TS no coinciden')
})

test('karma_weights: cada peso del TS es idéntico al del SQL', () => {
  for (const row of parseSqlWeights()) {
    const ts = KARMA_WEIGHTS[row.kind as KarmaKind]
    assert.ok(ts, `el SQL define '${row.kind}' y lib/karma.ts no`)

    assert.equal(ts.reputation, row.reputation, `reputación desincronizada en '${row.kind}'`)
    assert.equal(ts.spendablePct, row.spendablePct, `spendable_pct desincronizado en '${row.kind}'`)
    assert.equal(ts.countsToCap, row.countsToCap, `counts_to_cap desincronizado en '${row.kind}'`)
  }
})

test('karma_weights: el 30 % gastable por defecto coincide (0.300 en SQL)', () => {
  const positivos = parseSqlWeights().filter((r) => r.reputation > 0)
  assert.ok(positivos.length > 0)
  for (const r of positivos) {
    assert.equal(r.spendablePct, SPENDABLE_PCT, `'${r.kind}' no reparte el ${SPENDABLE_PCT * 100} %`)
  }
})

// ── Tope diario ─────────────────────────────────────────────────────────────

test('el tope diario del TS es el mismo que el literal de award_karma()', () => {
  const fn = /create or replace function public\.award_karma[\s\S]+?\$\$;/.exec(SQL)
  assert.ok(fn, 'no se encontró award_karma()')

  // La línea del recorte: least(v_grant, greatest(0, 120 - v_earned_today))
  const cap = /greatest\(\s*0\s*,\s*(\d+)\s*-\s*v_earned_today\s*\)/.exec(fn[0])
  assert.ok(cap, 'no se encontró el recorte del tope diario dentro de award_karma()')
  assert.equal(Number(cap[1]), DAILY_KARMA_CAP, 'el tope diario del SQL y el del TS no coinciden')
})

test('award_karma recorta en vez de rechazar (least, no una excepción)', () => {
  const fn = /create or replace function public\.award_karma[\s\S]+?\$\$;/.exec(SQL)!
  assert.match(fn[0], /least\(v_grant/, 'el tope debe RECORTAR con least(), no rechazar la acción')
})

test('spendable se calcula con floor() en SQL, igual que spendableFrom en TS', () => {
  assert.match(SQL, /floor\(greatest\(v_grant, 0\) \* w\.spendable_pct\)/)
})

// ── Niveles ─────────────────────────────────────────────────────────────────

test('los umbrales de nivel del TS son los del CASE de la columna generada', () => {
  const generated = /level\s+text not null generated always as \(([\s\S]+?)\) stored/.exec(SQL)
  assert.ok(generated, 'no se encontró la columna generada `level`')

  // \s+ y no ' ': el SQL alinea los literales con espacios de más.
  const caseRe = /when karma_reputation >= (\d+)\s+then '([a-z]+)'/g
  const sqlLevels: { min: number; level: string }[] = []
  let m: RegExpExecArray | null
  while ((m = caseRe.exec(generated[1]!)) !== null) {
    sqlLevels.push({ min: Number(m[1]), level: m[2]! })
  }

  // El CASE cubre mentor/guia/brote; 'semilla' es el ELSE.
  assert.deepEqual(sqlLevels, [
    { min: 5000, level: 'mentor' },
    { min: 2000, level: 'guia' },
    { min: 500, level: 'brote' },
  ])
  assert.match(generated[1]!, /else 'semilla'/)

  const tsLevels = KARMA_LEVELS.filter((l) => l.level !== 'semilla').map((l) => ({ min: l.min, level: l.level }))
  assert.deepEqual(tsLevels, sqlLevels, 'los umbrales de nivel están desincronizados')
  assert.equal(KARMA_LEVELS.find((l) => l.level === 'semilla')!.min, 0)
})

// ── compute_hot_score ───────────────────────────────────────────────────────

test('compute_hot_score: los pesos del ranking son los mismos en SQL y en TS', () => {
  const fn = /create or replace function public\.compute_hot_score[\s\S]+?\$\$;/.exec(SQL)
  assert.ok(fn, 'no se encontró compute_hot_score()')
  const body = fn[0]

  // sign(1.0 * p_upvotes + 13.5 * p_replies)
  const pesos = /sign\(\s*([\d.]+)\s*\*\s*p_upvotes\s*\+\s*([\d.]+)\s*\*\s*p_replies\s*\)/.exec(body)
  assert.ok(pesos, 'no se encontró la combinación de pesos en compute_hot_score()')
  assert.equal(Number(pesos[1]), W_UPVOTE, 'W_UPVOTE desincronizado')
  assert.equal(Number(pesos[2]), W_REPLY, 'W_REPLY desincronizado')

  // (extract(epoch from p_created) - 1767225600) / 45000.0
  const tiempo = /extract\(epoch from p_created\)\s*-\s*(\d+)\s*\)\s*\/\s*([\d.]+)/.exec(body)
  assert.ok(tiempo, 'no se encontró el término de novedad en compute_hot_score()')
  assert.equal(Number(tiempo[1]), EPOCH_ANCHOR_SECONDS, 'el ancla temporal está desincronizada')
  assert.equal(Number(tiempo[2]), GRAVITY_SECONDS, 'GRAVITY_SECONDS desincronizado')

  // log en base 10, como Math.log10 en TS.
  assert.match(body, /log\(10,/, 'el SQL debe usar logaritmo en base 10')
})

test('el hot score se materializa y el índice pagina por keyset (no OFFSET)', () => {
  // No es un peso, pero es la otra mitad del contrato del feed: si el índice
  // dejara de existir, la fórmula sería correcta y el feed inservible a escala.
  assert.match(SQL, /hot_score\s+double precision not null default 0/)
  assert.match(SQL, /create index idx_posts_hot on public\.posts \(hot_score desc, id desc\)/)
})

// ── Reciprocidad ────────────────────────────────────────────────────────────

test('el gate 3:1 del trigger coincide con LISTENS_PER_POST', async () => {
  const { LISTENS_PER_POST } = await import('./reciprocity.ts')
  const fn = /create or replace function public\.posts_consume_credit[\s\S]+?\$\$;/.exec(SQL)
  assert.ok(fn, 'no se encontró posts_consume_credit()')

  const resta = /listen_credits\s*-\s*(\d+)/.exec(fn[0])
  assert.ok(resta, 'no se encontró el descuento de créditos')
  assert.equal(Number(resta[1]), LISTENS_PER_POST, 'el coste en escuchas está desincronizado')

  const minimo = /listen_credits >= (\d+)/.exec(fn[0])
  assert.ok(minimo)
  assert.equal(Number(minimo[1]), LISTENS_PER_POST)

  // Y el primer post sigue siendo gratis.
  assert.match(fn[0], /posts_published = 0/)
})

test('el gate vive en un trigger BEFORE INSERT, no en la API', () => {
  assert.match(
    SQL,
    /create trigger trg_posts_reciprocity\s+before insert on public\.posts/,
    'si el gate deja de ser un trigger, lib/reciprocity.ts pasa a ser la única barrera y se puede saltar con un curl',
  )
})

// ── Anonimato ───────────────────────────────────────────────────────────────

test('identity_vault sigue SIN políticas RLS (aislamiento deliberado)', () => {
  assert.match(SQL, /alter table public\.identity_vault enable row level security/)
  assert.doesNotMatch(
    SQL,
    /create policy \w+ on public\.identity_vault/,
    'identity_vault NO debe tener políticas: sin ellas solo la ve service_role',
  )
})

test('profiles no contiene columnas de identidad real', () => {
  const tabla = /create table public\.profiles \(([\s\S]+?)\n\);/.exec(SQL)
  assert.ok(tabla)
  for (const prohibida of ['email', 'phone', 'telefono', 'full_name', 'real_name']) {
    assert.doesNotMatch(
      tabla[1]!,
      new RegExp(`^\\s*${prohibida}\\b`, 'm'),
      `profiles no puede tener la columna '${prohibida}': eso va a identity_vault`,
    )
  }
})

test('los campos privados del perfil no son LEGIBLES por el cliente', () => {
  // RLS decide filas, no columnas: sin este recorte, un
  // `?select=karma_spendable,crystals` devolvía el saldo de cualquiera.
  assert.match(SQL, /revoke select on public\.profiles from anon, authenticated/)
  const grant = /grant\s+select \(([\s\S]+?)\)\s+on public\.profiles to authenticated/.exec(SQL)
  assert.ok(grant, 'no se encontró el GRANT de SELECT por columnas de profiles')

  const publicas = grant[1]!.split(',').map((c) => c.trim())
  for (const privada of ['karma_spendable', 'crystals', 'listen_credits', 'daily_karma_earned', 'shadow_banned', 'banned_until']) {
    assert.ok(!publicas.includes(privada), `'${privada}' NO puede ser legible por otros usuarios`)
  }
  // Y la vía legítima para leer lo propio existe.
  assert.match(SQL, /create or replace function public\.mi_perfil_privado\(\)/)
})

test('el karma no es escribible por el cliente (privilegio de columna)', () => {
  assert.match(SQL, /revoke update on public\.profiles from anon, authenticated/)
  const grant = /grant\s+update \(([^)]+)\) on public\.profiles to authenticated/.exec(SQL)
  assert.ok(grant, 'no se encontró el GRANT de columnas de profiles')

  const columnas = grant[1]!.split(',').map((c) => c.trim())
  for (const prohibida of ['karma_reputation', 'karma_spendable', 'listen_credits', 'crystals', 'shadow_banned']) {
    assert.ok(!columnas.includes(prohibida), `'${prohibida}' NO puede ser escribible por el cliente`)
  }
})
