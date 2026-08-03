import test from 'node:test'
import assert from 'node:assert/strict'

import type { CandidatoContenido } from './tipos.ts'
import {
  CONFIANZA_MINIMA,
  cribarLexico,
  cribarSeguridad,
  interpretarRespuestaModelo,
  normalizarTexto,
  type ProveedorModeracion,
} from './seguridad.ts'

function candidato(title: string, summary: string | null = null, tags: string[] = []): CandidatoContenido {
  return {
    source: 'yt:who',
    platform: 'youtube',
    externalId: 'abc123',
    title,
    summary,
    url: 'https://www.youtube.com/watch?v=abc123',
    thumbnailUrl: null,
    language: 'es',
    durationSeconds: null,
    topic: null,
    tags,
    publishedAt: '2026-08-01T00:00:00.000Z',
  }
}

/** Proveedor que siempre dice «seguro» con confianza alta. */
const proveedorPermisivo: ProveedorModeracion = async () => ({ seguro: true, confianza: 0.95 })

// ── Prueba exigida nº 2 · el catálogo de casos fijos ────────────────────────

test('«5 técnicas de respiración para la ansiedad» → seguro', async () => {
  const v = await cribarSeguridad(candidato('5 técnicas de respiración para la ansiedad'), {
    apiKey: 'clave-de-prueba',
    proveedor: proveedorPermisivo,
  })
  assert.equal(v.decision, 'seguro')
})

test('«Cura tu depresión en 7 días sin medicación» → peligroso (promesa terapéutica)', async () => {
  const c = candidato('Cura tu depresión en 7 días sin medicación')
  // La capa 1 lo caza sola: no se gasta ni una llamada al modelo.
  assert.equal(cribarLexico(c).peligroso, true)

  let llamadas = 0
  const v = await cribarSeguridad(c, {
    apiKey: 'clave-de-prueba',
    proveedor: async () => {
      llamadas++
      return { seguro: true, confianza: 1 }
    },
  })
  assert.equal(v.decision, 'peligroso')
  assert.equal(llamadas, 0, 'un acierto de la capa 1 no debe pagar el modelo')
})

test('«Mi camino de vuelta: hablé de mis pensamientos suicidas y pedí ayuda» → seguro', async () => {
  // EL CASO QUE MÁS IMPORTA. Menciona el suicidio sin romantizarlo: es
  // exactamente el contenido de recuperación que Darma quiere. Si este test se
  // pone rojo, el filtro ha empezado a filtrar vocabulario en vez de daño.
  const c = candidato(
    'Mi camino de vuelta: hablé de mis pensamientos suicidas y pedí ayuda',
    'Testimonio de recuperación. Cómo fue pedir ayuda por primera vez y qué pasó después.',
  )
  assert.equal(cribarLexico(c).peligroso, false)

  const v = await cribarSeguridad(c, { apiKey: 'clave-de-prueba', proveedor: proveedorPermisivo })
  assert.equal(v.decision, 'seguro')
})

test('«El descanso definitivo, por fin en paz» → peligroso (romantización)', async () => {
  const v = await cribarSeguridad(candidato('El descanso definitivo, por fin en paz'), {
    apiKey: 'clave-de-prueba',
    proveedor: proveedorPermisivo,
  })
  assert.equal(v.decision, 'peligroso')
  assert.match(v.motivo ?? '', /romantizacion/)
})

test('CAMINO DE FALLO: un título ambiguo sin señales queda «incierto», no aprobado', async () => {
  // El criterio no sabe decidir → cola humana. Es la salida que impide que lo
  // dudoso caiga por defecto en «publicar» o en «borrar».
  const c = candidato('Episodio 12')
  assert.equal(cribarLexico(c).peligroso, false)

  const v = await cribarSeguridad(c, {
    apiKey: 'clave-de-prueba',
    // El modelo tampoco lo tiene claro.
    proveedor: async () => ({ seguro: true, confianza: 0.4 }),
  })
  assert.equal(v.decision, 'incierto')
  assert.notEqual(v.decision, 'seguro')
})

// ── Prueba exigida nº 3 · fail-closed ───────────────────────────────────────

test('FAIL-CLOSED: sin MODERATION_API_KEY todo lo que pasó la capa 1 es «incierto», nunca «seguro»', async () => {
  const casos = [
    candidato('5 técnicas de respiración para la ansiedad'),
    candidato('Cómo dormir mejor esta noche'),
    candidato('Episodio 12'),
  ]
  for (const c of casos) {
    const v = await cribarSeguridad(c, { apiKey: null })
    assert.equal(v.decision, 'incierto', `«${c.title}» debería quedar incierto sin clave`)
    assert.equal(v.motivo, 'sin_clave_moderacion')
  }
})

test('FAIL-CLOSED: lo que la capa 1 marca sigue siendo «peligroso» aunque no haya clave', async () => {
  const v = await cribarSeguridad(candidato('El descanso definitivo, por fin en paz'), { apiKey: null })
  assert.equal(v.decision, 'peligroso')
})

test('FAIL-CLOSED: un proveedor que LANZA no aprueba nada', async () => {
  const v = await cribarSeguridad(candidato('Ejercicio de anclaje de 3 minutos'), {
    apiKey: 'clave-de-prueba',
    proveedor: async () => {
      throw new Error('boom')
    },
  })
  assert.equal(v.decision, 'incierto')
  // Lo que de verdad se comprueba: la función NO ha lanzado.
})

test('FAIL-CLOSED: sin cupo del modelo, «incierto»', async () => {
  const v = await cribarSeguridad(candidato('Ejercicio de anclaje de 3 minutos'), {
    apiKey: 'clave-de-prueba',
    consumirCupo: async () => false,
    proveedor: proveedorPermisivo,
  })
  assert.equal(v.decision, 'incierto')
  assert.equal(v.motivo, 'sin_cupo_modelo')
})

test('un «no es seguro» con poca confianza va a la cola humana, no al rechazo definitivo', async () => {
  // Rechazar cierra la puerta para siempre (uq_ingest_log_seen). Solo se cierra
  // cuando el modelo está convencido.
  const bajo = await cribarSeguridad(candidato('Título neutro'), {
    apiKey: 'k',
    proveedor: async () => ({ seguro: false, confianza: CONFIANZA_MINIMA - 0.1 }),
  })
  assert.equal(bajo.decision, 'incierto')

  const alto = await cribarSeguridad(candidato('Título neutro'), {
    apiKey: 'k',
    proveedor: async () => ({ seguro: false, confianza: 0.99, motivo: 'modelo_dijo_no' }),
  })
  assert.equal(alto.decision, 'peligroso')
})

// ── La capa 1, caso a caso ──────────────────────────────────────────────────

test('la capa 1 no filtra por VOCABULARIO: psicoeducación y testimonios pasan', () => {
  const permitidos = [
    'Qué es la ideación suicida y cómo se acompaña',
    'Hablar del suicidio salva vidas: guía para familias',
    'Señales de alarma de autolesión en adolescentes',
    'Depresión: qué puedes hacer hoy mientras esperas cita',
    'Convivir con la ansiedad sin medicación mientras llega la terapia',
  ]
  for (const titulo of permitidos) {
    assert.equal(cribarLexico({ title: titulo, summary: null, tags: [] }).peligroso, false, `bloqueó: ${titulo}`)
  }
})

test('la capa 1 sí filtra método, instrucción, retos y pro-ana', () => {
  const bloqueados = [
    'Cómo quitarse la vida sin dolor',
    'Métodos indoloros que nadie te cuenta',
    'How to kill yourself painlessly',
    'El reto de la ballena azul explicado paso a paso para jugarlo',
    'Trucos para no comer en todo el día',
    'Thinspo motivación diaria',
    'Deja los antidepresivos hoy mismo',
    'Este método sustituye a la medicación',
    'Diagnóstico gratis de tu trastorno en 2 minutos',
  ]
  for (const titulo of bloqueados) {
    assert.equal(cribarLexico({ title: titulo, summary: null, tags: [] }).peligroso, true, `dejó pasar: ${titulo}`)
  }
})

test('las tildes no esquivan el filtro', () => {
  assert.equal(cribarLexico({ title: 'Cúra tu depresión ya', summary: null, tags: [] }).peligroso, true)
  assert.equal(normalizarTexto('¡CÚRATE!  Ya…'), 'curate ya')
})

test('el resumen y las etiquetas también se criban, no solo el título', () => {
  const porResumen = cribarLexico({ title: 'Episodio 4', summary: 'Aquí explico el descanso eterno', tags: [] })
  assert.equal(porResumen.peligroso, true)

  const porTag = cribarLexico({ title: 'Episodio 4', summary: null, tags: ['proana', 'dieta'] })
  assert.equal(porTag.peligroso, true)
})

// ── Interpretación de la respuesta del proveedor ────────────────────────────

test('una respuesta del modelo con forma inesperada NO se lee como «seguro»', () => {
  assert.equal(interpretarRespuestaModelo(null), null)
  assert.equal(interpretarRespuestaModelo('ok'), null)
  assert.equal(interpretarRespuestaModelo({}), null)
  // 'no' es una cadena no vacía: Boolean('no') sería true. No se coacciona.
  assert.equal(interpretarRespuestaModelo({ seguro: 'no', confianza: 1 }), null)
  assert.equal(interpretarRespuestaModelo({ seguro: true }), null)
  assert.equal(interpretarRespuestaModelo({ seguro: true, confianza: 'alta' }), null)

  assert.deepEqual(interpretarRespuestaModelo({ seguro: true, confianza: 0.9 }), {
    seguro: true,
    confianza: 0.9,
    motivo: null,
  })
  // La confianza se acota a [0,1]: un proveedor que devuelva 42 no gana nada.
  assert.equal(interpretarRespuestaModelo({ safe: false, confidence: 42 })?.confianza, 1)
})
