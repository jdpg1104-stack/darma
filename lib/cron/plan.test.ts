import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESUPUESTO_DESPACHO_MS } from './despachador.ts'
import { HORAS_ROLLUP, PLAN_DIARIO, PLAN_MODERACION, planFrecuente } from './plan.ts'

// ── EL ORDEN, QUE ES LA PRIORIDAD ───────────────────────────────────────────

test('LO QUE TIENE PLAZO LEGAL VA PRIMERO, no al final', () => {
  const ids = PLAN_DIARIO.map((t) => t.id)
  assert.equal(ids[0], 'rgpd-borrados')
  assert.equal(ids[1], 'rgpd-retencion')

  // Y por delante de TODO lo demás, no solo de su vecino: si alguien reordena
  // la lista y mete la ingesta antes que el borrado, esta prueba lo para.
  const primerNoRgpd = ids.findIndex((id) => !id.startsWith('rgpd-'))
  assert.equal(primerNoRgpd, 2)
})

test('la deuda con una persona (karma sin cobrar) va por delante del contenido', () => {
  const ids = PLAN_DIARIO.map((t) => t.id)
  assert.ok(
    ids.indexOf('moderacion-pendiente') < ids.indexOf('contenido-videos'),
    'el reproceso de moderación debe ir antes que la ingesta',
  )
})

test('retirar lo roto va antes que añadir lo nuevo', () => {
  const ids = PLAN_DIARIO.map((t) => t.id)
  assert.ok(ids.indexOf('contenido-reverificar') < ids.indexOf('contenido-videos'))
  assert.ok(ids.indexOf('contenido-reverificar') < ids.indexOf('contenido-articulos'))
})

test('la higiene del propio registro va la última: es lo único prescindible un día', () => {
  assert.equal(PLAN_DIARIO[PLAN_DIARIO.length - 1].id, 'purga-registro-cron')
})

// ── EL REPARTO DE PRESUPUESTO ───────────────────────────────────────────────

test('la suma de presupuestos de la lista diaria CABE en el presupuesto global', () => {
  // Si no cupiera, los últimos trabajos saldrían `sin_tiempo` TODOS los días en
  // vez de solo los días malos, y el reparto sería una ficción.
  const suma = PLAN_DIARIO.reduce((n, t) => n + t.presupuestoMs, 0)
  assert.ok(
    suma <= PRESUPUESTO_DESPACHO_MS,
    `los ${suma} ms del plan no caben en los ${PRESUPUESTO_DESPACHO_MS} ms del despacho`,
  )
})

test('ningún trabajo pide un mínimo mayor que su propio presupuesto', () => {
  for (const t of [...PLAN_DIARIO, ...planFrecuente(23), ...PLAN_MODERACION]) {
    assert.ok(t.minimoMs > 0, `${t.id}: mínimo no positivo`)
    assert.ok(t.minimoMs <= t.presupuestoMs, `${t.id}: mínimo por encima de su presupuesto`)
  }
})

test('los identificadores de trabajo son únicos dentro de cada plan', () => {
  for (const plan of [PLAN_DIARIO, planFrecuente(23), PLAN_MODERACION]) {
    const ids = plan.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length)
  }
})

test('los identificadores caben en el check de cron_runs.trabajo (64 caracteres)', () => {
  for (const t of [...PLAN_DIARIO, ...planFrecuente(23)]) {
    assert.ok(t.id.length >= 1 && t.id.length <= 64, `${t.id}: identificador fuera de rango`)
  }
})

// ── EL PLAN FRECUENTE Y LA VENTANA DEL ROLLUP ───────────────────────────────

test('el ranking se reconstruye a CUALQUIER hora: es lo que impide que el tablero se congele', () => {
  for (let h = 0; h < 24; h += 1) {
    assert.ok(
      planFrecuente(h).some((t) => t.id === 'ranking-snapshot'),
      `hora ${h}: falta el snapshot`,
    )
  }
})

test('el rollup de métricas SOLO corre al final del día UTC', () => {
  // No es una optimización: `admin_rollup_dia` mide daily_karma_earned, que se
  // reinicia cada día. Un rollup a las 04:00 mediría un día vacío y lo
  // escribiría encima del bueno (upsert).
  for (let h = 0; h < 24; h += 1) {
    const tieneRollup = planFrecuente(h).some((t) => t.id === 'metricas-rollup')
    assert.equal(tieneRollup, HORAS_ROLLUP.includes(h), `hora ${h}`)
  }
})

test('la ventana del rollup tiene más de una hora: un disparo perdido no cuesta el día', () => {
  assert.ok(HORAS_ROLLUP.length >= 2)
  assert.ok(HORAS_ROLLUP.every((h) => h >= 0 && h <= 23))
})

test('el plan frecuente también cabe en el presupuesto global, con rollup incluido', () => {
  const suma = planFrecuente(23).reduce((n, t) => n + t.presupuestoMs, 0)
  assert.ok(suma <= PRESUPUESTO_DESPACHO_MS, `${suma} ms no caben`)
})

// ── LA RED DE SEGURIDAD ─────────────────────────────────────────────────────

test('el ranking está en las DOS listas: el tablero no depende de que el cron horario exista', () => {
  // El plan Hobby no garantiza el disparo horario. Si el despachador frecuente
  // se degradara a diario, el tablero seguiría refrescándose desde la lista
  // diaria en vez de congelarse en silencio.
  assert.ok(PLAN_DIARIO.some((t) => t.id === 'ranking-snapshot'))
  assert.ok(planFrecuente(4).some((t) => t.id === 'ranking-snapshot'))
})

test('la ruta suelta de moderación corre el MISMO trabajo, con más reloj', () => {
  assert.equal(PLAN_MODERACION.length, 1)
  assert.equal(PLAN_MODERACION[0].id, 'moderacion-pendiente')
  const enDiario = PLAN_DIARIO.find((t) => t.id === 'moderacion-pendiente')
  assert.ok(enDiario)
  assert.ok(PLAN_MODERACION[0].presupuestoMs > enDiario.presupuestoMs)
  assert.equal(PLAN_MODERACION[0].ejecutar, enDiario.ejecutar)
})

// ── COBERTURA: NINGÚN TRABAJO PEDIDO SE QUEDA FUERA ─────────────────────────

test('los ocho trabajos que hoy no ejecuta nadie están programados', () => {
  const programados = new Set([
    ...PLAN_DIARIO.map((t) => t.id),
    ...planFrecuente(23).map((t) => t.id),
  ])
  for (const id of [
    'rgpd-borrados', // B20 · art. 12.3
    'rgpd-retencion', // B20 · /legal/retencion
    'moderacion-pendiente', // B11 · karma que nadie recupera
    'contenido-videos', // B08
    'contenido-articulos', // B08
    'contenido-reverificar', // B08
    'ranking-snapshot', // B06 · el tablero congelado
    'metricas-rollup', // B19 · el panel congelado
  ]) {
    assert.ok(programados.has(id), `${id} no está en ningún despachador`)
  }
})
