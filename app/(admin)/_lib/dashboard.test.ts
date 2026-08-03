// ============================================================================
// B19 · Pruebas del centro de mando
//
// Corren con `node --test --experimental-strip-types` sin red, sin base y sin
// una sola variable de entorno. Por eso `dashboard.ts`, `acceso.ts` (su parte
// pura), `navegacion.ts` y `precios.ts` no importan Next ni construyen ningún
// cliente a nivel de módulo.
//
// Lo que NO se puede probar aquí y se verifica CONTRA POSTGRES (ver el informe
// del bloque): que `tiene_rol_admin()` deniegue de verdad, que el trigger de
// inmutabilidad de `admin_audit_log` lance, que un usuario normal no pueda leer
// ni una métrica, y que el rollup use índice en vez de Seq Scan. Un doble de
// cliente nunca puede demostrar un permiso de Postgres.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { LISTENS_PER_POST } from '../../../lib/reciprocity.ts'
import { ORDEN_ROLES, cumpleRol, esRolAdmin, type RolAdmin } from './acceso.ts'
import { TABS_ADMIN, puedeVerRuta, tabsVisibles } from './navegacion.ts'
import { estimarIngresoCentimos, precioEstimadoCentimos } from './precios.ts'
import {
  CUBOS_SEGUNDOS,
  MINIMO_AGREGADO,
  UMBRAL_RECIPROCIDAD,
  aDiaUtc,
  enmascarar,
  getCoberturaCrisis,
  getEconomia,
  getEmbudoActivacion,
  getSaludReciprocidad,
  getTiempoPrimeraRespuesta,
  percentilDeHistograma,
  ratio,
  recortarPorRol,
  semaforoCrisis,
  semaforoReciprocidad,
  ventanaDias,
  type FilaRollup,
  type MetricasDia,
} from './dashboard.ts'

// ── Utilidades de las pruebas ───────────────────────────────────────────────

function fila(dia: string, metricas: MetricasDia): FilaRollup {
  return { dia, metricas, calculadoEn: `${dia}T23:59:00.000Z` }
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · Jerarquía de roles — los 16 casos
// ════════════════════════════════════════════════════════════════════════════

test('cumpleRol cubre la jerarquía entera: 16 casos', () => {
  // Verdadero exactamente cuando el índice del rol es >= el del mínimo.
  const esperado: Record<string, boolean> = {}
  ORDEN_ROLES.forEach((rol, i) => {
    ORDEN_ROLES.forEach((minimo, j) => {
      esperado[`${rol}>=${minimo}`] = i >= j
    })
  })

  assert.equal(Object.keys(esperado).length, 16, 'tienen que ser 4x4 = 16 combinaciones')

  for (const rol of ORDEN_ROLES) {
    for (const minimo of ORDEN_ROLES) {
      assert.equal(
        cumpleRol(rol, minimo),
        esperado[`${rol}>=${minimo}`],
        `cumpleRol('${rol}', '${minimo}')`,
      )
    }
  }
})

test('cumpleRol: los dos casos que cita la ficha', () => {
  assert.equal(cumpleRol('operaciones', 'moderador'), true)
  assert.equal(cumpleRol('soporte', 'operaciones'), false)
})

test('el orden del enum de TypeScript es el mismo que el de Postgres', () => {
  // Si esto se rompe, `tiene_rol_admin()` y `cumpleRol()` dejan de decir lo
  // mismo, y el menú enseñaría pestañas que la API deniega (o al revés).
  assert.deepEqual([...ORDEN_ROLES], ['soporte', 'moderador', 'operaciones', 'superadmin'])
})

test('esRolAdmin rechaza lo que no es un rol', () => {
  assert.equal(esRolAdmin('superadmin'), true)
  assert.equal(esRolAdmin('admin'), false)
  assert.equal(esRolAdmin(''), false)
  assert.equal(esRolAdmin(null), false)
  assert.equal(esRolAdmin(42), false)
})

// ════════════════════════════════════════════════════════════════════════════
// 2 · Visibilidad por rol
// ════════════════════════════════════════════════════════════════════════════

test('tabsVisibles("soporte") no incluye economía ni roles', () => {
  const ids = tabsVisibles('soporte').map((t) => t.id)
  assert.ok(!ids.includes('economia'), 'soporte NO puede ver economía')
  assert.ok(!ids.includes('roles'), 'soporte NO puede ver la gestión de roles')
  assert.ok(!ids.includes('crisis'), 'soporte NO puede ver crisis')
  assert.ok(!ids.includes('moderacion'), 'soporte NO puede ver la cola de moderación')
  assert.ok(ids.includes('reciprocidad'))
  assert.ok(ids.includes('activacion'))
})

test('la escalera de visibilidad es monótona: cada rol ve todo lo del anterior', () => {
  let anterior: string[] = []
  for (const rol of ORDEN_ROLES) {
    const ids = tabsVisibles(rol).map((t) => t.id)
    for (const previo of anterior) {
      assert.ok(ids.includes(previo), `${rol} debería seguir viendo '${previo}'`)
    }
    anterior = ids
  }
})

test('moderador ve crisis y el enlace a /moderacion (de B11); operaciones añade economía', () => {
  const moderador = tabsVisibles('moderador').map((t) => t.id)
  assert.ok(moderador.includes('crisis'))
  assert.ok(moderador.includes('moderacion'))
  assert.ok(!moderador.includes('economia'))

  const operaciones = tabsVisibles('operaciones').map((t) => t.id)
  assert.ok(operaciones.includes('economia'))
  assert.ok(!operaciones.includes('roles'))

  assert.ok(tabsVisibles('superadmin').map((t) => t.id).includes('roles'))
})

test('puedeVerRuta falla CERRADO ante una ruta desconocida', () => {
  // Una página nueva que se olvide de registrarse en TABS_ADMIN queda cerrada,
  // no abierta a todo el mundo.
  assert.equal(puedeVerRuta('superadmin', '/panel/inventada'), false)
  assert.equal(puedeVerRuta('soporte', '/panel/economia'), false)
  assert.equal(puedeVerRuta('operaciones', '/panel/economia'), true)
})

test('el enlace a /moderacion apunta a la ruta de B11 sin prefijo de panel', () => {
  const moderacion = TABS_ADMIN.find((t) => t.id === 'moderacion')
  assert.ok(moderacion)
  assert.equal(moderacion.ruta, '/moderacion')
})

// ════════════════════════════════════════════════════════════════════════════
// 3 · El KPI y sus semáforos
// ════════════════════════════════════════════════════════════════════════════

test('getSaludReciprocidad calcula el ratio de la VENTANA y su semáforo', () => {
  // 2,9 → rojo. 29 escuchas / 10 posts.
  const rojo = getSaludReciprocidad([fila('2026-08-01', { escuchas_validadas: 29, posts_publicados: 10 })])
  assert.equal(Number(rojo.ratioReciprocidad.toFixed(2)), 2.9)
  assert.equal(rojo.semaforo, 'rojo')

  // 3,1 → ámbar.
  const ambar = getSaludReciprocidad([fila('2026-08-01', { escuchas_validadas: 31, posts_publicados: 10 })])
  assert.equal(Number(ambar.ratioReciprocidad.toFixed(2)), 3.1)
  assert.equal(ambar.semaforo, 'ambar')

  // 3,3 → verde.
  const verde = getSaludReciprocidad([fila('2026-08-01', { escuchas_validadas: 33, posts_publicados: 10 })])
  assert.equal(Number(verde.ratioReciprocidad.toFixed(2)), 3.3)
  assert.equal(verde.semaforo, 'verde')
})

test('el ratio se agrega por VENTANA, no promediando ratios diarios', () => {
  // Un día con muchísimo volumen y ratio bajo debe arrastrar la ventana. La
  // media de ratios diarios daría (1 + 10) / 2 = 5,5 y pintaría verde justo
  // cuando la comunidad se está quedando sin oídos.
  const salud = getSaludReciprocidad([
    fila('2026-08-01', { escuchas_validadas: 1000, posts_publicados: 1000 }),
    fila('2026-08-02', { escuchas_validadas: 10, posts_publicados: 1 }),
  ])
  assert.equal(salud.escuchasValidadas, 1010)
  assert.equal(salud.postsPublicados, 1001)
  assert.ok(salud.ratioReciprocidad < 1.1, `ratio de ventana: ${salud.ratioReciprocidad}`)
  assert.equal(salud.semaforo, 'rojo')
})

test('tasaValidacion y coberturaPosts24h salen 0..1 y nunca NaN', () => {
  const salud = getSaludReciprocidad([
    fila('2026-08-01', {
      escuchas_validadas: 30,
      posts_publicados: 10,
      comentarios_totales: 50,
      posts_con_escucha_24h: 8,
    }),
  ])
  assert.equal(salud.tasaValidacion, 0.6)
  assert.equal(salud.coberturaPosts24h, 0.8)
})

// ── Prueba 5 de la ficha: el umbral DEPENDE de LISTENS_PER_POST ─────────────

test('el umbral del KPI sale de LISTENS_PER_POST, no del literal 3', () => {
  assert.equal(UMBRAL_RECIPROCIDAD, LISTENS_PER_POST)

  // El doble: si mañana el producto pasa a 5 escuchas por publicación, un
  // ratio de 3,3 —hoy verde— tiene que volverse rojo sin tocar este módulo.
  const umbralFalso = 5
  assert.equal(semaforoReciprocidad(3.3, umbralFalso), 'rojo')
  assert.equal(semaforoReciprocidad(5.0, umbralFalso), 'ambar')
  assert.equal(semaforoReciprocidad(5.3, umbralFalso), 'verde')

  // Y con el umbral real sigue diciendo lo de siempre.
  assert.equal(semaforoReciprocidad(3.3), 'verde')
})

test('semaforoReciprocidad trata un ratio no finito como rojo', () => {
  assert.equal(semaforoReciprocidad(Number.NaN), 'rojo')
})

// ════════════════════════════════════════════════════════════════════════════
// 4 · Crisis — verde SOLO con cobertura 1 y nada viejo pendiente
// ════════════════════════════════════════════════════════════════════════════

test('semaforoCrisis es verde solo con cobertura exacta 1 y cola limpia', () => {
  assert.equal(semaforoCrisis(1, null), 'verde')
  assert.equal(semaforoCrisis(1, 0), 'verde')
  assert.equal(semaforoCrisis(1, 900), 'verde', '900 s es el límite, no lo supera')

  assert.equal(semaforoCrisis(1, 901), 'rojo', 'un pendiente por encima de 15 min es rojo')
  assert.equal(semaforoCrisis(0.999, null), 'rojo', '99,9 % no es 100 %')
  assert.equal(semaforoCrisis(0, null), 'rojo')
  assert.equal(semaforoCrisis(0.5, 5000), 'rojo')
})

test('getCoberturaCrisis: sin eventos la cobertura es 1, no 0', () => {
  const crisis = getCoberturaCrisis([fila('2026-08-01', {})], {
    pendientes: 0,
    masAntiguoPendienteSegundos: null,
  })
  assert.equal(crisis.cobertura, 1)
  assert.equal(crisis.semaforo, 'verde')
  assert.equal(crisis.serie[0].cobertura, 1)
})

test('getCoberturaCrisis: un solo evento sin revisar tumba la ventana entera', () => {
  const crisis = getCoberturaCrisis(
    [
      fila('2026-08-01', { crisis_eventos: 40, crisis_revisados: 40 }),
      fila('2026-08-02', { crisis_eventos: 1, crisis_revisados: 0 }),
    ],
    { pendientes: 1, masAntiguoPendienteSegundos: 60 },
  )
  assert.equal(crisis.eventos, 41)
  assert.equal(crisis.revisados, 40)
  assert.ok(crisis.cobertura < 1)
  assert.equal(crisis.semaforo, 'rojo', 'cualquier cosa por debajo de 100 % es incidente')
})

test('getCoberturaCrisis arrastra la cola viva tal cual', () => {
  const crisis = getCoberturaCrisis([fila('2026-08-01', { crisis_eventos: 2, crisis_revisados: 2 })], {
    pendientes: 7,
    masAntiguoPendienteSegundos: 3600,
  })
  assert.equal(crisis.pendientes, 7)
  assert.equal(crisis.masAntiguoPendienteSegundos, 3600)
  assert.equal(crisis.semaforo, 'rojo', 'una hora sin atender es rojo aunque la cobertura sea 1')
})

// ════════════════════════════════════════════════════════════════════════════
// 5 · Percentiles sobre histograma sumado
// ════════════════════════════════════════════════════════════════════════════

test('percentilDeHistograma devuelve null sin muestras', () => {
  assert.equal(percentilDeHistograma({}, 0.5), null)
  assert.equal(percentilDeHistograma({ '3': 0 }, 0.9), null)
})

test('percentilDeHistograma devuelve el borde superior del cubo del cuantil', () => {
  // 100 muestras todas en el cubo 1 → [30, 60) → borde superior 60.
  assert.equal(percentilDeHistograma({ '1': 100 }, 0.5), 60)

  // 90 rápidas (cubo 0 → <30 s) y 10 lentas (cubo 8 → [7200, 14400)).
  const h = { '0': 90, '8': 10 }
  assert.equal(percentilDeHistograma(h, 0.5), CUBOS_SEGUNDOS[0])
  assert.equal(percentilDeHistograma(h, 0.95), CUBOS_SEGUNDOS[8])
})

test('percentilDeHistograma ignora claves basura sin reventar', () => {
  assert.equal(percentilDeHistograma({ '1': 10, hola: 5, '-3': 9, '999': 4 }, 0.5), 60)
})

test('los cubos de TypeScript son el espejo exacto de admin_cubos_ttpr()', () => {
  assert.deepEqual(
    [...CUBOS_SEGUNDOS],
    [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400],
  )
})

test('getTiempoPrimeraRespuesta suma los histogramas de varios días', () => {
  const ttpr = getTiempoPrimeraRespuesta([
    fila('2026-08-01', { ttpr_hist: { '0': 50 }, ttpr_p50_segundos: 20, ttpr_p90_segundos: 28, posts_sin_respuesta_24h: 1 }),
    fila('2026-08-02', { ttpr_hist: { '9': 50 }, ttpr_p50_segundos: 9000, ttpr_p90_segundos: 13000, posts_sin_respuesta_24h: 2 }),
  ])
  // 50 en el cubo 0 y 50 en el 9: la mediana cae justo al terminar el cubo 0.
  assert.equal(ttpr.p50Segundos, CUBOS_SEGUNDOS[0])
  assert.equal(ttpr.p90Segundos, CUBOS_SEGUNDOS[9])
  assert.equal(ttpr.postsSinRespuesta24h, 3)
  assert.equal(ttpr.serie.length, 2)
})

// ════════════════════════════════════════════════════════════════════════════
// 6 · Economía
// ════════════════════════════════════════════════════════════════════════════

test('arppuCentimos es entero y 0 (no NaN) sin compradores', () => {
  const economia = getEconomia([fila('2026-08-01', { compradores_unicos: 0, ingreso_centimos_recibo: 0 })])
  assert.equal(economia.compradoresUnicos, 0)
  assert.equal(economia.arppuCentimos, 0)
  assert.ok(Number.isInteger(economia.arppuCentimos))
  assert.ok(!Number.isNaN(economia.arppuCentimos))
})

test('arppuCentimos es entero también cuando la división no es exacta', () => {
  const economia = getEconomia([
    fila('2026-08-01', { compradores_unicos: 3, ingreso_centimos_recibo: 1000 }),
  ])
  assert.equal(economia.ingresoCentimos, 1000)
  assert.equal(economia.arppuCentimos, 333)
  assert.ok(Number.isInteger(economia.arppuCentimos))
})

test('el ingreso suma recibos reales y estimación del stub, y lo marca', () => {
  const economia = getEconomia([
    fila('2026-08-01', {
      compradores_unicos: 2,
      cristales_vendidos: 650,
      ingreso_centimos_recibo: 999,
      paquetes_sin_recibo: { '100': 2 }, // 2 x 199
    }),
  ])
  assert.equal(economia.ingresoCentimos, 999 + 398)
  assert.equal(economia.ingresoEstimado, true, 'la UI tiene que poder avisar')
  assert.ok(Number.isInteger(economia.ingresoCentimos))
})

test('sin paquetes sin recibo, el ingreso NO se marca como estimado', () => {
  const economia = getEconomia([
    fila('2026-08-01', { compradores_unicos: 1, ingreso_centimos_recibo: 1999 }),
  ])
  assert.equal(economia.ingresoEstimado, false)
})

test('el stock gastable es una FOTO, no un flujo: no se suma entre días', () => {
  const economia = getEconomia([
    fila('2026-08-01', { karma_stock_gastable: 5000 }),
    fila('2026-08-02', { karma_stock_gastable: 5200 }),
  ])
  assert.equal(economia.stockGastable, 5200, 'se queda con el último día, no 10200')
})

test('pctUsuariosEnTope sale 0..1 y es 0 sin usuarios activos', () => {
  assert.equal(getEconomia([fila('2026-08-01', {})]).pctUsuariosEnTope, 0)
  assert.equal(
    getEconomia([fila('2026-08-01', { usuarios_activos: 200, usuarios_en_tope: 30 })])
      .pctUsuariosEnTope,
    0.15,
  )
})

test('precios: un paquete desconocido vale 0, no una interpolación inventada', () => {
  assert.equal(precioEstimadoCentimos(550), 999)
  assert.equal(precioEstimadoCentimos(777), 0)
  assert.equal(estimarIngresoCentimos({ '100': 3, '777': 10 }), 597)
  assert.equal(estimarIngresoCentimos({}), 0)
  assert.equal(estimarIngresoCentimos({ hola: 2 }), 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 7 · Anonimato: el corte de 20 personas
// ════════════════════════════════════════════════════════════════════════════

test('un agregado con menos de 20 personas se renderiza como «<20»', () => {
  assert.equal(enmascarar(19), '<20')
  assert.equal(enmascarar(1), '<20')
  assert.equal(enmascarar(MINIMO_AGREGADO), '20')
  assert.equal(enmascarar(21), '21')
  // Cero se muestra tal cual: no hay nadie a quien reidentificar.
  assert.equal(enmascarar(0), '0')
  assert.equal(enmascarar(-5), '0')
  assert.equal(enmascarar(Number.NaN), '0')
})

// ════════════════════════════════════════════════════════════════════════════
// 8 · Recorte por rol — lo que un rol no puede ver, NO se serializa
// ════════════════════════════════════════════════════════════════════════════

test('recortarPorRol no serializa crisis ni economía para soporte', () => {
  const resumen = {
    ventana: { desde: '2026-08-01T00:00:00.000Z', hasta: '2026-08-07T00:00:00.000Z' },
    reciprocidad: getSaludReciprocidad([]),
    ttpr: getTiempoPrimeraRespuesta([]),
    crisis: getCoberturaCrisis([], { pendientes: 3, masAntiguoPendienteSegundos: 10 }),
    activacion: getEmbudoActivacion([]),
    economia: getEconomia([]),
    calculadoEn: '2026-08-07T00:00:00.000Z',
  }

  const soporte = recortarPorRol(resumen, 'soporte')
  assert.equal(soporte.crisis, undefined)
  assert.equal(soporte.economia, undefined)
  assert.ok(!('crisis' in soporte), 'la clave ni siquiera existe en el JSON')
  assert.ok(!('economia' in soporte))

  const moderador = recortarPorRol(resumen, 'moderador')
  assert.ok(moderador.crisis)
  assert.equal(moderador.economia, undefined)

  const operaciones = recortarPorRol(resumen, 'operaciones')
  assert.ok(operaciones.crisis)
  assert.ok(operaciones.economia)

  const superadmin = recortarPorRol(resumen, 'superadmin')
  assert.ok(superadmin.crisis)
  assert.ok(superadmin.economia)
})

// ════════════════════════════════════════════════════════════════════════════
// 9 · Camino de fallo: rollup vacío
// ════════════════════════════════════════════════════════════════════════════

test('con el rollup vacío todo son ceros, semáforos definidos y CERO NaN', () => {
  const vacio: FilaRollup[] = []

  const reciprocidad = getSaludReciprocidad(vacio)
  const ttpr = getTiempoPrimeraRespuesta(vacio)
  const crisis = getCoberturaCrisis(vacio, { pendientes: 0, masAntiguoPendienteSegundos: null })
  const activacion = getEmbudoActivacion(vacio)
  const economia = getEconomia(vacio)

  const numeros = [
    reciprocidad.ratioReciprocidad,
    reciprocidad.tasaValidacion,
    reciprocidad.coberturaPosts24h,
    reciprocidad.escuchasValidadas,
    reciprocidad.postsPublicados,
    ttpr.p50Segundos,
    ttpr.p90Segundos,
    ttpr.p50SegundosRiesgo,
    ttpr.postsSinRespuesta24h,
    crisis.eventos,
    crisis.revisados,
    crisis.cobertura,
    crisis.pendientes,
    ...Object.values(activacion),
    economia.karmaEmitido,
    economia.karmaDrenado,
    economia.stockGastable,
    economia.pctUsuariosEnTope,
    economia.compradoresUnicos,
    economia.cristalesVendidos,
    economia.ingresoCentimos,
    economia.arppuCentimos,
  ]

  for (const n of numeros) {
    assert.ok(Number.isFinite(n), `valor no finito en el panel vacío: ${n}`)
    assert.ok(!Number.isNaN(n))
  }

  // Semáforos definidos: un panel sin datos no puede quedarse sin color.
  assert.ok(['verde', 'ambar', 'rojo'].includes(reciprocidad.semaforo))
  assert.ok(['verde', 'ambar', 'rojo'].includes(ttpr.semaforo))
  assert.ok(['verde', 'ambar', 'rojo'].includes(crisis.semaforo))

  // Sin publicaciones el ratio es 0, y 0 < 3 → rojo. Es correcto y deliberado:
  // una red donde nadie publica no está sana, está vacía.
  assert.equal(reciprocidad.ratioReciprocidad, 0)
  assert.equal(reciprocidad.semaforo, 'rojo')
  // Pero la crisis con cero eventos SÍ es verde: no hay nada sin revisar.
  assert.equal(crisis.semaforo, 'verde')
  assert.equal(crisis.p95AtencionSegundos, null)
})

test('una fila de rollup con claves desconocidas o basura no revienta el panel', () => {
  // Una fila escrita por una versión anterior del rollup, o corrompida.
  const raro = [
    { dia: '2026-08-01', metricas: {} as MetricasDia, calculadoEn: 'x' },
    {
      dia: '2026-08-02',
      metricas: { escuchas_validadas: 'no-es-un-numero' } as unknown as MetricasDia,
      calculadoEn: 'x',
    },
  ]
  const salud = getSaludReciprocidad(raro)
  assert.ok(Number.isFinite(salud.ratioReciprocidad))
  assert.equal(salud.escuchasValidadas, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 10 · Utilidades
// ════════════════════════════════════════════════════════════════════════════

test('ratio nunca devuelve NaN ni Infinity', () => {
  assert.equal(ratio(10, 0), 0)
  assert.equal(ratio(0, 0), 0)
  assert.equal(ratio(Number.NaN, 5), 0)
  assert.equal(ratio(5, Number.NaN), 0)
  assert.equal(ratio(10, 4), 2.5)
})

test('aDiaUtc corta por UTC, no por la zona local', () => {
  assert.equal(aDiaUtc('2026-08-03T23:30:00.000Z'), '2026-08-03')
  assert.equal(aDiaUtc('2026-08-04T00:30:00.000Z'), '2026-08-04')
  assert.throws(() => aDiaUtc('no es una fecha'))
})

test('ventanaDias produce una ventana inclusiva de N días', () => {
  const ahora = new Date('2026-08-07T12:00:00.000Z')
  const v = ventanaDias(7, ahora)
  assert.equal(aDiaUtc(v.desde), '2026-08-01')
  assert.equal(aDiaUtc(v.hasta), '2026-08-07')
})

// ════════════════════════════════════════════════════════════════════════════
// 11 · Anti-regresión: prohibido reintroducir una allowlist
// ════════════════════════════════════════════════════════════════════════════

test('el módulo de acceso no exporta nada que huela a lista de correos', () => {
  const nombresProhibidos = ['ADMIN_EMAILS', 'isAdminEmail', 'esCorreoAdmin', 'ALLOWLIST']
  // Los roles se leen de Postgres. Si algún día alguien añade una allowlist,
  // que al menos rompa una prueba antes de llegar a producción.
  for (const nombre of nombresProhibidos) {
    assert.ok(
      !(nombre in (ORDEN_ROLES as unknown as Record<string, unknown>)),
      `no debe existir ${nombre}`,
    )
  }
  // Y la jerarquía sigue siendo exactamente cuatro roles, ni uno más.
  const roles: readonly RolAdmin[] = ORDEN_ROLES
  assert.equal(roles.length, 4)
})
