// ============================================================================
// Pruebas del validador compuesto (B11 sobre la costura de B04)
//
//   node --test --experimental-strip-types "app/api/comments/validador.test.ts"
//
// NINGUNA prueba toca la red ni exige MODERATION_API_KEY: el cliente del
// clasificador se inyecta siempre. Lo que se fija aquí es el contrato de la
// composición:
//   · sin clave → EXACTAMENTE la heurística de hoy, con cero llamadas;
//   · con veredicto real del modelo → el modelo manda, también para invalidar;
//   · error, timeout o degradación del modelo → cae a la heurística sin
//     romper la publicación.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLAZO_VALIDADOR_MS,
  ValidadorHeuristico,
  ValidadorIA,
  validadorPorDefecto,
} from './validador.ts'
import type { ClienteIA, RespuestaIA } from '../../../lib/ai/cliente.ts'
import { TIMEOUT_MS } from '../../../lib/ai/modelo.ts'

// ── Dobles ──────────────────────────────────────────────────────────────────

interface Espia {
  cliente: ClienteIA
  invocaciones: number
}

/** Cliente falso: devuelve `respuesta`, o lanza si se le pasa una función. */
function clienteFalso(respuesta: RespuestaIA | (() => never)): Espia {
  const espia: Espia = {
    invocaciones: 0,
    cliente: {
      messages: {
        async create() {
          espia.invocaciones++
          if (typeof respuesta === 'function') respuesta()
          return respuesta as RespuestaIA
        },
      },
    },
  }
  return espia
}

/** Cliente que NUNCA resuelve: simula un proveedor colgado. */
function clienteColgado(): Espia {
  const espia: Espia = {
    invocaciones: 0,
    cliente: {
      messages: {
        create() {
          espia.invocaciones++
          // Promesa eterna. No mantiene vivo el proceso: no hay timer detrás.
          return new Promise<RespuestaIA>(() => {})
        },
      },
    },
  }
  return espia
}

function respuesta(objeto: unknown): RespuestaIA {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(objeto) }],
    usage: { input_tokens: 250, output_tokens: 120, cache_read_input_tokens: 1200 },
  }
}

/** Ejecuta `fn` garantizando que NO hay MODERATION_API_KEY en el entorno. */
async function sinClave(fn: () => Promise<void>): Promise<void> {
  const previa = process.env.MODERATION_API_KEY
  delete process.env.MODERATION_API_KEY
  try {
    await fn()
  } finally {
    if (previa !== undefined) process.env.MODERATION_API_KEY = previa
  }
}

const AUTOR = '11111111-2222-3333-4444-555555555555'

/** Pasa la criba heurística: largo, diverso y sin frases hechas dominantes. */
const COMENTARIO_BUENO =
  'A mí me pasó algo parecido cuando cambié de trabajo el año pasado y lo que ' +
  'me sirvió fue apuntar cada noche una cosa concreta que hubiera salido bien, ' +
  'por pequeña que fuera. ¿Has podido hablarlo con alguien de tu entorno?'

/** Supera el mínimo de longitud pero es relleno puro: la heurística lo tumba. */
const COMENTARIO_RELLENO =
  'ánimo ánimo ánimo mucho ánimo fuerza fuerza fuerza un abrazo un abrazo suerte suerte'

// ── 1. Sin clave: exactamente el comportamiento de hoy ──────────────────────

test('sin clave, el veredicto es EXACTAMENTE el de la heurística de hoy', async () => {
  await sinClave(async () => {
    const heuristico = new ValidadorHeuristico()
    for (const texto of [COMENTARIO_BUENO, COMENTARIO_RELLENO]) {
      const esperado = await heuristico.validar(texto)
      // Con y sin autorId: sin clave el pipeline no corre en ningún caso.
      assert.deepEqual(await validadorPorDefecto.validar(texto), esperado)
      assert.deepEqual(
        await new ValidadorIA().validar(texto, { autorId: AUTOR }),
        esperado,
      )
    }
  })
})

test('sin clave, el contexto heurístico (postBody) sigue funcionando igual', async () => {
  await sinClave(async () => {
    // Ecoar el post no es escuchar: la señal necesita el contexto para verse.
    const eco = await validadorPorDefecto.validar(COMENTARIO_BUENO, {
      postBody: COMENTARIO_BUENO,
    })
    assert.equal(eco.valido, false)
    assert.ok(eco.motivo, 'el motivo humano viene de moderationMessage')
  })
})

// ── 2. La heurística es el suelo y filtra antes de gastar ───────────────────

test('rechazo heurístico: ni una llamada de pago aunque haya cliente', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_RELLENO, { autorId: AUTOR })

  assert.equal(espia.invocaciones, 0, 'el relleno evidente no gasta presupuesto')
  assert.equal(veredicto.valido, false)
  assert.ok(veredicto.motivo)
})

test('sin autorId de sesión el modelo no corre: manda la heurística (pedido a B04)', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'relleno', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { postBody: 'otro texto' })

  assert.equal(espia.invocaciones, 0)
  assert.equal(veredicto.valido, true, 'sin pipeline, el suelo heurístico decide')
})

// ── 3. Con veredicto real, el modelo manda ──────────────────────────────────

test('el modelo valida: valido true, su puntuación como score y motivo null', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.91, riesgo: 'none', motivo: 'Aporta experiencia propia.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })

  assert.equal(espia.invocaciones, 1)
  assert.deepEqual(veredicto, { valido: true, score: 0.91, motivo: null })
})

test('el modelo dice relleno sobre algo que la heurística aprobó: manda el modelo', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'relleno', puntuacion: 0.72, riesgo: 'none', motivo: 'Texto intercambiable.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })

  assert.equal(espia.invocaciones, 1)
  assert.equal(veredicto.valido, false)
  assert.equal(veredicto.score, 0.72)
  assert.ok(veredicto.motivo, 'la persona recibe un motivo accionable')
  // El motivo es la frase fija de cara a la persona, no el veredicto crudo ni
  // el texto generado por el modelo.
  assert.ok(!veredicto.motivo!.includes('relleno'))
  assert.ok(!veredicto.motivo!.includes('intercambiable'))
})

test('el modelo dice toxico: no valida y el motivo habla del daño sin decir «toxico»', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'toxico', puntuacion: 0.97, riesgo: 'none', motivo: 'Desprecia a quien escribe.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })

  assert.equal(veredicto.valido, false)
  assert.ok(veredicto.motivo)
  assert.ok(!veredicto.motivo!.toLowerCase().includes('toxico'))
  assert.ok(!veredicto.motivo!.includes('Desprecia'))
})

// ── 4. Fallos del modelo: cae a la heurística sin romper nada ───────────────

test('error del proveedor: el veredicto es el heurístico y nadie se queda sin publicar', async () => {
  const espia = clienteFalso(() => {
    throw new Error('proveedor caído')
  })
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })

  assert.equal(espia.invocaciones, 1, 'sí se intentó clasificar')
  assert.deepEqual(veredicto, await new ValidadorHeuristico().validar(COMENTARIO_BUENO))
})

test('respuesta degradada (refusal): manda la heurística, no el indeterminado', async () => {
  const espia = clienteFalso({ stop_reason: 'refusal', content: [] })
  const validador = new ValidadorIA({ cliente: espia.cliente })
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })

  assert.equal(veredicto.valido, true, 'un indeterminado jamás invalida por sí mismo')
  assert.equal(veredicto.motivo, null)
})

test('timeout: cae a la heurística en el plazo, sin dejar el composer colgado', async () => {
  const espia = clienteColgado()
  const validador = new ValidadorIA({ cliente: espia.cliente, plazoMs: 25 })

  const inicio = Date.now()
  const veredicto = await validador.validar(COMENTARIO_BUENO, { autorId: AUTOR })
  const transcurrido = Date.now() - inicio

  assert.equal(espia.invocaciones, 1)
  assert.equal(veredicto.valido, true)
  assert.ok(transcurrido < 1000, `debió cortar en ~25 ms y tardó ${transcurrido} ms`)
})

// ── 5. El plazo por defecto está acotado por el producto ────────────────────

test('el plazo total cubre los reintentos del cliente y queda en pocos segundos', () => {
  assert.ok(PLAZO_VALIDADOR_MS > TIMEOUT_MS, 'debe dejar terminar al menos un intento')
  assert.ok(PLAZO_VALIDADOR_MS <= 8000, 'un composer colgado ocho segundos es peor que degradar')
})
