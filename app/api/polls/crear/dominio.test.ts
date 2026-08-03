// ============================================================================
// Pruebas de `POST /api/polls/crear` — el CAMINO DE FALLO.
//
// Corren con `node --test --experimental-strip-types`, sin red, sin base de
// datos y sin una sola variable de entorno.
//
// LO QUE ESTAS PRUEBAS NO PUEDEN DEMOSTRAR, y por eso se verificó a mano contra
// `darma-dev` (ver el informe del bloque): que `crear_encuesta()` devuelva
// 42501 a un usuario sin rol, que `authenticated` no pueda ejecutarla, y que la
// encuesta creada aparezca de verdad en `encuesta_siguiente()`. Un doble de
// cliente nunca puede demostrar un permiso de Postgres.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esErrorApi } from '../../../../lib/auth/errores.ts'
import { OPCIONES_MAX } from '../../../../lib/polls/limites.ts'
import {
  MIN_REVELACION_SUELO,
  ROL_MINIMO,
  hayOpcionesDuplicadas,
  normalizarOpcion,
  prepararCreacion,
  proyectar,
  type FilaEncuestaCreada,
} from './dominio.ts'

/** Cuerpo válido mínimo. Cada prueba lo desvía en UNA cosa. */
function cuerpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pregunta: '¿Cómo ha ido tu semana?',
    opciones: ['Bien', 'Regular', 'Cuesta arriba'],
    ...extra,
  }
}

/** Ejecuta y devuelve el error, exigiendo que haya lanzado. */
function fallo(entrada: Parameters<typeof prepararCreacion>[0]): { code: string; message: string } {
  try {
    prepararCreacion(entrada)
  } catch (causa) {
    assert.ok(esErrorApi(causa), 'lo que lanza tiene que ser un ErrorApi del contrato')
    return { code: causa.code, message: causa.message }
  }
  assert.fail('se esperaba un ErrorApi y no se lanzó nada')
}

// ── 1 · El camino que sí funciona ────────────────────────────────────────────

test('camino feliz: encuesta activa, sin tarjeta de ayuda', () => {
  const plan = prepararCreacion({ cuerpo: cuerpo(), rol: 'moderador' })

  assert.equal(plan.estado, 'active')
  assert.equal(plan.idioma, 'es')
  assert.equal(plan.minRevelacion, 5)
  assert.equal(plan.cierraEn, null)
  assert.equal(plan.riesgo.requiereIntervencion, false)
  assert.equal(plan.riesgo.mensaje, null)
  assert.deepEqual(plan.opciones, ['Bien', 'Regular', 'Cuesta arriba'])
})

// ── 2 · SIN ROL ──────────────────────────────────────────────────────────────

test('sin rol suficiente: 403 sin decir qué rol falta', () => {
  const error = fallo({ cuerpo: cuerpo(), rol: 'soporte' })

  assert.equal(error.code, 'sin_permiso')
  // Quien no puede entrar no debe poder deducir el mapa del sistema por el
  // mensaje: ni el rol que falta, ni que exista una tabla de roles.
  for (const filtracion of ['moderador', 'admin_roles', 'rol', 'encuesta']) {
    assert.ok(
      !error.message.toLowerCase().includes(filtracion),
      `el mensaje no puede mencionar «${filtracion}»: ${error.message}`,
    )
  }
})

test('el rol se comprueba ANTES que la forma del cuerpo', () => {
  // Un cuerpo basura con un rol insuficiente devuelve 403, no 422: contestar
  // «te falta un campo» a quien no puede publicar ya le confirma que la ruta
  // existe y le enseña la forma de la petición.
  assert.equal(fallo({ cuerpo: { nada: true }, rol: 'soporte' }).code, 'sin_permiso')
})

test('los roles por encima del mínimo también publican', () => {
  for (const rol of ['moderador', 'operaciones', 'superadmin'] as const) {
    assert.equal(prepararCreacion({ cuerpo: cuerpo(), rol }).estado, 'active')
  }
  assert.equal(ROL_MINIMO, 'moderador')
})

// ── 3 · MENOS DE DOS OPCIONES ────────────────────────────────────────────────

test('una sola opción: 422', () => {
  assert.equal(fallo({ cuerpo: cuerpo({ opciones: ['Sí'] }), rol: 'moderador' }).code, 'entrada_invalida')
})

test('cero opciones y opciones ausentes: 422', () => {
  assert.equal(fallo({ cuerpo: cuerpo({ opciones: [] }), rol: 'moderador' }).code, 'entrada_invalida')
  assert.equal(fallo({ cuerpo: { pregunta: '¿Qué tal?' }, rol: 'moderador' }).code, 'entrada_invalida')
})

test('por encima del máximo de opciones: 422 (no se recorta)', () => {
  const demasiadas = Array.from({ length: OPCIONES_MAX + 1 }, (_, i) => `Opción ${i}`)
  assert.equal(
    fallo({ cuerpo: cuerpo({ opciones: demasiadas }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
})

test('una opción vacía no cuenta como opción', () => {
  assert.equal(
    fallo({ cuerpo: cuerpo({ opciones: ['Sí', '   '] }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
})

// ── 4 · OPCIONES DUPLICADAS ──────────────────────────────────────────────────

test('opciones duplicadas: 422 y el mensaje explica qué arreglar', () => {
  const error = fallo({ cuerpo: cuerpo({ opciones: ['Sí', 'Sí'] }), rol: 'moderador' })
  assert.equal(error.code, 'entrada_invalida')
  assert.match(error.message, /distinta/i)
})

test('duplicadas también con mayúsculas y espacios de sobra', () => {
  // La comparación es la misma que hace `crear_encuesta()` en Postgres. Si
  // divergieran, este aviso adelantado fallaría a veces y nadie lo sospecharía.
  assert.equal(
    fallo({ cuerpo: cuerpo({ opciones: ['Sí', '  sí  '] }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
  assert.equal(
    fallo({ cuerpo: cuerpo({ opciones: ['A veces', 'A   veces'] }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
})

test('la normalización no confunde opciones que sí son distintas', () => {
  assert.equal(normalizarOpcion('  A   VECES '), 'a veces')
  assert.equal(hayOpcionesDuplicadas(['Sí', 'No', 'A veces']), false)
  // Las tildes SÍ distinguen: «si» y «sí» son dos palabras distintas en
  // español, y quitarlas aquí uniría dos opciones que dicen cosas opuestas.
  assert.equal(hayOpcionesDuplicadas(['sí', 'si']), false)
})

// ── 5 · SEÑALES DE CRISIS ────────────────────────────────────────────────────

test('crisis en la PREGUNTA: se crea oculta, no se rechaza', () => {
  const plan = prepararCreacion({
    cuerpo: cuerpo({ pregunta: '¿Alguien más ha pensado en suicidarse?' }),
    rol: 'moderador',
  })

  // CONTRATOS §9.2: no se censura. §9.3: no se amplifica en el feed.
  assert.equal(plan.estado, 'hidden')
  assert.equal(plan.riesgo.requiereIntervencion, true)
  assert.ok(plan.riesgo.recursos.length > 0, 'nunca una tarjeta de crisis vacía')
  assert.ok(plan.riesgo.mensaje && plan.riesgo.mensaje.length > 0)
  // El mensaje no puede sonar a vigilancia.
  assert.ok(!plan.riesgo.mensaje.toLowerCase().includes('hemos detectado'))
})

test('crisis SOLO en una opción: también cuenta', () => {
  // La trampa que este módulo existe para evitar: la pregunta es inocua y el
  // riesgo está escondido en una respuesta posible.
  const plan = prepararCreacion({
    cuerpo: cuerpo({
      pregunta: '¿Cómo llevas la semana?',
      opciones: ['Bien', 'Regular', 'Me he cortado otra vez'],
    }),
    rol: 'moderador',
  })

  assert.equal(plan.estado, 'hidden')
  assert.equal(plan.riesgo.requiereIntervencion, true)
})

test('la tarjeta de ayuda viaja en la MISMA respuesta', () => {
  const plan = prepararCreacion({
    cuerpo: cuerpo({ pregunta: '¿Alguien más ha pensado en suicidarse?' }),
    rol: 'moderador',
  })
  const fila: FilaEncuestaCreada = {
    id: '11111111-1111-4111-8111-111111111111',
    state: 'hidden',
    origin: 'usuario',
    language: 'es',
    options: [
      { id: 'aaaaaaaa-1111-4111-8111-111111111111', ordinal: 0, label: 'Bien' },
      { id: 'bbbbbbbb-1111-4111-8111-111111111111', ordinal: 1, label: 'Regular' },
      { id: 'cccccccc-1111-4111-8111-111111111111', ordinal: 2, label: 'Cuesta arriba' },
    ],
  }

  const salida = proyectar(fila, plan)
  assert.equal(salida.publicada, false)
  assert.ok(salida.ayuda, 'los recursos van aquí, no en un correo ni en la pantalla siguiente')
  assert.ok(salida.ayuda.recursos.length > 0)
  assert.ok(salida.ayuda.recursos.every((r) => r.nombre.length > 0 && r.horario.length > 0))
})

test('sin crisis no se cuela ninguna tarjeta de ayuda', () => {
  const plan = prepararCreacion({ cuerpo: cuerpo(), rol: 'moderador' })
  const fila: FilaEncuestaCreada = {
    id: '22222222-2222-4222-8222-222222222222',
    state: 'active',
    origin: 'usuario',
    language: 'es',
    options: [{ id: 'dddddddd-2222-4222-8222-222222222222', ordinal: 0, label: 'Bien' }],
  }

  const salida = proyectar(fila, plan)
  assert.equal(salida.publicada, true)
  assert.equal(salida.ayuda, undefined)
})

// ── 6 · `total_votes` Y COMPAÑÍA, INYECTADOS EN EL CUERPO ────────────────────

test('total_votes en el cuerpo: 422, nunca ignorado en silencio', () => {
  // Es el ataque que documenta 0109_1 §0(a): publicar una encuesta ya con el
  // recuento que te conviene. Un esquema no estricto lo descartaría sin decir
  // nada, y el día que la RPC aceptara un parámetro más se convertiría en un
  // agujero sin que nadie tocara esta línea.
  const error = fallo({ cuerpo: cuerpo({ total_votes: 40000 }), rol: 'moderador' })
  assert.equal(error.code, 'entrada_invalida')
  // Y el 422 no le cuenta al atacante qué campo sobraba.
  assert.ok(!error.message.includes('total_votes'))
})

test('el resto de columnas del servidor tampoco se declaran desde fuera', () => {
  for (const campo of [
    { total_votes: 1 },
    { totalVotos: 1 },
    { origin: 'banco' },
    { origen: 'banco' },
    { bank_key: 'animo_semana' },
    { state: 'active' },
    { author_id: '33333333-3333-4333-8333-333333333333' },
    { authorId: '33333333-3333-4333-8333-333333333333' },
    { min_reveal: 3 },
    { is_anonymous: false },
    { created_at: '2030-01-01T00:00:00Z' },
  ]) {
    assert.equal(
      fallo({ cuerpo: cuerpo(campo), rol: 'moderador' }).code,
      'entrada_invalida',
      `${Object.keys(campo)[0]} tenía que rechazarse`,
    )
  }
})

// ── 7 · Umbral de revelación y fecha de cierre ───────────────────────────────

test('el umbral no puede bajar del suelo que impide des-anonimizar', () => {
  assert.equal(
    fallo({ cuerpo: cuerpo({ minRevelacion: MIN_REVELACION_SUELO - 1 }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
  assert.equal(
    prepararCreacion({ cuerpo: cuerpo({ minRevelacion: MIN_REVELACION_SUELO }), rol: 'moderador' })
      .minRevelacion,
    MIN_REVELACION_SUELO,
  )
})

test('idioma fuera del enum cerrado: 422', () => {
  assert.equal(
    fallo({ cuerpo: cuerpo({ idioma: 'fr' }), rol: 'moderador' }).code,
    'entrada_invalida',
  )
  assert.equal(prepararCreacion({ cuerpo: cuerpo({ idioma: 'en' }), rol: 'moderador' }).idioma, 'en')
})

test('una fecha de cierre ya pasada: 422', () => {
  const ahora = new Date('2026-08-03T12:00:00.000Z')
  assert.equal(
    fallo({
      cuerpo: cuerpo({ cierraEn: '2026-08-01T12:00:00.000Z' }),
      rol: 'moderador',
      ahora,
    }).code,
    'entrada_invalida',
  )
  assert.equal(
    prepararCreacion({
      cuerpo: cuerpo({ cierraEn: '2026-08-10T12:00:00.000Z' }),
      rol: 'moderador',
      ahora,
    }).cierraEn,
    '2026-08-10T12:00:00.000Z',
  )
})
