// ============================================================================
// Pruebas de la capa de datos con un cliente FALSO que registra todo lo que se
// le pide.
//
// El cliente falso no es un atajo para evitar la base: es el único sitio donde
// se puede afirmar «esta ruta NUNCA hace un count(*) sobre poll_votes» como un
// test y no como una promesa en un comentario. Lo mismo con «el userId sale de
// la sesión»: aquí se ve la fila exacta que se manda a Postgres.
//
// La verificación contra Postgres de verdad (voto duplicado, umbral, contadores
// que cuadran) se hizo con `darma-dev` y está registrada en HANDOFF/ESTADO.md.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { esErrorApi } from '../auth/errores.ts'
import {
  errorDeVoto,
  registrarDescarte,
  registrarVoto,
  resultadosDeEncuesta,
  siguienteEncuestaPara,
} from './consulta.ts'
import { CADA_N_TARJETAS, MAX_ENCUESTAS_DIA } from './cadencia.ts'

const AHORA = new Date('2026-08-03T12:00:00.000Z')
const YO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const POLL = '11111111-1111-4111-8111-111111111111'

interface Llamada {
  tipo: 'from' | 'rpc'
  nombre: string
  operacion: string
  argumento?: unknown
}

interface Guion {
  cadencia?: { last_shown_at: string | null; shown_today: number; day: string } | null
  rpc?: Record<string, unknown>
  errorInsert?: { code: string }
}

/**
 * Cliente falso. Devuelve `unknown` y se castea en el punto de uso porque
 * implementar `SupabaseClient` entero para tres métodos sería ruido; el `as`
 * está aislado aquí y no se escapa a producción.
 */
function clienteFalso(guion: Guion = {}): { cliente: SupabaseClient; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []

  const cliente = {
    from(nombre: string) {
      return {
        select(columnas: string) {
          llamadas.push({ tipo: 'from', nombre, operacion: 'select', argumento: columnas })
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: guion.cadencia ?? null, error: null }
                },
              }
            },
          }
        },
        async insert(fila: unknown) {
          llamadas.push({ tipo: 'from', nombre, operacion: 'insert', argumento: fila })
          return { data: null, error: guion.errorInsert ?? null }
        },
        async upsert(fila: unknown, opciones: unknown) {
          llamadas.push({ tipo: 'from', nombre, operacion: 'upsert', argumento: { fila, opciones } })
          return { data: null, error: guion.errorInsert ?? null }
        },
      }
    },
    async rpc(nombre: string, args: unknown) {
      llamadas.push({ tipo: 'rpc', nombre, operacion: 'rpc', argumento: args })
      return { data: guion.rpc ?? null, error: null }
    },
  }

  return { cliente: cliente as unknown as SupabaseClient, llamadas }
}

function filaEncuesta(parcial: Record<string, unknown> = {}) {
  return {
    id: POLL,
    question: '¿Cómo ha ido tu semana?',
    total_votes: 0,
    min_reveal: 5,
    closes_at: null,
    origin: 'banco',
    mi_voto: null,
    options: [{ id: 'o1', ordinal: 0, label: 'Bien', vote_count: null }],
    ...parcial,
  }
}

// ── 3 y 4 · Traducción de los errores del motor ────────────────────────────

test('voto duplicado (23505) → sin_permiso 403, nunca 500 ni 409', () => {
  const e = errorDeVoto({ code: '23505', message: 'duplicate key value violates unique constraint "poll_votes_pkey"' })
  assert.equal(e.code, 'sin_permiso')
  assert.equal(e.status, 403)
  assert.match(e.message, /ya has respondido/i)
  assert.doesNotMatch(e.message, /poll_votes|constraint|duplicate/i, 'no filtra el nombre del índice')
})

test('opción de otra encuesta (23503) → entrada_invalida 422, sin decir si existe', () => {
  const e = errorDeVoto({ code: '23503', message: 'insert or update on table "poll_votes" violates foreign key constraint' })
  assert.equal(e.code, 'entrada_invalida')
  assert.equal(e.status, 422)
  assert.doesNotMatch(e.message, /poll_options|foreign key|no existe/i)
})

test('encuesta cerrada o voto ajeno (42501) → sin_permiso 403', () => {
  const e = errorDeVoto({ code: '42501', message: 'new row violates row-level security policy' })
  assert.equal(e.code, 'sin_permiso')
  assert.doesNotMatch(e.message, /row-level|policy/i)
})

test('cualquier otro error del motor → error_interno, sin detalle', () => {
  const e = errorDeVoto({ code: '08006', message: 'connection failure to db.internal:5432' })
  assert.equal(e.code, 'error_interno')
  assert.doesNotMatch(e.message, /5432|connection|db\.internal/i)
})

test('un error sin código tampoco se convierte en 500 con detalle', () => {
  const e = errorDeVoto(new Error('boom en la tabla poll_votes'))
  assert.equal(e.code, 'error_interno')
  assert.doesNotMatch(e.message, /poll_votes|boom/i)
})

// ── El userId sale de la sesión ────────────────────────────────────────────

test('registrarVoto escribe exactamente tres columnas y el user_id que se le pasa', async () => {
  const { cliente, llamadas } = clienteFalso()
  await registrarVoto(cliente, { pollId: POLL, opcionId: 'o1', userId: YO })

  const insert = llamadas.find((l) => l.operacion === 'insert')
  assert.ok(insert)
  assert.equal(insert.nombre, 'poll_votes')
  assert.deepEqual(insert.argumento, { poll_id: POLL, option_id: 'o1', user_id: YO })
})

test('registrarVoto propaga el 23505 ya traducido', async () => {
  const { cliente } = clienteFalso({ errorInsert: { code: '23505' } })
  await assert.rejects(
    () => registrarVoto(cliente, { pollId: POLL, opcionId: 'o1', userId: YO }),
    (e: unknown) => esErrorApi(e) && e.code === 'sin_permiso',
  )
})

// ── 7 · Jamás un count(*) sobre poll_votes ─────────────────────────────────

test('resultadosDeEncuesta no consulta poll_votes ni cuenta nada', async () => {
  const { cliente, llamadas } = clienteFalso({ rpc: filaEncuesta({ total_votes: 7, options: [
    { id: 'o1', ordinal: 0, label: 'A', vote_count: 3 },
    { id: 'o2', ordinal: 1, label: 'B', vote_count: 2 },
    { id: 'o3', ordinal: 2, label: 'C', vote_count: 2 },
  ] }) })

  const encuesta = await resultadosDeEncuesta(cliente, POLL)

  assert.deepEqual(encuesta.opciones.map((o) => o.porcentaje), [43, 29, 28])
  assert.equal(llamadas.length, 1, 'una sola consulta')
  assert.equal(llamadas[0].nombre, 'encuesta_resultados')
  assert.equal(
    llamadas.some((l) => l.nombre === 'poll_votes'),
    false,
    'ninguna consulta toca poll_votes',
  )
  assert.equal(
    llamadas.some((l) => typeof l.argumento === 'string' && /count/i.test(l.argumento)),
    false,
    'ninguna proyección pide un count',
  )
})

test('si la encuesta no existe o está retirada → no_encontrado, no un 500', async () => {
  const { cliente } = clienteFalso({ rpc: undefined })
  await assert.rejects(
    () => resultadosDeEncuesta(cliente, POLL),
    (e: unknown) => esErrorApi(e) && e.code === 'no_encontrado',
  )
})

// ── siguiente: presupuesto de consultas ────────────────────────────────────

test('si la cadencia dice que no, se resuelve en UNA consulta y sin tocar la RPC', async () => {
  const { cliente, llamadas } = clienteFalso({
    cadencia: { last_shown_at: null, shown_today: MAX_ENCUESTAS_DIA, day: '2026-08-03' },
  })

  const r = await siguienteEncuestaPara(cliente, {
    userId: YO,
    posicion: CADA_N_TARJETAS + 1,
    idioma: 'es',
    ahora: AHORA,
  })

  assert.equal(r.encuesta, null)
  assert.equal(r.decision.motivo, 'tope_diario')
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas.some((l) => l.tipo === 'rpc'), false)
})

test('si la cadencia deja pasar, son DOS consultas y ni una más', async () => {
  const { cliente, llamadas } = clienteFalso({ cadencia: null, rpc: filaEncuesta() })

  const r = await siguienteEncuestaPara(cliente, {
    userId: YO,
    posicion: CADA_N_TARJETAS + 1,
    idioma: 'es',
    ahora: AHORA,
  })

  assert.equal(r.encuesta?.id, POLL)
  assert.equal(llamadas.length, 2)
  assert.equal(llamadas[0].nombre, 'poll_cadence')
  assert.equal(llamadas[1].nombre, 'encuesta_siguiente')
  assert.deepEqual(llamadas[1].argumento, { p_idioma: 'es' })
})

test('la lectura de cadencia no pide columnas de más', async () => {
  const { cliente, llamadas } = clienteFalso({ cadencia: null, rpc: filaEncuesta() })
  await siguienteEncuestaPara(cliente, { userId: YO, posicion: 9, idioma: 'es', ahora: AHORA })
  assert.equal(llamadas[0].argumento, 'last_shown_at, shown_today, day')
})

test('pool vacío → null y motivo sin_candidatas, no un error', async () => {
  const { cliente } = clienteFalso({ cadencia: null, rpc: undefined })
  const r = await siguienteEncuestaPara(cliente, { userId: YO, posicion: 9, idioma: 'es', ahora: AHORA })
  assert.equal(r.encuesta, null)
  assert.equal(r.decision.motivo, 'sin_candidatas')
})

test('una encuesta recién servida nunca trae porcentajes', async () => {
  const { cliente } = clienteFalso({
    cadencia: null,
    // total_votes por encima del umbral, pero sin recuentos: la RPC de
    // `encuesta_siguiente` los manda siempre a null.
    rpc: filaEncuesta({ total_votes: 40 }),
  })
  const r = await siguienteEncuestaPara(cliente, { userId: YO, posicion: 9, idioma: 'es', ahora: AHORA })
  assert.equal(r.encuesta?.revelado, false)
  assert.deepEqual(r.encuesta?.opciones.map((o) => o.porcentaje), [null])
})

// ── 8 · Descartar es idempotente ───────────────────────────────────────────

test('registrarDescarte usa ON CONFLICT DO NOTHING y no pide UPDATE', async () => {
  const { cliente, llamadas } = clienteFalso()
  await registrarDescarte(cliente, { pollId: POLL, userId: YO })
  await registrarDescarte(cliente, { pollId: POLL, userId: YO })

  assert.equal(llamadas.length, 2, 'dos descartes, dos llamadas, cero errores')
  for (const l of llamadas) {
    assert.equal(l.nombre, 'poll_dismissals')
    assert.equal(l.operacion, 'upsert')
    assert.deepEqual(l.argumento, {
      fila: { poll_id: POLL, user_id: YO },
      opciones: { ignoreDuplicates: true },
    })
  }
})

test('descartar una encuesta inexistente (23503) → no_encontrado', async () => {
  const { cliente } = clienteFalso({ errorInsert: { code: '23503' } })
  await assert.rejects(
    () => registrarDescarte(cliente, { pollId: POLL, userId: YO }),
    (e: unknown) => esErrorApi(e) && e.code === 'no_encontrado',
  )
})

test('descartar en nombre de otra persona (42501) → sin_permiso', async () => {
  const { cliente } = clienteFalso({ errorInsert: { code: '42501' } })
  await assert.rejects(
    () => registrarDescarte(cliente, { pollId: POLL, userId: YO }),
    (e: unknown) => esErrorApi(e) && e.code === 'sin_permiso',
  )
})
