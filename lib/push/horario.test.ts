import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TECHO_DIARIO,
  VENTANA_AGRUPACION_MS,
  decidirEnvio,
  type ArgumentosDecision,
} from './horario.ts'
import { PREFS_POR_DEFECTO } from './preferencias.ts'

/** Base de argumentos: persona en UTC, sin nada acumulado, con los defaults. */
function base(parciales: Partial<ArgumentosDecision> = {}): ArgumentosDecision {
  return {
    tipo: 'te_escucharon',
    prefs: { ...PREFS_POR_DEFECTO },
    quietFrom: null,
    quietTo: null,
    tzOffset: 0,
    enviadosHoy: 0,
    ultimoDelTipoMs: null,
    // 14:00 UTC de un día cualquiera: fuera de las horas de silencio.
    ahora: new Date('2026-08-03T14:00:00.000Z'),
    ...parciales,
  }
}

// ── CAMINO FELIZ ────────────────────────────────────────────────────────────

test('2 · fuera de horas de silencio y bajo el techo → se envía', () => {
  const d = decidirEnvio(base())
  assert.deepEqual(d, { enviar: true, motivo: null, diferidoHasta: null })
})

// ── CAMINO DE FALLO ─────────────────────────────────────────────────────────

test('8 · techo diario: la quinta notificación no-crisis del día no sale', () => {
  assert.equal(TECHO_DIARIO, 4)

  const cuarta = decidirEnvio(base({ enviadosHoy: TECHO_DIARIO - 1 }))
  assert.equal(cuarta.enviar, true, 'la cuarta todavía cabe')

  const quinta = decidirEnvio(base({ enviadosHoy: TECHO_DIARIO }))
  assert.equal(quinta.enviar, false)
  assert.equal(quinta.motivo, 'techo')
  assert.equal(quinta.diferidoHasta, null)
})

test('9 · horas de silencio: 02:30 con 23:00–08:00 difiere hasta las 08:00 locales', () => {
  // UTC+2, así que 00:30 UTC son las 02:30 locales.
  const d = decidirEnvio(
    base({
      ahora: new Date('2026-08-03T00:30:00.000Z'),
      tzOffset: 120,
      quietFrom: 23 * 60,
      quietTo: 8 * 60,
    }),
  )

  assert.equal(d.enviar, false)
  assert.equal(d.motivo, 'silencio')
  assert.ok(d.diferidoHasta, 'lo acumulado se entrega, no se descarta')

  // 08:00 locales en UTC+2 = 06:00 UTC del mismo día.
  assert.equal(d.diferidoHasta, '2026-08-03T06:00:00.000Z')
})

test('9b · la ventana de silencio cruza la medianoche en los dos lados', () => {
  const a23h30 = decidirEnvio(
    base({ ahora: new Date('2026-08-03T23:30:00.000Z'), quietFrom: 23 * 60, quietTo: 8 * 60 }),
  )
  assert.equal(a23h30.motivo, 'silencio', '23:30 está DENTRO del silencio')
  // El diferido cae en el día siguiente.
  assert.equal(a23h30.diferidoHasta, '2026-08-04T08:00:00.000Z')

  const a08h00 = decidirEnvio(
    base({ ahora: new Date('2026-08-03T08:00:00.000Z'), quietFrom: 23 * 60, quietTo: 8 * 60 }),
  )
  assert.equal(a08h00.enviar, true, 'el final de la ventana es exclusivo')
})

test('9c · sin horario configurado se aplica el silencio por defecto (23:00–08:00)', () => {
  const madrugada = decidirEnvio(base({ ahora: new Date('2026-08-03T03:00:00.000Z') }))
  assert.equal(madrugada.motivo, 'silencio')
  assert.equal(madrugada.diferidoHasta, '2026-08-03T08:00:00.000Z')
})

test('agrupación: dos eventos del mismo tipo en 30 minutos → uno solo', () => {
  const ahora = new Date('2026-08-03T14:00:00.000Z')

  const dentro = decidirEnvio(
    base({ ahora, ultimoDelTipoMs: ahora.getTime() - (VENTANA_AGRUPACION_MS - 1000) }),
  )
  assert.equal(dentro.enviar, false)
  assert.equal(dentro.motivo, 'agrupado')

  const fuera = decidirEnvio(
    base({ ahora, ultimoDelTipoMs: ahora.getTime() - (VENTANA_AGRUPACION_MS + 1000) }),
  )
  assert.equal(fuera.enviar, true, 'pasada la ventana, vuelve a salir')
})

test('un tipo desactivado no sale, y el motivo lo dice', () => {
  const d = decidirEnvio(base({ prefs: { ...PREFS_POR_DEFECTO, te_escucharon: false } }))
  assert.equal(d.enviar, false)
  assert.equal(d.motivo, 'desactivado')
})

test('respuesta_hilo y nivel_alcanzado están OFF de fábrica', () => {
  for (const tipo of ['respuesta_hilo', 'nivel_alcanzado'] as const) {
    const d = decidirEnvio(base({ tipo }))
    assert.equal(d.enviar, false, `${tipo} no debería salir sin activarlo`)
    assert.equal(d.motivo, 'desactivado')
  }
})

// ── LA EXCEPCIÓN ABSOLUTA ───────────────────────────────────────────────────

test('10 · la crisis ignora TODO: 03:00, techo agotado y dentro de la ventana de agrupación', () => {
  const ahora = new Date('2026-08-03T03:00:00.000Z')

  const d = decidirEnvio(
    base({
      tipo: 'alma_afin_en_crisis',
      ahora,
      quietFrom: 23 * 60,
      quietTo: 8 * 60,
      enviadosHoy: TECHO_DIARIO + 10,
      ultimoDelTipoMs: ahora.getTime() - 1000,
    }),
  )

  assert.deepEqual(d, { enviar: true, motivo: null, diferidoHasta: null })
})

test('10b · la crisis sigue saliendo con el resto de tipos apagados', () => {
  const d = decidirEnvio(
    base({
      tipo: 'alma_afin_en_crisis',
      ahora: new Date('2026-08-03T03:00:00.000Z'),
      prefs: {
        te_escucharon: false,
        te_ayudo: false,
        mensaje_refugio: false,
        respuesta_hilo: false,
        nivel_alcanzado: false,
        alma_afin_en_crisis: true,
      },
      enviadosHoy: 99,
    }),
  )
  assert.equal(d.enviar, true)
})

test('10c · la ÚNICA cosa que para la crisis es que esa persona la apague a mano', () => {
  // Desviación consciente del literal de la ficha («devuelve SIEMPRE true»),
  // razonada en la cabecera de horario.ts y anotada en PEDIDOS.md: mandar
  // notificaciones de madrugada a quien dijo explícitamente que no las quiere
  // convierte este bloque en el problema. Quien no ha tocado nada las recibe.
  const d = decidirEnvio(
    base({
      tipo: 'alma_afin_en_crisis',
      prefs: { ...PREFS_POR_DEFECTO, alma_afin_en_crisis: false },
    }),
  )
  assert.equal(d.enviar, false)
  assert.equal(d.motivo, 'desactivado')
})

// ── LA POLÍTICA COMO NÚMEROS ────────────────────────────────────────────────

test('las constantes de la política antiadicción son las acordadas', () => {
  assert.equal(TECHO_DIARIO, 4, 'techo duro de 4 avisos/día no-crisis')
  assert.equal(VENTANA_AGRUPACION_MS, 30 * 60 * 1000, 'agrupación a 30 minutos')
})
