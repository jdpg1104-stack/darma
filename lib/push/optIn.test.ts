import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  APLAZAMIENTO_MS,
  ESTADO_INICIAL,
  MAX_APLAZAMIENTOS,
  aceptar,
  aplazar,
  debeMostrarOptIn,
  leerEstado,
  type ContextoOptIn,
} from './optIn.ts'

function ctx(parciales: Partial<ContextoOptIn> = {}): ContextoOptIn {
  return {
    configurado: true,
    permiso: 'default',
    momento: 'primer_comentario_validado',
    estado: { ...ESTADO_INICIAL },
    ahora: Date.parse('2026-08-03T12:00:00.000Z'),
    ...parciales,
  }
}

test('se pregunta cuando —y solo cuando— ha ocurrido un momento oportuno', () => {
  assert.equal(debeMostrarOptIn(ctx()), true)
  // Sin momento, jamás. Es lo que impide pedirlo al cargar la app: pedir el
  // permiso en el primer render lo deniega Chrome de forma PERMANENTE.
  assert.equal(debeMostrarOptIn(ctx({ momento: null })), false)
})

test('sin llaves VAPID no se pregunta: quemaríamos el origen a cambio de nada', () => {
  assert.equal(debeMostrarOptIn(ctx({ configurado: false })), false)
})

test('si el permiso ya está resuelto, no se vuelve a preguntar', () => {
  assert.equal(debeMostrarOptIn(ctx({ permiso: 'granted' })), false)
  assert.equal(debeMostrarOptIn(ctx({ permiso: 'denied' })), false)
  // Navegador sin soporte de notificaciones.
  assert.equal(debeMostrarOptIn(ctx({ permiso: null })), false)
})

test('«ahora no» aplaza siete días y luego vuelve a poder preguntarse', () => {
  const ahora = Date.parse('2026-08-03T12:00:00.000Z')
  const aplazado = aplazar({ ...ESTADO_INICIAL }, ahora)

  assert.equal(aplazado.aplazamientos, 1)
  assert.equal(aplazado.aplazadoHasta, ahora + APLAZAMIENTO_MS)
  assert.equal(aplazado.mostrado, true)

  assert.equal(debeMostrarOptIn(ctx({ estado: aplazado, ahora: ahora + 1000 })), false)
  assert.equal(
    debeMostrarOptIn(ctx({ estado: aplazado, ahora: ahora + APLAZAMIENTO_MS + 1 })),
    true,
  )
})

test('tras tres «ahora no» se deja de preguntar para siempre', () => {
  let estado = { ...ESTADO_INICIAL }
  let ahora = Date.parse('2026-08-03T12:00:00.000Z')

  for (let i = 0; i < MAX_APLAZAMIENTOS; i++) {
    estado = aplazar(estado, ahora)
    ahora += APLAZAMIENTO_MS + 1
  }

  assert.equal(debeMostrarOptIn(ctx({ estado, ahora })), false, 'insistir es acoso de producto')
})

test('una vez aceptado, no se vuelve a mostrar', () => {
  const estado = aceptar({ ...ESTADO_INICIAL })
  assert.equal(estado.aceptado, true)
  assert.equal(debeMostrarOptIn(ctx({ estado })), false)
})

test('leerEstado tolera cualquier cosa en localStorage', () => {
  assert.deepEqual(leerEstado(null), { ...ESTADO_INICIAL })
  assert.deepEqual(leerEstado('no es json'), { ...ESTADO_INICIAL })
  assert.deepEqual(leerEstado('[]'), { ...ESTADO_INICIAL })
  assert.deepEqual(leerEstado('"texto"'), { ...ESTADO_INICIAL })

  const parcial = leerEstado('{"aceptado":"sí","aplazamientos":-4,"aplazadoHasta":"mañana"}')
  assert.equal(parcial.aceptado, false, '«sí» no es true')
  assert.equal(parcial.aplazamientos, 0)
  assert.equal(parcial.aplazadoHasta, null)
})

test('el estado guardado no lleva ningún dato de la persona', () => {
  const estado = aplazar(aceptar({ ...ESTADO_INICIAL }), 0)
  assert.deepEqual(
    Object.keys(estado).sort(),
    ['aceptado', 'aplazadoHasta', 'aplazamientos', 'mostrado'],
  )
})
