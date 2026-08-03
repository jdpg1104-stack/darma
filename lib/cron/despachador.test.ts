import test from 'node:test'
import assert from 'node:assert/strict'

import { despachar, PRESUPUESTO_DESPACHO_MS, RESERVA_REGISTRO_MS } from './despachador.ts'
import type { EjecucionTrabajo, ResultadoTrabajo, Trabajo } from './tipos.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// El despachador no toca la base: solo se lo pasa a los trabajos. Un objeto
// vacío basta y deja claro que ninguna de estas pruebas necesita Postgres.
const ADMIN = {} as unknown as SupabaseClient

/** Reloj de mentira: avanza solo cuando una prueba lo dice. */
function reloj(inicio = 0) {
  let t = inicio
  return {
    ahora: () => t,
    avanzar: (ms: number) => {
      t += ms
    },
  }
}

function trabajoQue(
  id: string,
  cuerpo: (ctx: { agotado: () => boolean; presupuestoMs: number }) => Promise<ResultadoTrabajo>,
  presupuestoMs = 5_000,
  minimoMs = 1_000,
): Trabajo {
  return { id, presupuestoMs, minimoMs, ejecutar: cuerpo }
}

// ── LA PROPIEDAD CENTRAL ────────────────────────────────────────────────────

test('UN FALLO NO BLOQUEA A LOS DEMÁS: el trabajo que lanza no impide los siguientes', async () => {
  const corridos: string[] = []

  const r = await despachar(
    'prueba',
    [
      trabajoQue('a', async () => {
        corridos.push('a')
        return { estado: 'ok', detalle: {} }
      }),
      trabajoQue('revienta', async () => {
        corridos.push('revienta')
        throw new Error('YouTube devolvió un HTML de error')
      }),
      trabajoQue('c', async () => {
        corridos.push('c')
        return { estado: 'ok', detalle: {} }
      }),
    ],
    { admin: ADMIN, ahora: () => 0 },
  )

  assert.deepEqual(corridos, ['a', 'revienta', 'c'])
  assert.deepEqual(
    r.trabajos.map((t) => t.estado),
    ['ok', 'error', 'ok'],
  )
  assert.equal(r.todoOk, false)
})

test('EL ORDEN DE PRIORIDAD SE RESPETA: la lista se recorre en secuencia, no en paralelo', async () => {
  const orden: string[] = []
  let dentro = 0

  const lento = (id: string): Trabajo =>
    trabajoQue(id, async () => {
      dentro += 1
      // Si el despachador lanzara los trabajos en paralelo, dos estarían dentro
      // a la vez y esta afirmación reventaría.
      assert.equal(dentro, 1)
      await new Promise((r) => setTimeout(r, 1))
      orden.push(id)
      dentro -= 1
      return { estado: 'ok', detalle: {} }
    })

  await despachar('prueba', [lento('rgpd'), lento('contenido'), lento('ranking')], {
    admin: ADMIN,
    ahora: () => 0,
  })

  assert.deepEqual(orden, ['rgpd', 'contenido', 'ranking'])
})

test('EL FALLO NO SE FILTRA: el mensaje del proveedor va al detalle, y el despachador no lanza', async () => {
  const r = await despachar(
    'prueba',
    [trabajoQue('x', async () => Promise.reject(new TypeError('fetch failed: ENOTFOUND')))],
    { admin: ADMIN, ahora: () => 0 },
  )

  assert.equal(r.trabajos[0].estado, 'error')
  assert.equal(r.trabajos[0].detalle.motivo, 'TypeError')
  assert.match(String(r.trabajos[0].detalle.mensaje), /ENOTFOUND/)
})

test('CAMINO DE FALLO: un objeto lanzado que no es Error no rompe el registro', async () => {
  const r = await despachar('prueba', [trabajoQue('x', async () => Promise.reject('texto suelto'))], {
    admin: ADMIN,
    ahora: () => 0,
  })
  assert.equal(r.trabajos[0].estado, 'error')
  assert.equal(r.trabajos[0].detalle.motivo, 'desconocido')
})

// ── PRESUPUESTO ─────────────────────────────────────────────────────────────

test('PRESUPUESTO AGOTADO: lo que no cabe se registra `sin_tiempo`, no desaparece', async () => {
  const c = reloj()
  const corridos: string[] = []

  const r = await despachar(
    'prueba',
    [
      trabajoQue(
        'devora',
        async () => {
          corridos.push('devora')
          c.avanzar(9_500) // se come casi todo el presupuesto global
          return { estado: 'ok', detalle: {} }
        },
        9_000,
        1_000,
      ),
      trabajoQue(
        'no-cabe',
        async () => {
          corridos.push('no-cabe')
          return { estado: 'ok', detalle: {} }
        },
        5_000,
        2_000,
      ),
    ],
    { admin: ADMIN, ahora: c.ahora, presupuestoMs: 10_000 },
  )

  // El segundo NO se ejecutó...
  assert.deepEqual(corridos, ['devora'])
  // ...pero SÍ dejó fila. Es la diferencia entre una avería visible y un feed
  // que lleva tres días viejo sin que nadie sepa por qué.
  assert.equal(r.trabajos.length, 2)
  assert.equal(r.trabajos[1].estado, 'sin_tiempo')
  assert.equal(r.trabajos[1].ms, 0)
  assert.equal(r.trabajos[1].detalle.minimo_ms, 2_000)
  assert.equal(r.todoOk, false)
})

test('EL PRESUPUESTO DE UN TRABAJO NUNCA EXCEDE LO QUE QUEDA MENOS LA RESERVA', async () => {
  const c = reloj()
  let recibido = -1

  await despachar(
    'prueba',
    [
      trabajoQue(
        'grande',
        async (ctx) => {
          recibido = ctx.presupuestoMs
          return { estado: 'ok', detalle: {} }
        },
        50_000, // pide mucho más de lo que queda
        1_000,
      ),
    ],
    { admin: ADMIN, ahora: c.ahora, presupuestoMs: 10_000 },
  )

  assert.equal(recibido, 10_000 - RESERVA_REGISTRO_MS)
})

test('`agotado()` se vuelve true al pasar el presupuesto DEL TRABAJO, no el global', async () => {
  const c = reloj()
  let vueltas = 0

  await despachar(
    'prueba',
    [
      trabajoQue(
        'bucle',
        async (ctx) => {
          while (!ctx.agotado()) {
            vueltas += 1
            c.avanzar(1_000)
            if (vueltas > 100) break // red de seguridad de la prueba
          }
          return { estado: 'parcial', detalle: { vueltas } }
        },
        4_000,
        1_000,
      ),
    ],
    { admin: ADMIN, ahora: c.ahora, presupuestoMs: 52_000 },
  )

  assert.equal(vueltas, 4)
})

test('`parcial` NO es un fallo: un trabajo reanudable que no termina deja todoOk en true', async () => {
  const r = await despachar(
    'prueba',
    [trabajoQue('reanudable', async () => ({ estado: 'parcial', detalle: { hechas: 3 } }))],
    { admin: ADMIN, ahora: () => 0 },
  )
  assert.equal(r.trabajos[0].estado, 'parcial')
  assert.equal(r.todoOk, true)
})

// ── REGISTRO ────────────────────────────────────────────────────────────────

test('EL REGISTRO ES INCREMENTAL: se escribe tras cada trabajo, no al final', async () => {
  const escritas: Array<[string, string]> = []
  const corridos: string[] = []

  await despachar(
    'prueba',
    [
      trabajoQue('a', async () => {
        // En el momento de correr `a` no puede haber ninguna fila escrita aún;
        // en el de correr `b` tiene que estar ya la de `a`.
        assert.deepEqual(escritas, [])
        corridos.push('a')
        return { estado: 'ok', detalle: {} }
      }),
      trabajoQue('b', async () => {
        assert.deepEqual(escritas, [['a', 'ok']])
        corridos.push('b')
        return { estado: 'ok', detalle: {} }
      }),
    ],
    {
      admin: ADMIN,
      ahora: () => 0,
      alTerminarTrabajo: async (fila: EjecucionTrabajo) => {
        escritas.push([fila.trabajo, fila.estado])
      },
    },
  )

  assert.deepEqual(corridos, ['a', 'b'])
  assert.deepEqual(escritas, [
    ['a', 'ok'],
    ['b', 'ok'],
  ])
})

test('CAMINO DE FALLO: si el registro lanza, los trabajos siguientes corren igual', async () => {
  const corridos: string[] = []

  const r = await despachar(
    'prueba',
    [
      trabajoQue('a', async () => {
        corridos.push('a')
        return { estado: 'ok', detalle: {} }
      }),
      trabajoQue('b', async () => {
        corridos.push('b')
        return { estado: 'ok', detalle: {} }
      }),
    ],
    {
      admin: ADMIN,
      ahora: () => 0,
      alTerminarTrabajo: async () => {
        throw new Error('cron_runs no responde')
      },
    },
  )

  assert.deepEqual(corridos, ['a', 'b'])
  assert.equal(r.todoOk, true)
})

test('el presupuesto global por defecto deja margen bajo el maxDuration de 60 s', () => {
  assert.ok(PRESUPUESTO_DESPACHO_MS <= 55_000, 'sin margen para cerrar y registrar')
  assert.ok(PRESUPUESTO_DESPACHO_MS >= 40_000, 'presupuesto absurdamente corto')
})

test('lista vacía: no lanza y devuelve todoOk', async () => {
  const r = await despachar('prueba', [], { admin: ADMIN, ahora: () => 0 })
  assert.deepEqual(r.trabajos, [])
  assert.equal(r.todoOk, true)
})
