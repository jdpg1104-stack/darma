// ============================================================================
// SINCRONÍA TS ↔ SQL
//
// La autoridad de la economía es Postgres (ARCHITECTURE §0). TypeScript replica
// los números para poder pintar la UI y previsualizar. Si los dos lados se
// separan, la app promete un cupo y la base concede otro — y una economía en la
// que el contrato mostrado no se cumple destruye la confianza mucho más rápido
// que un error 500.
//
// Este archivo hace con `0121_1_b12_economia.sql` lo mismo que
// `lib/economySync.test.ts` hace con `0001_core.sql`: lee el .sql con `fs` y
// compara literal a literal. No hay forma de que un .ts importe un .sql, así
// que la sincronía es manual; lo que garantiza este test es que sea IMPOSIBLE
// olvidarla.
//
// SI FALLA: mira cuál de los dos lados cambiaste y cambia el otro. Nunca
// ajustes el test.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KARMA_COSTS } from '../karma.ts'
import { BOOST_COSTE_CRISTALES, BOOST_HORAS, BOOST_MAX_DIA, CUPO_GRATIS_DIARIO } from './boosts.ts'
import { COMISION_REGALO, PRECIO_MINIMO_REGALO, repartir } from './regalos.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SQL_B12 = readFileSync(join(AQUI, '..', '..', 'supabase', 'migrations', '0121_1_b12_economia.sql'), 'utf8')
const SQL_CORE = readFileSync(join(AQUI, '..', '..', 'supabase', 'migrations', '0001_core.sql'), 'utf8')
const SQL_COMUNIDAD = readFileSync(join(AQUI, '..', '..', 'supabase', 'migrations', '0002_comunidad.sql'), 'utf8')

/** Lee `v_nombre  constant integer := N;` de la migración. */
function constanteSql(nombre: string): number {
  const encontrado = new RegExp(`${nombre}\\s+constant\\s+integer\\s*:=\\s*(\\d+)`).exec(SQL_B12)
  assert.ok(encontrado, `no se encontró ${nombre} en 0121_1_b12_economia.sql`)
  return Number(encontrado[1])
}

test('las migraciones se han podido leer', () => {
  assert.ok(SQL_B12.includes('create or replace function public.impulsar_post'))
  assert.ok(SQL_CORE.includes('create or replace function public.spend_karma'))
  assert.ok(SQL_COMUNIDAD.includes('create table public.crystal_ledger'))
})

test('CUPO_GRATIS_DIARIO coincide con v_cupo_gratis del SQL', () => {
  assert.equal(CUPO_GRATIS_DIARIO, constanteSql('v_cupo_gratis'))
})

test('BOOST_HORAS coincide con v_horas del SQL', () => {
  assert.equal(BOOST_HORAS, constanteSql('v_horas'))
})

test('BOOST_MAX_DIA coincide con v_max_dia del SQL y con el trigger de 0002', () => {
  assert.equal(BOOST_MAX_DIA, constanteSql('v_max_dia'))

  // El techo REAL lo aplica `boosts_enforce_daily_limit` en 0002; el de la
  // migración de B12 solo adelanta el error para poder devolver un 429 limpio.
  // Si los dos no coinciden, alguien vería «te quedan boosts» y recibiría un
  // rechazo del trigger.
  const trigger = /v_max\s+constant\s+integer\s*:=\s*(\d+)/.exec(SQL_COMUNIDAD)
  assert.ok(trigger, 'no se encontró v_max en boosts_enforce_daily_limit (0002)')
  assert.equal(BOOST_MAX_DIA, Number(trigger[1]))
})

test('el coste del boost en karma y en cristales es el MISMO en TS y en SQL', () => {
  // 🔴 Si el precio en cristales comprara el boost más barato que el precio en
  // karma, el dinero compraría más visibilidad por unidad de esfuerzo. Los dos
  // números son iguales a propósito y este test lo fija.
  assert.equal(KARMA_COSTS.boost, constanteSql('v_coste_karma'))
  assert.equal(BOOST_COSTE_CRISTALES, constanteSql('v_coste_crist'))
  assert.equal(KARMA_COSTS.boost, BOOST_COSTE_CRISTALES)
})

test('el cupo gratuito se registra con amount 0, y el CHECK de la tabla lo permite', () => {
  // El `check (amount > 0)` original de 0002 hacía inexpresable el boost
  // gratuito. `0121_1` §1 lo relaja a `>= 0`. Si alguien lo revirtiera, el cupo
  // gratuito dejaría de poder insertarse y el dinero pasaría a ser la única vía.
  assert.match(SQL_B12, /add constraint boosts_amount_check check \(amount >= 0\)/)
  assert.match(SQL_COMUNIDAD, /amount\s+integer not null check \(amount > 0\)/)
})

test('la comisión de regalo del catálogo cierra la aritmética del CHECK gifts_amounts', () => {
  // `check (cost_crystals = fee_crystals + net_crystals)` es una restricción del
  // motor. `repartir()` tiene que cerrarla SIEMPRE.
  assert.match(SQL_COMUNIDAD, /constraint gifts_amounts check \(cost_crystals = fee_crystals \+ net_crystals\)/)

  for (let coste = PRECIO_MINIMO_REGALO; coste <= 1000; coste += 1) {
    const { comision, neto } = repartir(coste, COMISION_REGALO)
    assert.equal(comision + neto, coste, `el reparto de ${coste} no cierra`)
    assert.ok(neto >= 0, `neto negativo con ${coste}`)
    assert.ok(comision >= 0, `comisión negativa con ${coste}`)
  }
})

test('los seis valores del CHECK de crystal_ledger.source están cubiertos por el tipo TS', async () => {
  // Trampa conocida nº 2: escribir `'apple'` o `'purchase'` revienta con
  // violación de CHECK en producción y no en un test con mocks.
  const check = /check \(source in \(([^)]+)\)\)/.exec(SQL_COMUNIDAD)
  assert.ok(check, 'no se encontró el CHECK de crystal_ledger.source')

  const valoresSql = check[1]!
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .sort()

  const ledger = readFileSync(join(AQUI, 'ledger.ts'), 'utf8')
  for (const valor of valoresSql) {
    if (valor === 'iap') continue // legado de 0002; B12 no lo escribe nunca
    assert.ok(
      ledger.includes(`'${valor}'`),
      `el tipo OrigenCristales no cubre «${valor}» del CHECK de Postgres`,
    )
  }
})
