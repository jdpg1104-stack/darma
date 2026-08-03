// ============================================================================
// Validación de entrada y regla de crisis.
//
// Lo que se comprueba aquí no es «zod funciona» —eso ya lo prueba zod— sino que
// NINGÚN error de validación deja escapar la forma de la validación, y que los
// límites de TypeScript son los mismos que los CHECK de Postgres.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esErrorApi } from '../auth/errores.ts'
import {
  OPCIONES_MAX,
  OPCIONES_MIN,
  OPCION_MAX,
  ORDINAL_MAX,
  PREGUNTA_MAX,
  PREGUNTA_MIN,
} from './limites.ts'
import { evaluarRiesgoEncuesta } from './riesgo.ts'
import {
  esquemaEncuestaNueva,
  idiomaDeEncuestas,
  parsearIdEncuesta,
  parsearSiguiente,
  parsearVoto,
} from './validacion.ts'

const UUID = '11111111-1111-4111-8111-111111111111'

test('los límites de TS son los CHECK de 0002 y del banco', () => {
  // Si alguno cambia en SQL sin cambiar aquí, este test es el que avisa.
  assert.deepEqual(
    [PREGUNTA_MIN, PREGUNTA_MAX, OPCION_MAX, OPCIONES_MIN, OPCIONES_MAX, ORDINAL_MAX],
    [5, 200, 80, 2, 5, 9],
  )
})

// ── posicion ────────────────────────────────────────────────────────────────

test('posicion ausente vale 0 (la primera tarjeta del feed)', () => {
  assert.equal(parsearSiguiente(new URLSearchParams()).posicion, 0)
})

test('posicion se RECHAZA fuera de rango, no se recorta en silencio', () => {
  for (const valor of ['-1', '999999', 'tres', '1.5', '']) {
    assert.throws(
      () => parsearSiguiente(new URLSearchParams({ posicion: valor })),
      (e: unknown) => esErrorApi(e) && e.code === 'entrada_invalida',
      `debería rechazar ${JSON.stringify(valor)}`,
    )
  }
})

test('el mensaje de un 422 no describe la validación que falló', () => {
  try {
    parsearSiguiente(new URLSearchParams({ posicion: '-1' }))
    assert.fail('debería haber lanzado')
  } catch (e) {
    assert.ok(esErrorApi(e))
    assert.doesNotMatch(e.message, /posicion|zod|min|max|number/i)
  }
})

// ── id de la ruta ───────────────────────────────────────────────────────────

test('un id que no es uuid → 422, no 404 (nunca llega a Postgres)', () => {
  for (const valor of [undefined, '', 'no-soy-un-uuid', '1', '../../etc/passwd']) {
    assert.throws(
      () => parsearIdEncuesta(valor),
      (e: unknown) => esErrorApi(e) && e.code === 'entrada_invalida',
    )
  }
  assert.equal(parsearIdEncuesta(UUID), UUID)
})

// ── cuerpo del voto ─────────────────────────────────────────────────────────

test('el voto exige un opcionId con forma de uuid', () => {
  assert.deepEqual(parsearVoto({ opcionId: UUID }), { opcionId: UUID })
  for (const cuerpo of [null, undefined, {}, { opcionId: 1 }, { opcionId: 'x' }, 'texto']) {
    assert.throws(
      () => parsearVoto(cuerpo),
      (e: unknown) => esErrorApi(e) && e.code === 'entrada_invalida',
    )
  }
})

test('un userId en el cuerpo se IGNORA: el voto solo lleva opcionId', () => {
  const salida = parsearVoto({ opcionId: UUID, userId: 'otra-persona', user_id: 'otra-persona' })
  assert.deepEqual(Object.keys(salida), ['opcionId'])
})

// ── encuesta nueva ──────────────────────────────────────────────────────────

test('la encuesta nueva respeta los límites del esquema', () => {
  const ok = esquemaEncuestaNueva.safeParse({
    pregunta: '¿Cómo ha ido tu semana?',
    opciones: ['Bien', 'Regular'],
  })
  assert.equal(ok.success, true)

  assert.equal(esquemaEncuestaNueva.safeParse({ pregunta: 'ab', opciones: ['a', 'b'] }).success, false)
  assert.equal(
    esquemaEncuestaNueva.safeParse({ pregunta: 'x'.repeat(PREGUNTA_MAX + 1), opciones: ['a', 'b'] }).success,
    false,
  )
  assert.equal(esquemaEncuestaNueva.safeParse({ pregunta: '¿Qué tal?', opciones: ['solo una'] }).success, false)
  assert.equal(
    esquemaEncuestaNueva.safeParse({ pregunta: '¿Qué tal?', opciones: ['a', 'b', 'c', 'd', 'e', 'f'] }).success,
    false,
  )
  assert.equal(
    esquemaEncuestaNueva.safeParse({ pregunta: '¿Qué tal?', opciones: ['a', 'x'.repeat(OPCION_MAX + 1)] }).success,
    false,
  )
})

// ── idioma ──────────────────────────────────────────────────────────────────

test('el idioma cae en es salvo que se pida en claramente', () => {
  assert.equal(idiomaDeEncuestas(null), 'es')
  assert.equal(idiomaDeEncuestas('es-ES,es;q=0.9'), 'es')
  assert.equal(idiomaDeEncuestas('en-GB,en;q=0.9'), 'en')
  assert.equal(idiomaDeEncuestas('fr-FR'), 'es', 'lo desconocido va al idioma con banco real')
})

// ── Crisis (CONTRATOS §9) ───────────────────────────────────────────────────

test('una pregunta inocua no dispara intervención', () => {
  const r = evaluarRiesgoEncuesta('¿Cómo ha ido tu semana?', ['Bien', 'Regular'])
  assert.equal(r.requiereIntervencion, false)
  assert.equal(r.recursos.length, 0)
  assert.equal(r.mensaje, null)
})

test('una pregunta que es una llamada de auxilio disfrazada SÍ la dispara', () => {
  const r = evaluarRiesgoEncuesta('¿A alguien más le pasa? Yo quiero morirme casi todos los días', ['Sí', 'No'])
  assert.equal(r.requiereIntervencion, true)
  assert.ok(r.recursos.length > 0, 'nunca una pantalla de crisis sin recursos')
  assert.ok(r.mensaje && r.mensaje.length > 0)
  assert.doesNotMatch(r.mensaje, /hemos detectado/i, 'nada que suene a vigilancia')
})

test('el riesgo también se busca en las OPCIONES, no solo en la pregunta', () => {
  const r = evaluarRiesgoEncuesta('¿Cómo lo llevas?', ['Bien', 'Quiero morirme'])
  assert.equal(r.requiereIntervencion, true)
})

test('la formulación IMPERSONAL también dispara la intervención', () => {
  // Este test nació al revés: B09 lo dejó afirmando que la formulación
  // impersonal NO casaba, para que fallara el día que alguien lo arreglara. Ese
  // día llegó, así que ahora afirma el comportamiento bueno.
  //
  // Por qué importa más de lo que parece: `lib/crisis.ts` se escribió pensando
  // en el DESAHOGO, que se redacta en primera persona («suicidarme»). Pero una
  // encuesta se formula por naturaleza en impersonal, y —lo de verdad
  // relevante— quien está peor rara vez habla de sí mismo: pregunta por
  // «alguien», tantea el terreno. Justo el caso que más importa cazar era el
  // que se escapaba.
  for (const texto of [
    '¿alguien más ha pensado en suicidarse?',
    '¿es normal pensar en quitarse la vida cuando todo va mal?',
  ]) {
    const r = evaluarRiesgoEncuesta(texto, ['Sí', 'No'])
    assert.equal(r.requiereIntervencion, true, texto)
    assert.ok(r.recursos.length > 0, 'nunca una pantalla de crisis sin recursos')
  }
})

test('evaluarRiesgoEncuesta es pura: mismo texto, mismo resultado', () => {
  const a = evaluarRiesgoEncuesta('¿Cómo ha ido tu semana?', ['Bien'])
  const b = evaluarRiesgoEncuesta('¿Cómo ha ido tu semana?', ['Bien'])
  assert.deepEqual(a.evaluacion, b.evaluacion)
})
