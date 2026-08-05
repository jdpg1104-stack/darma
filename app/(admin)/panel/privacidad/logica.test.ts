// ============================================================================
// /panel/privacidad · Pruebas de la lógica pura
//
// Corren con `node --test --experimental-strip-types` sin red, sin base y sin
// variables de entorno: `logica.ts` no importa Next ni construye ningún
// cliente a nivel de módulo (el cliente admin entra por parámetro).
//
// Lo que NO se prueba aquí y se verifica contra Postgres: que `service_role`
// sea de verdad el único que lee `privacy_requests` (RLS sin políticas), y qué
// índice usa cada consulta. Un doble de cliente no demuestra un permiso.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DIAS_ARREPENTIMIENTO,
  DIAS_AVISO_VENCIMIENTO,
  DIAS_MARGEN_EJECUCION,
  codificarCursor,
  cumplioPlazo,
  edadSegundos,
  parsearCursor,
  plazoArt123,
  prepararAbiertas,
  resumirAbiertas,
  sumarDias,
  urgenciaDe,
  venceEn,
  type FilaSolicitud,
} from './logica.ts'

// ── Utilidades ──────────────────────────────────────────────────────────────

let contadorId = 0
function solicitud(sobre: Partial<FilaSolicitud> = {}): FilaSolicitud {
  contadorId += 1
  return {
    id: `00000000-0000-4000-8000-${String(contadorId).padStart(12, '0')}`,
    kind: 'erase',
    state: 'confirmed',
    requested_at: '2026-07-01T00:00:00.000Z',
    confirmed_at: '2026-07-02T00:00:00.000Z',
    completed_at: null,
    expires_at: '2026-07-08T00:00:00.000Z',
    ...sobre,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · El plazo del art. 12.3 es un MES CIVIL, no 30 días
// ════════════════════════════════════════════════════════════════════════════

test('plazoArt123: mismo día del mes siguiente, conservando la hora', () => {
  assert.equal(plazoArt123('2026-01-15T10:30:00.000Z'), '2026-02-15T10:30:00.000Z')
  assert.equal(plazoArt123('2026-08-05T12:00:00.000Z'), '2026-09-05T12:00:00.000Z')
})

test('plazoArt123: si el día no existe, recorta al último día del mes (1182/71)', () => {
  // Recortar hacia ANTES es la dirección conservadora para una fecha límite.
  assert.equal(plazoArt123('2026-01-31T00:00:00.000Z'), '2026-02-28T00:00:00.000Z')
  assert.equal(plazoArt123('2026-03-31T08:00:00.000Z'), '2026-04-30T08:00:00.000Z')
})

test('plazoArt123: año bisiesto y salto de año', () => {
  assert.equal(plazoArt123('2024-01-31T12:00:00.000Z'), '2024-02-29T12:00:00.000Z')
  assert.equal(plazoArt123('2025-12-31T23:59:59.000Z'), '2026-01-31T23:59:59.000Z')
})

test('plazoArt123: de febrero al 1 de marzo son MENOS de 30 días y es correcto', () => {
  // La prueba de que «un mes» no puede aproximarse con sumarDias(30).
  assert.equal(plazoArt123('2026-02-01T00:00:00.000Z'), '2026-03-01T00:00:00.000Z')
  assert.notEqual(plazoArt123('2026-02-01T00:00:00.000Z'), sumarDias('2026-02-01T00:00:00.000Z', 30))
})

test('plazoArt123 y sumarDias lanzan ante una fecha inválida', () => {
  assert.throws(() => plazoArt123('no-es-fecha'))
  assert.throws(() => sumarDias('tampoco', 30))
})

// ════════════════════════════════════════════════════════════════════════════
// 2 · venceEn: cada estado tiene su reloj
// ════════════════════════════════════════════════════════════════════════════

test('venceEn: pending_confirm vive atado al TTL del token', () => {
  const f = solicitud({ state: 'pending_confirm', confirmed_at: null })
  assert.equal(venceEn(f), f.expires_at)
})

test('venceEn: una exportación abierta vive atada al enlace de descarga', () => {
  const f = solicitud({ kind: 'export', state: 'confirmed' })
  assert.equal(venceEn(f), f.expires_at)
})

test('venceEn: un borrado confirmado vence al acabar el arrepentimiento', () => {
  // Espejo de `borrados_vencidos()`: confirmed_at + 30 días.
  const f = solicitud() // erase confirmed, confirmada el 2 de julio
  assert.equal(venceEn(f), '2026-08-01T00:00:00.000Z')
  assert.equal(venceEn(f), sumarDias('2026-07-02T00:00:00.000Z', DIAS_ARREPENTIMIENTO))
})

test('venceEn: processing usa el mismo reloj que confirmed', () => {
  assert.equal(venceEn(solicitud({ state: 'processing' })), '2026-08-01T00:00:00.000Z')
})

test('venceEn: un borrado confirmado SIN confirmed_at cae a la solicitud', () => {
  const f = solicitud({ confirmed_at: null })
  assert.equal(venceEn(f), '2026-07-31T00:00:00.000Z')
})

test('venceEn: los estados terminales no tienen reloj', () => {
  assert.equal(venceEn(solicitud({ state: 'done' })), null)
  assert.equal(venceEn(solicitud({ state: 'failed' })), null)
  assert.equal(venceEn(solicitud({ state: 'cancelled' })), null)
})

// ════════════════════════════════════════════════════════════════════════════
// 3 · urgenciaDe: vencida ≠ caducada
// ════════════════════════════════════════════════════════════════════════════

// El borrado de referencia vence el 2026-08-01T00:00:00Z.
const BORRADO = solicitud()

test('urgencia de un borrado: en plazo → vence pronto → vencida, con bordes', () => {
  assert.equal(urgenciaDe(BORRADO, new Date('2026-07-20T00:00:00.000Z')), 'en_plazo')
  // El aviso empieza EXCLUSIVO en vence - 7 días.
  assert.equal(urgenciaDe(BORRADO, new Date('2026-07-25T00:00:00.000Z')), 'en_plazo')
  assert.equal(urgenciaDe(BORRADO, new Date('2026-07-25T00:00:00.001Z')), 'vence_pronto')
  // Pasado el vencimiento pero dentro del margen del cron sigue siendo «pronto»:
  // es la ventana en la que el cron DEBE estar ejecutándolo.
  assert.equal(urgenciaDe(BORRADO, new Date('2026-08-05T00:00:00.000Z')), 'vence_pronto')
  assert.equal(urgenciaDe(BORRADO, new Date('2026-08-08T00:00:00.000Z')), 'vence_pronto')
  // Más allá del margen es un incumplimiento, no un retraso.
  assert.equal(urgenciaDe(BORRADO, new Date('2026-08-08T00:00:00.001Z')), 'vencida')
})

test('las constantes del reloj son las que documenta la cabecera', () => {
  assert.equal(DIAS_ARREPENTIMIENTO, 30)
  assert.equal(DIAS_MARGEN_EJECUCION, 7)
  assert.equal(DIAS_AVISO_VENCIMIENTO, 7)
})

test('un pending_confirm expirado está CADUCADO, nunca vencido', () => {
  const f = solicitud({ state: 'pending_confirm' })
  assert.equal(urgenciaDe(f, new Date('2026-07-07T00:00:00.000Z')), 'en_plazo')
  assert.equal(urgenciaDe(f, new Date('2026-07-09T00:00:00.000Z')), 'caducada')
})

test('una exportación con el enlace expirado está CADUCADA, nunca vencida', () => {
  // El servicio respondió dentro del TTL; fue la persona quien no descargó.
  const f = solicitud({ kind: 'export', state: 'confirmed' })
  assert.equal(urgenciaDe(f, new Date('2026-07-05T00:00:00.000Z')), 'en_plazo')
  assert.equal(urgenciaDe(f, new Date('2026-07-09T00:00:00.000Z')), 'caducada')
})

test('los estados terminales no tienen urgencia', () => {
  const ahora = new Date('2026-08-05T00:00:00.000Z')
  assert.equal(urgenciaDe(solicitud({ state: 'done' }), ahora), null)
  assert.equal(urgenciaDe(solicitud({ state: 'failed' }), ahora), null)
  assert.equal(urgenciaDe(solicitud({ state: 'cancelled' }), ahora), null)
})

// ════════════════════════════════════════════════════════════════════════════
// 4 · cumplioPlazo: la prueba histórica, fila a fila
// ════════════════════════════════════════════════════════════════════════════

test('exportación ejecutada: dentro y fuera del mes del art. 12.3', () => {
  const dentro = solicitud({ kind: 'export', state: 'done', completed_at: '2026-07-03T00:00:00.000Z' })
  const alBorde = solicitud({ kind: 'export', state: 'done', completed_at: '2026-08-01T00:00:00.000Z' })
  const fuera = solicitud({ kind: 'export', state: 'done', completed_at: '2026-08-01T00:00:00.001Z' })
  assert.equal(cumplioPlazo(dentro), true)
  assert.equal(cumplioPlazo(alBorde), true) // el límite es inclusivo
  assert.equal(cumplioPlazo(fuera), false)
})

test('borrado ejecutado: contra arrepentimiento + margen, no contra el mes', () => {
  // Confirmado el 2 de julio → límite 2026-08-08 (30 + 7 días). Medirlo contra
  // el mes del art. 12.3 marcaría fuera de plazo TODOS los borrados bien hechos.
  const dentro = solicitud({ state: 'done', completed_at: '2026-08-08T00:00:00.000Z' })
  const fuera = solicitud({ state: 'done', completed_at: '2026-08-08T00:00:00.001Z' })
  assert.equal(cumplioPlazo(dentro), true)
  assert.equal(cumplioPlazo(fuera), false)
})

test('cumplioPlazo es null cuando no hay plazo que juzgar', () => {
  assert.equal(cumplioPlazo(solicitud({ state: 'cancelled', completed_at: '2026-07-10T00:00:00.000Z' })), null)
  assert.equal(cumplioPlazo(solicitud({ state: 'failed' })), null)
  assert.equal(cumplioPlazo(solicitud({ state: 'confirmed' })), null)
  // `done` sin completed_at es una fila corrupta: no se inventa un veredicto.
  assert.equal(cumplioPlazo(solicitud({ state: 'done', completed_at: null })), null)
})

// ════════════════════════════════════════════════════════════════════════════
// 5 · Edad
// ════════════════════════════════════════════════════════════════════════════

test('edadSegundos: normal y nunca negativa', () => {
  assert.equal(edadSegundos('2026-07-01T00:00:00.000Z', new Date('2026-07-01T00:01:30.000Z')), 90)
  // Un reloj adelantado no puede pintar una edad imposible.
  assert.equal(edadSegundos('2026-07-01T00:00:00.000Z', new Date('2026-06-30T23:59:00.000Z')), 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 6 · Cursor keyset: ida y vuelta, y la puerta cerrada a la inyección
// ════════════════════════════════════════════════════════════════════════════

const UUID = '9f8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

test('el cursor sobrevive la ida y vuelta, también con offset +00:00', () => {
  // PostgREST devuelve timestamptz con `+00:00`; toISOString con `Z`. Los dos
  // formatos tienen que pasar, porque el cursor se construye del primero.
  for (const t of ['2026-07-01T00:00:00+00:00', '2026-07-01T00:00:00.123456+00:00', '2026-07-01T00:00:00.000Z']) {
    const cursor = parsearCursor(codificarCursor({ requested_at: t, id: UUID }))
    assert.deepEqual(cursor, { t, id: UUID })
  }
})

test('un cursor que no valida EXACTO se ignora (primera página), no revienta', () => {
  assert.equal(parsearCursor(undefined), null)
  assert.equal(parsearCursor(''), null)
  assert.equal(parsearCursor(42), null)
  assert.equal(parsearCursor(['2026-07-01T00:00:00Z', UUID]), null)
  assert.equal(parsearCursor('basura'), null)
  assert.equal(parsearCursor(`${'x'.repeat(90)}_${UUID}`), null)
  assert.equal(parsearCursor(`2026-07-01T00:00:00Z_${UUID}_extra`), null)
})

test('la gramática de PostgREST no puede entrar por el cursor', () => {
  // Lo que pasa la validación se interpola en un `or(...)`: comas, paréntesis
  // o puntos de más reescribirían el filtro de la consulta.
  assert.equal(parsearCursor(`2026-07-01T00:00:00Z_${UUID},or(id.gt.0)`), null)
  assert.equal(parsearCursor(`or(a,b)_${UUID}`), null)
  assert.equal(parsearCursor(`2026-07-01T00:00:00Z_id.gt.0`), null)
})

// ════════════════════════════════════════════════════════════════════════════
// 7 · Preparación y resumen: lo urgente ARRIBA y los totales que cuadran
// ════════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-08-05T00:00:00.000Z')

function abanico(): FilaSolicitud[] {
  return [
    // vence 2026-08-01 → pasada pero dentro del margen → vence_pronto
    solicitud({ confirmed_at: '2026-07-02T00:00:00.000Z' }),
    // vence 2026-07-20, margen hasta 2026-07-27 → vencida (la MÁS vieja)
    solicitud({ confirmed_at: '2026-06-20T00:00:00.000Z' }),
    // vence 2026-08-19 → en plazo
    solicitud({ confirmed_at: '2026-07-20T00:00:00.000Z' }),
    // token expirado el 2026-07-08 → caducada
    solicitud({ state: 'pending_confirm', confirmed_at: null }),
    // vence 2026-07-25, margen hasta 2026-08-01 → vencida
    solicitud({ confirmed_at: '2026-06-25T00:00:00.000Z' }),
    // vence 2026-08-03 → vence_pronto
    solicitud({ confirmed_at: '2026-07-04T00:00:00.000Z' }),
  ]
}

test('prepararAbiertas: vencidas primero, luego vence_pronto, por fecha de vencimiento', () => {
  const { urgentes, enPlazo, caducadas } = prepararAbiertas(abanico(), AHORA)

  assert.deepEqual(
    urgentes.map((v) => `${v.urgencia}:${v.venceEn}`),
    [
      'vencida:2026-07-20T00:00:00.000Z',
      'vencida:2026-07-25T00:00:00.000Z',
      'vence_pronto:2026-08-01T00:00:00.000Z',
      'vence_pronto:2026-08-03T00:00:00.000Z',
    ],
  )
  assert.deepEqual(enPlazo.map((v) => v.venceEn), ['2026-08-19T00:00:00.000Z'])
  assert.equal(caducadas.length, 1)
  assert.equal(caducadas[0].state, 'pending_confirm')
})

test('resumirAbiertas: los totales cuadran y una caducada no cuenta dos veces', () => {
  const resumen = resumirAbiertas(abanico(), AHORA)
  assert.deepEqual(resumen, {
    total: 6,
    pendientesConfirmar: 0, // la única pending_confirm está caducada
    confirmadas: 5,
    enEjecucion: 0,
    vencidas: 2,
    vencenPronto: 2,
    caducadas: 1,
  })
})

test('resumirAbiertas con la tabla vacía: ceros, no NaN ni undefined', () => {
  assert.deepEqual(resumirAbiertas([], AHORA), {
    total: 0,
    pendientesConfirmar: 0,
    confirmadas: 0,
    enEjecucion: 0,
    vencidas: 0,
    vencenPronto: 0,
    caducadas: 0,
  })
})
