import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ejecutarBorradosRgpd,
  ejecutarRetencionRgpd,
  LOTE_CADUCADAS,
  LOTE_RETENCION,
} from './rgpd.ts'
import type { ContextoTrabajo } from '../tipos.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Doble del cliente admin ─────────────────────────────────────────────────
// Solo se implementan las dos formas que estos trabajos usan: `rpc(nombre,
// args)` y `from(tabla).update(campos).eq(...).eq(...)` esperable. Es un doble
// a mano y no una librería a propósito: si mañana el trabajo empieza a usar
// otra forma del cliente, esta prueba revienta en vez de fingir que la conoce.

interface Llamada {
  rpc: string
  args: Record<string, unknown>
}

interface Actualizacion {
  tabla: string
  campos: Record<string, unknown>
  filtros: Array<[string, unknown]>
}

function adminFalso(opciones: {
  rpc: (nombre: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null }
  errorUpdate?: boolean
}) {
  const llamadas: Llamada[] = []
  const updates: Actualizacion[] = []

  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ rpc: nombre, args })
      const r = opciones.rpc(nombre, args)
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
    from(tabla: string) {
      return {
        update(campos: Record<string, unknown>) {
          const registro: Actualizacion = { tabla, campos, filtros: [] }
          updates.push(registro)
          const cadena = {
            eq(col: string, val: unknown) {
              registro.filtros.push([col, val])
              return cadena
            },
            then(
              resolver: (v: { error: { message: string } | null }) => unknown,
            ) {
              return Promise.resolve({
                error: opciones.errorUpdate ? { message: 'update falló' } : null,
              }).then(resolver)
            },
          }
          return cadena
        },
      }
    },
  }

  return { cliente: cliente as unknown as SupabaseClient, llamadas, updates }
}

function contexto(admin: SupabaseClient, agotado = () => false): ContextoTrabajo {
  return { admin, presupuestoMs: 12_000, ahora: () => 0, agotado }
}

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const SOL_A = '33333333-3333-4333-8333-333333333333'
const SOL_B = '44444444-4444-4444-8444-444444444444'

// ── Borrados ────────────────────────────────────────────────────────────────

test('borra cada cuenta vencida y CIERRA su solicitud como `done`', async () => {
  const { cliente, llamadas, updates } = adminFalso({
    rpc: (nombre) =>
      nombre === 'borrados_vencidos'
        ? { data: [{ user_id: UUID_A, solicitud_id: SOL_A }] }
        : {},
  })

  const r = await ejecutarBorradosRgpd(contexto(cliente))

  assert.deepEqual(llamadas.map((l) => l.rpc), ['borrados_vencidos', 'borrar_usuario'])
  assert.equal(llamadas[1].args.p_user, UUID_A)

  assert.equal(updates.length, 1)
  assert.equal(updates[0].tabla, 'privacy_requests')
  assert.equal(updates[0].campos.state, 'done')
  assert.ok(updates[0].campos.completed_at)
  // El cierre solo gana si la solicitud SIGUE en `confirmed`: una cancelación
  // que entre entre medias no se pisa.
  assert.deepEqual(updates[0].filtros, [
    ['id', SOL_A],
    ['state', 'confirmed'],
  ])

  assert.equal(r.estado, 'ok')
  assert.equal(r.detalle.borrados, 1)
  assert.equal(r.detalle.fallidos, 0)
})

test('UN BORRADO QUE FALLA NO PARA A LOS DEMÁS, y su solicitud sigue en cola', async () => {
  const { cliente, updates } = adminFalso({
    rpc: (nombre, args) => {
      if (nombre === 'borrados_vencidos') {
        return {
          data: [
            { user_id: UUID_A, solicitud_id: SOL_A },
            { user_id: UUID_B, solicitud_id: SOL_B },
          ],
        }
      }
      // El primero revienta; el segundo tiene que ejecutarse igual.
      if (args.p_user === UUID_A) return { error: { message: 'algo raro en el vault' } }
      return {}
    },
  })

  const r = await ejecutarBorradosRgpd(contexto(cliente))

  assert.equal(r.detalle.borrados, 1)
  assert.equal(r.detalle.fallidos, 1)

  // Al que falló se le anota el error PERO NO se le pone `failed`: `failed`
  // sacaría la fila de `borrados_vencidos()` para siempre y ese borrado no se
  // reintentaría jamás. Se queda en `confirmed` y mañana se vuelve a intentar.
  const fallido = updates.find((u) => u.filtros.some(([, v]) => v === SOL_A))
  assert.ok(fallido)
  assert.equal(fallido.campos.state, undefined)
  assert.ok(fallido.campos.error)

  const bueno = updates.find((u) => u.filtros.some(([, v]) => v === SOL_B))
  assert.equal(bueno?.campos.state, 'done')
})

test('NUNCA se marca `processing` antes de borrar: un fallo a medias no puede sacar la fila de la cola', async () => {
  const { cliente, updates } = adminFalso({
    rpc: (nombre) =>
      nombre === 'borrados_vencidos' ? { data: [{ user_id: UUID_A, solicitud_id: SOL_A }] } : {},
  })

  await ejecutarBorradosRgpd(contexto(cliente))

  assert.equal(
    updates.some((u) => u.campos.state === 'processing'),
    false,
    'un `processing` que no llega a `done` es un plazo legal incumplido en silencio',
  )
})

test('el detalle NO contiene identidades: son conteos, nunca uuids', async () => {
  const { cliente } = adminFalso({
    rpc: (nombre) =>
      nombre === 'borrados_vencidos'
        ? { data: [{ user_id: UUID_A, solicitud_id: SOL_A }] }
        : {},
  })

  const r = await ejecutarBorradosRgpd(contexto(cliente))
  const serializado = JSON.stringify(r.detalle)

  // `cron_runs` no puede convertirse en la lista de quién se fue.
  assert.equal(serializado.includes(UUID_A), false)
  assert.equal(serializado.includes(SOL_A), false)
})

test('PRESUPUESTO AGOTADO: se sale `parcial` sin tocar el resto del lote', async () => {
  let vueltas = 0
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) => {
      if (nombre === 'borrados_vencidos') {
        return {
          data: [
            { user_id: UUID_A, solicitud_id: SOL_A },
            { user_id: UUID_B, solicitud_id: SOL_B },
          ],
        }
      }
      vueltas += 1
      return {}
    },
  })

  // Agotado tras el primer borrado.
  const r = await ejecutarBorradosRgpd(contexto(cliente, () => vueltas >= 1))

  assert.equal(vueltas, 1)
  assert.equal(llamadas.filter((l) => l.rpc === 'borrar_usuario').length, 1)
  assert.equal(r.estado, 'parcial')
  assert.equal(r.detalle.sin_tocar, 1)
})

test('cola vacía: no llama a borrar_usuario y sale `ok`', async () => {
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) => (nombre === 'borrados_vencidos' ? { data: [] } : {}),
  })
  const r = await ejecutarBorradosRgpd(contexto(cliente))
  assert.deepEqual(llamadas.map((l) => l.rpc), ['borrados_vencidos'])
  assert.equal(r.estado, 'ok')
  assert.equal(r.detalle.borrados, 0)
})

test('CAMINO DE FALLO: si la cola no se puede leer, el trabajo LANZA (el despachador lo aísla)', async () => {
  const { cliente } = adminFalso({ rpc: () => ({ error: { message: 'base caída' } }) })
  await assert.rejects(() => ejecutarBorradosRgpd(contexto(cliente)), /base caída/)
})

// ── Retención ───────────────────────────────────────────────────────────────

/** Fila jsonb como la que devuelve `purgar_retencion()`. */
function lotePurga(parcial: Partial<Record<string, number>> = {}) {
  return {
    data: {
      content_views: 0,
      rate_limits: 0,
      refuge_messages: 0,
      moderation_flags: 0,
      crisis_events: 0,
      ...parcial,
    },
  }
}

test('encadena lotes hasta que no queda nada que purgar', async () => {
  let pasada = 0
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) => {
      // El barrido de caducadas no tiene cola en este escenario.
      if (nombre === 'barrer_solicitudes_caducadas') return { data: 0 }
      pasada += 1
      if (pasada === 1) return lotePurga({ content_views: LOTE_RETENCION, rate_limits: 5 })
      if (pasada === 2) return lotePurga({ content_views: 3 })
      return lotePurga()
    },
  })

  const r = await ejecutarRetencionRgpd(contexto(cliente))

  // Tres pasadas de purga: la tercera devuelve cero y corta el bucle.
  assert.equal(llamadas.filter((l) => l.rpc === 'purgar_retencion').length, 3)
  assert.equal(r.estado, 'ok')
  assert.equal(r.detalle.pasadas, 3)
  assert.equal(r.detalle.content_views, LOTE_RETENCION + 3)
  assert.equal(r.detalle.rate_limits, 5)
})

test('PRESUPUESTO AGOTADO a mitad de la purga: sale `parcial` y el resto es cosa de mañana', async () => {
  let pasada = 0
  const { cliente } = adminFalso({
    rpc: (nombre) => {
      if (nombre === 'barrer_solicitudes_caducadas') return { data: 0 }
      pasada += 1
      return lotePurga({ content_views: LOTE_RETENCION })
    },
  })

  const r = await ejecutarRetencionRgpd(contexto(cliente, () => pasada >= 2))

  assert.equal(pasada, 2)
  assert.equal(r.estado, 'parcial')
})

test('un presupuesto ya agotado al entrar no purga nada, no barre nada y no lanza', async () => {
  const { cliente, llamadas } = adminFalso({ rpc: () => ({ data: {} }) })
  const r = await ejecutarRetencionRgpd(contexto(cliente, () => true))
  assert.equal(llamadas.length, 0)
  assert.equal(r.estado, 'ok')
  assert.equal(r.detalle.pasadas, 0)
  assert.equal(r.detalle.solicitudes_caducadas, 0)
})

// ── Barrido de solicitudes `pending_confirm` caducadas (0215) ───────────────

test('BARRIDO: va ANTES de la purga y su conteo entra en el detalle', async () => {
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) =>
      nombre === 'barrer_solicitudes_caducadas' ? { data: 3 } : lotePurga(),
  })

  const r = await ejecutarRetencionRgpd(contexto(cliente))

  // Primero el barrido (diminuto y acotado), luego la purga: si el presupuesto
  // muere en la purga, el panel de privacidad ya quedó sin madera muerta.
  assert.equal(llamadas[0].rpc, 'barrer_solicitudes_caducadas')
  assert.equal(llamadas[0].args.p_limite, LOTE_CADUCADAS)
  assert.equal(r.detalle.solicitudes_caducadas, 3)
  assert.equal(r.estado, 'ok')
})

test('BARRIDO: encadena lotes mientras vengan llenos', async () => {
  let vuelta = 0
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) => {
      if (nombre !== 'barrer_solicitudes_caducadas') return lotePurga()
      vuelta += 1
      return { data: vuelta === 1 ? LOTE_CADUCADAS : 2 }
    },
  })

  const r = await ejecutarRetencionRgpd(contexto(cliente))

  assert.equal(llamadas.filter((l) => l.rpc === 'barrer_solicitudes_caducadas').length, 2)
  assert.equal(r.detalle.solicitudes_caducadas, LOTE_CADUCADAS + 2)
  assert.equal(r.estado, 'ok')
})

test('BARRIDO: lote lleno + presupuesto agotado ⇒ `parcial`, y la purga no llega a correr', async () => {
  let barridas = 0
  const { cliente, llamadas } = adminFalso({
    rpc: (nombre) => {
      if (nombre !== 'barrer_solicitudes_caducadas') return lotePurga()
      barridas += 1
      return { data: LOTE_CADUCADAS }
    },
  })

  const r = await ejecutarRetencionRgpd(contexto(cliente, () => barridas >= 1))

  assert.equal(barridas, 1)
  assert.equal(llamadas.filter((l) => l.rpc === 'purgar_retencion').length, 0)
  // Queda cola de caducadas: mañana continúa. No es un fallo, es `parcial`.
  assert.equal(r.estado, 'parcial')
})

test('BARRIDO: si falla, el trabajo LANZA (el despachador lo aísla)', async () => {
  const { cliente } = adminFalso({
    rpc: (nombre) =>
      nombre === 'barrer_solicitudes_caducadas'
        ? { error: { message: 'barrido caído' } }
        : lotePurga(),
  })
  await assert.rejects(() => ejecutarRetencionRgpd(contexto(cliente)), /barrido caído/)
})
