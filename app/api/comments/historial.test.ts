// ============================================================================
// Pruebas del historial que alimenta `self_repetition`.
//
//   node --test --experimental-strip-types "app/api/comments/historial.test.ts"
//
// Tres cosas se fijan aquí, y son las tres decisiones de `historial.ts`:
//   1. La FORMA de la consulta: cuántas filas pide, con qué filtros y en qué
//      orden. No es cosmética — es lo que decide si el camino caliente de
//      comentar cae dentro del índice parcial de 0213 o recorre el historial
//      entero de la persona.
//   2. La VENTANA: 30 días, calculados sobre un reloj inyectado para que el
//      test no dependa de cuándo se ejecuta.
//   3. Que «no pude preguntar» NO se comporta como «es una plantilla».
//
// El cliente de Supabase es un doble que registra la consulta en vez de
// hacerla: aquí no hay red. Que el plan de ejecución use de verdad
// `idx_comments_credito_repetido` no se puede probar sin Postgres; eso va con
// su EXPLAIN ANALYZE en el PR (CONTRATOS §11).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

import { validateComment } from '../../../lib/moderation.ts'
import {
  MAX_PREVIOS_AUTOR,
  VENTANA_PREVIOS_DIAS,
  VENTANA_PREVIOS_MS,
  leerPreviosDelAutor,
} from './historial.ts'

const AUTOR = '11111111-1111-4111-8111-111111111111'
const AHORA = new Date('2026-08-05T12:00:00.000Z')

// ── Doble de la base ────────────────────────────────────────────────────────

interface Registro {
  tabla: string
  columnas: string
  filtros: [string, string, unknown][]
  orden: { columna: string; ascendente: boolean }[]
  limite: number | null
}

type Respuesta = () => { data?: unknown; error?: unknown }

/** Lo poco del constructor de PostgREST que esta consulta usa. */
interface Cadena {
  select(columnas: string): Cadena
  eq(columna: string, valor: unknown): Cadena
  gt(columna: string, valor: unknown): Cadena
  order(columna: string, opciones: { ascending: boolean }): Cadena
  limit(n: number): Cadena
  then(alCumplir: (valor: unknown) => unknown, alFallar?: (causa: unknown) => unknown): Promise<unknown>
}

/**
 * Cliente falso que ANOTA la consulta en vez de ejecutarla. El objeto es
 * «thenable» igual que el constructor de PostgREST, así que `await` sobre la
 * cadena funciona sin simular la librería entera.
 */
function dobleSupabase(respuesta: Respuesta): { cliente: SupabaseClient; registro: Registro } {
  const registro: Registro = { tabla: '', columnas: '', filtros: [], orden: [], limite: null }

  const cadena: Cadena = {
    select(columnas: string) {
      registro.columnas = columnas
      return cadena
    },
    eq(columna: string, valor: unknown) {
      registro.filtros.push(['eq', columna, valor])
      return cadena
    },
    gt(columna: string, valor: unknown) {
      registro.filtros.push(['gt', columna, valor])
      return cadena
    },
    order(columna: string, opciones: { ascending: boolean }) {
      registro.orden.push({ columna, ascendente: opciones.ascending })
      return cadena
    },
    limit(n: number) {
      registro.limite = n
      return cadena
    },
    then(alCumplir: (valor: unknown) => unknown, alFallar?: (causa: unknown) => unknown) {
      return Promise.resolve()
        .then(() => respuesta())
        .then(alCumplir, alFallar)
    },
  }

  const cliente = {
    from(tabla: string) {
      registro.tabla = tabla
      return cadena
    },
  }

  return { cliente: cliente as unknown as SupabaseClient, registro }
}

function conFilas(cuerpos: readonly (string | null)[]): { cliente: SupabaseClient; registro: Registro } {
  return dobleSupabase(() => ({ data: cuerpos.map((body) => ({ body })), error: null }))
}

// ── 1 · La forma de la consulta ─────────────────────────────────────────────

test('la consulta pide 20 filas, validadas, del autor y por fecha descendente', async () => {
  const { cliente, registro } = conFilas([])

  await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.equal(registro.tabla, 'comments')
  // Solo el cuerpo: ni el id, ni el post, ni la fecha. Lo que no se pide no
  // viaja, y esto viaja en cada comentario que se publica.
  assert.equal(registro.columnas, 'body')
  assert.equal(registro.limite, MAX_PREVIOS_AUTOR)
  assert.equal(MAX_PREVIOS_AUTOR, 20)

  assert.deepEqual(registro.orden, [{ columna: 'created_at', ascendente: false }])
  assert.deepEqual(
    registro.filtros.filter(([op]) => op === 'eq'),
    [
      ['eq', 'author_id', AUTOR],
      // `is_validated` es lo que hace que la consulta quepa en el índice
      // parcial de 0213 — y lo correcto: solo condena el texto que YA cobró.
      ['eq', 'is_validated', true],
    ],
  )
})

test('el par que ordena la consulta es el mismo que ordena el índice de 0213', () => {
  const migracion = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations', '0213_1_b21_credito_por_persona.sql'),
    'utf8',
  )
  // Si alguien cambia el índice a `(author_id, created_at)` ascendente, esta
  // consulta deja de estar cubierta y nadie se entera hasta que el camino de
  // comentar se pone lento.
  assert.match(migracion, /idx_comments_credito_repetido[\s\S]*author_id, created_at desc[\s\S]*where is_validated/)
})

// ── 2 · La ventana ──────────────────────────────────────────────────────────

test('la ventana son 30 días exactos contados desde el reloj recibido', async () => {
  const { cliente, registro } = conFilas([])

  await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  const [gt] = registro.filtros.filter(([op]) => op === 'gt')
  assert.deepEqual(gt, ['gt', 'created_at', new Date(AHORA.getTime() - VENTANA_PREVIOS_MS).toISOString()])
  assert.equal(VENTANA_PREVIOS_DIAS, 30)
  // ISO-8601 en UTC, nunca fecha local (CONTRATOS §1).
  assert.match(String(gt?.[2]), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
})

test('lo escrito hace un año no entra: quien lleva un año acompañando repite frases', async () => {
  const { cliente, registro } = conFilas([])
  await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  const gt = registro.filtros.find(([op]) => op === 'gt')
  const haceUnAnio = new Date(AHORA.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()
  assert.ok(String(gt?.[2]) > haceUnAnio, 'la ventana llega más atrás de lo que se decidió')
})

// ── 3 · El resultado ────────────────────────────────────────────────────────

test('devuelve los cuerpos tal cual, en el orden en que llegan', async () => {
  const { cliente } = conFilas(['primero, el más reciente', 'segundo', 'tercero'])

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.equal(historial.estado, 'consultado')
  assert.equal(historial.codigo, null)
  assert.deepEqual(historial.previos, ['primero, el más reciente', 'segundo', 'tercero'])
})

test('sin historial reciente el estado sigue siendo «consultado»: es un hecho, no una duda', async () => {
  const { cliente } = conFilas([])

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.equal(historial.estado, 'consultado')
  assert.deepEqual(historial.previos, [])
})

test('una fila con el cuerpo nulo o en blanco no se compara con nada', async () => {
  const { cliente } = conFilas([null, '   ', 'un comentario de verdad'])

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.deepEqual(historial.previos, ['un comentario de verdad'])
})

// ── 4 · FALLO: «no pude» nunca es «no» ──────────────────────────────────────

test('FALLO · si PostgREST devuelve error, el estado es no_disponible y no lanza', async () => {
  const { cliente } = dobleSupabase(() => ({ data: null, error: { code: '57014', message: 'canceling statement' } }))

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.equal(historial.estado, 'no_disponible')
  assert.deepEqual(historial.previos, [])
  assert.equal(historial.codigo, '57014')
})

test('FALLO · si la consulta revienta (red caída), tampoco lanza', async () => {
  const { cliente } = dobleSupabase(() => {
    throw new Error('fetch failed')
  })

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  assert.equal(historial.estado, 'no_disponible')
  assert.deepEqual(historial.previos, [])
  assert.equal(historial.codigo, 'desconocido')
})

test('FALLO · el fallo no arrastra el mensaje de Postgres, solo el código', async () => {
  const { cliente } = dobleSupabase(() => ({
    data: null,
    error: { code: '42P01', message: 'relation "public.comments" does not exist' },
  }))

  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  const serializado = JSON.stringify(historial)
  assert.ok(!serializado.includes('public.comments'))
  assert.ok(!serializado.includes('does not exist'))
})

// ── 5 · La señal, ya alimentada ─────────────────────────────────────────────

const PLANTILLA =
  'Te leo y de verdad que te entiendo. A mí me pasó algo parecido hace un tiempo y ' +
  'lo que me ayudó fue hablarlo con alguien de confianza. Mucho ánimo con todo, ' +
  'seguro que sales de esta.'

const OTRO =
  'Lo del examen del martes me suena muchísimo. Yo repetí segundo y creía que era ' +
  'el fin del mundo; hoy ni me acuerdo de la nota. ¿Has podido contárselo a alguien ' +
  'de casa o te lo estás guardando?'

test('el MISMO texto pegado otra vez se rechaza por self_repetition', () => {
  const resultado = validateComment({ body: PLANTILLA, previousByAuthor: [PLANTILLA] })

  assert.equal(resultado.valid, false)
  assert.equal(resultado.reason, 'self_repetition')
  assert.ok(resultado.signals.includes('self_repetition'))
})

test('la plantilla escondida entre 19 comentarios distintos también se caza', () => {
  // El límite de 20 no sirve de nada si solo mira el último: la plantilla puede
  // estar en cualquier posición de la lista.
  const previos = [
    ...Array.from({ length: 19 }, (_, i) => `${OTRO} Y además esto que te cuento es distinto, número ${i}.`),
    PLANTILLA,
  ]

  const resultado = validateComment({ body: PLANTILLA, previousByAuthor: previos })

  assert.equal(resultado.valid, false)
  assert.equal(resultado.reason, 'self_repetition')
})

test('dos comentarios DISTINTOS de la misma persona no se penalizan', () => {
  const resultado = validateComment({ body: OTRO, previousByAuthor: [PLANTILLA] })

  assert.equal(resultado.valid, true)
  assert.equal(resultado.reason, 'ok')
  assert.ok(!resultado.signals.includes('self_repetition'))
})

test('FALLO · con el historial no disponible, un comentario sincero SIGUE validando', async () => {
  const { cliente } = dobleSupabase(() => ({ data: null, error: { code: '57014' } }))
  const historial = await leerPreviosDelAutor(cliente, { autorId: AUTOR, ahora: AHORA })

  // Exactamente lo que hace la ruta cuando la consulta no contestó: valida con
  // lo que sí tiene. Un timeout de Postgres no le dice a nadie «esto no cuenta».
  const resultado = validateComment({ body: OTRO, previousByAuthor: historial.previos })

  assert.equal(historial.estado, 'no_disponible')
  assert.equal(resultado.valid, true)
})

// ── 6 · La ruta está de verdad enchufada ────────────────────────────────────
//
// La señal lleva desde el primer día implementada y apagada porque nadie le
// pasaba los datos. Estos dos tests vigilan justo esa junta: son feos, y son
// los que se habrían dado cuenta.

const AQUI = import.meta.dirname

test('la ruta le pasa al validador el historial del autor, no solo el post', () => {
  const ruta = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.match(ruta, /leerPreviosDelAutor\(/)
  assert.match(ruta, /previosDelAutor:\s*historial\.previos/)
})

test('el historial que no se pudo leer se avisa por consola y no llega al cliente', () => {
  const ruta = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.match(ruta, /console\.warn\('\[darma\]\[b04\] historial del autor no disponible/)
  // El estado del historial no puede aparecer en el cuerpo de la respuesta:
  // decirle a alguien que la comprobación está ciega es enseñarle cuándo pegar.
  const sobre = ruta.slice(ruta.indexOf('return sobreOk<RespuestaComentar>'))
  assert.ok(!sobre.includes('historial'))
})
