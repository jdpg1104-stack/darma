// ============================================================================
// Pruebas de B03 · las nueve de la ficha, con los seis caminos de fallo.
//
// Se ejecutan con:
//   npx node --test --experimental-strip-types "app/api/posts/_dominio/publicar.test.ts"
//
// Lo que NO se prueba aquí y por qué: el gate 3:1 en sí. Un test de Node no
// puede comprobar que el trigger de Postgres descuenta el crédito bajo lock —
// eso se verificó contra la base real de `darma-dev` (ver el informe del bloque
// y la cabecera de 0103_1_b03_publicar.sql). Aquí se prueba lo que la RUTA hace
// con lo que Postgres le devuelve, que es donde estaba el bug que se cuela.
// ============================================================================

import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import {
  codigoDesdeErrorDePost,
  construirTarjetaRecursos,
  esquemaCrearPost,
  esquemaEditarPost,
  evaluarRiesgo,
  ipDeCabeceras,
  claveDeIp,
  mensajeDeValidacion,
  nombresDeRecursos,
  PREFIJO_RECIPROCIDAD,
} from './publicar.ts'
import { CUERPO_MAX, CUERPO_MIN, TEMAS } from '../../../../components/composer/temas.ts'
import { RECIPROCITY_SERVER_REJECTION } from '../../../../lib/reciprocity.ts'

/** El error tal cual lo devuelve PostgREST cuando el trigger levanta la
 *  excepción de 0001_core.sql. Copiado de una ejecución real contra darma-dev. */
const ERROR_RECIPROCIDAD = {
  code: '23514',
  message: 'reciprocidad: necesitas escuchar a 3 personas para publicar',
}

/** El OTRO 23514: el CHECK `char_length(body) between 20 and 5000`. */
const ERROR_LONGITUD = {
  code: '23514',
  message: 'new row for relation "posts" violates check constraint "posts_body_check"',
}

const CUERPO_VALIDO = 'Llevo tres semanas durmiendo fatal y hoy por fin quiero contarlo.'

// ────────────────────────────────────────────────────────────────────────────
describe('los dos 23514 · la trampa central del bloque', () => {
  test('el 23514 del trigger de reciprocidad → code reciprocidad', () => {
    assert.equal(codigoDesdeErrorDePost(ERROR_RECIPROCIDAD), 'reciprocidad')
  })

  // ── FALLO nº 3 de la ficha: EL BUG QUE SE CUELA ──────────────────────────
  test('FALLO · el 23514 por longitud del cuerpo → entrada_invalida, NO reciprocidad', () => {
    assert.equal(codigoDesdeErrorDePost(ERROR_LONGITUD), 'entrada_invalida')
  })

  test('se discrimina por el MENSAJE, no por el código: un 23514 inventado sin prefijo no es reciprocidad', () => {
    assert.equal(
      codigoDesdeErrorDePost({ code: '23514', message: 'violates check constraint "otro_check"' }),
      'entrada_invalida',
    )
  })

  test('y al revés: el prefijo manda aunque el código llegue vacío', () => {
    // PostgREST no siempre propaga el SQLSTATE con el mismo campo; el prefijo
    // está fijado en `posts_consume_credit()` y es la señal fiable.
    assert.equal(
      codigoDesdeErrorDePost({ message: `${PREFIJO_RECIPROCIDAD} necesitas escuchar a 3 personas` }),
      'reciprocidad',
    )
  })

  test('42501 (RLS o privilegio de columna) → sin_permiso, nunca 500', () => {
    assert.equal(
      codigoDesdeErrorDePost({ code: '42501', message: 'permission denied for table posts' }),
      'sin_permiso',
    )
    assert.equal(
      codigoDesdeErrorDePost({ message: 'new row violates row-level security policy' }),
      'sin_permiso',
    )
  })

  test('23503 (sin fila en profiles: onboarding a medias) → sin_permiso', () => {
    assert.equal(
      codigoDesdeErrorDePost({ code: '23503', message: 'violates foreign key constraint' }),
      'sin_permiso',
    )
  })

  test('lo desconocido cae a error_interno y el mensaje de Postgres NO viaja', () => {
    const codigo = codigoDesdeErrorDePost({ code: 'XX000', message: 'relation "posts" does not exist' })
    assert.equal(codigo, 'error_interno')
    // El código es un enum: por construcción no puede arrastrar el texto.
    assert.equal(typeof codigo, 'string')
  })

  test('el copy de reciprocidad que ve la persona no menciona la palabra prohibida', () => {
    assert.ok(!/crédito|credito/i.test(RECIPROCITY_SERVER_REJECTION))
    // Y tampoco filtra el mensaje interno del trigger.
    assert.ok(!RECIPROCITY_SERVER_REJECTION.includes(PREFIJO_RECIPROCIDAD))
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('validación de entrada', () => {
  test('un cuerpo válido con kind y topic de la lista pasa', () => {
    const salida = esquemaCrearPost.parse({
      body: CUERPO_VALIDO,
      kind: 'desahogo',
      topic: 'ansiedad',
    })
    assert.equal(salida.kind, 'desahogo')
    assert.equal(salida.topic, 'ansiedad')
  })

  // ── FALLO nº 4 de la ficha ───────────────────────────────────────────────
  test('FALLO · un authorId en el cuerpo se RECHAZA (.strict), no se ignora', () => {
    const resultado = esquemaCrearPost.safeParse({
      body: CUERPO_VALIDO,
      kind: 'desahogo',
      topic: 'ansiedad',
      authorId: '00000000-0000-0000-0000-0000000000ff',
    })
    assert.equal(resultado.success, false)
    // Lo que importa: en ningún camino el objeto validado contiene authorId.
    if (resultado.success) assert.fail('no debería validar')
  })

  test('FALLO · un cuerpo de 19 caracteres no llega ni a salir del proceso', () => {
    const corto = 'x'.repeat(CUERPO_MIN - 1)
    assert.equal(esquemaCrearPost.safeParse({ body: corto, kind: 'desahogo', topic: 'otro' }).success, false)
  })

  test('FALLO · 5001 caracteres tampoco', () => {
    const largo = 'x'.repeat(CUERPO_MAX + 1)
    assert.equal(esquemaCrearPost.safeParse({ body: largo, kind: 'desahogo', topic: 'otro' }).success, false)
  })

  test('exactamente 20 y exactamente 5000 sí: los límites son los del CHECK de 0001', () => {
    assert.ok(esquemaCrearPost.safeParse({ body: 'x'.repeat(CUERPO_MIN), kind: 'pregunta', topic: 'otro' }).success)
    assert.ok(esquemaCrearPost.safeParse({ body: 'x'.repeat(CUERPO_MAX), kind: 'gratitud', topic: 'otro' }).success)
  })

  test('FALLO · un topic fuera de la lista cerrada se rechaza', () => {
    assert.equal(
      esquemaCrearPost.safeParse({ body: CUERPO_VALIDO, kind: 'desahogo', topic: 'politica' }).success,
      false,
    )
  })

  test('FALLO · un kind fuera del enum post_kind se rechaza', () => {
    assert.equal(
      esquemaCrearPost.safeParse({ body: CUERPO_VALIDO, kind: 'denuncia', topic: 'otro' }).success,
      false,
    )
  })

  test('los diez temas de la ficha son los diez que acepta el esquema', () => {
    for (const tema of TEMAS) {
      assert.ok(
        esquemaCrearPost.safeParse({ body: CUERPO_VALIDO, kind: 'desahogo', topic: tema }).success,
        `el tema ${tema} debería valer`,
      )
    }
  })

  test('el PATCH no acepta kind: editar el tipo de un post ya publicado no está concedido', () => {
    assert.equal(
      esquemaEditarPost.safeParse({ body: CUERPO_VALIDO, topic: 'duelo', kind: 'gratitud' }).success,
      false,
    )
  })

  test('el mensaje de validación no filtra el detalle de zod', () => {
    const resultado = esquemaCrearPost.safeParse({ body: 'corto', kind: 'desahogo', topic: 'otro' })
    assert.equal(resultado.success, false)
    if (resultado.success) return
    const mensaje = mensajeDeValidacion(resultado.error)
    assert.ok(mensaje.includes(String(CUERPO_MIN)))
    // Ni «String must contain at least», ni el nombre del campo en inglés, ni
    // una expresión regular.
    assert.ok(!/String must|ZodError|regex/i.test(mensaje))
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('crisis · los recursos van en la MISMA respuesta', () => {
  test('riesgo none → sin tarjeta, y el post se publica igual', async () => {
    const riesgo = await evaluarRiesgo('Hoy he ido a comprar pan y hacía un sol estupendo.')
    assert.equal(riesgo.nivel, 'none')
    assert.equal(riesgo.requiereIntervencion, false)
    assert.equal(construirTarjetaRecursos(riesgo.nivel, 'ES'), null)
  })

  test("riesgo low no interrumpe: es el nivel ruidoso a propósito", async () => {
    const riesgo = await evaluarRiesgo('No puedo más con todo esto, estoy al límite.')
    assert.equal(riesgo.nivel, 'low')
    assert.equal(construirTarjetaRecursos(riesgo.nivel, 'ES'), null)
  })

  // ── Prueba nº 6 de la ficha ──────────────────────────────────────────────
  test('riesgo critical → tarjeta con líneas del país y acción inmediata', async () => {
    const riesgo = await evaluarRiesgo('Ya lo he decidido: esta noche voy a acabar con todo.')
    assert.equal(riesgo.nivel, 'critical')
    assert.equal(riesgo.requiereIntervencion, true)

    const tarjeta = construirTarjetaRecursos(riesgo.nivel, 'ES')
    assert.ok(tarjeta, 'con riesgo critical TIENE que haber tarjeta')
    assert.ok(tarjeta.lineas.length > 0, 'nunca una lista vacía de recursos')
    assert.ok(tarjeta.lineas.some((l) => l.telefono === '024'), 'la línea española del 024')
    assert.equal(tarjeta.accionInmediata.href, '/ayuda')
  })

  test('un país desconocido cae al directorio internacional, nunca a lista vacía', () => {
    const tarjeta = construirTarjetaRecursos('critical', 'ZZ')
    assert.ok(tarjeta)
    assert.ok(tarjeta.lineas.length > 0)
    assert.ok(tarjeta.lineas.every((l) => l.url || l.telefono))
  })

  test('sin país tampoco se queda nadie sin recursos', () => {
    const tarjeta = construirTarjetaRecursos('high', null)
    assert.ok(tarjeta)
    assert.ok(tarjeta.lineas.length > 0)
  })

  test('crisis_events registra EXACTAMENTE los recursos que se mostraron', () => {
    const tarjeta = construirTarjetaRecursos('critical', 'MX')
    assert.deepEqual(
      nombresDeRecursos(tarjeta),
      tarjeta!.lineas.map((l) => l.nombre),
    )
    assert.deepEqual(nombresDeRecursos(null), [])
  })

  test('la tarjeta no alarma, no diagnostica y no subraya las palabras de la persona', () => {
    const tarjeta = construirTarjetaRecursos('critical', 'ES')!
    const texto = `${tarjeta.titulo} ${tarjeta.mensaje}`
    assert.ok(!/hemos detectado|riesgo|suicid|crítico|critico/i.test(texto))
    // Y confirma que el post NO se ha escondido: es lo primero que dice.
    assert.ok(/publicado/i.test(tarjeta.titulo))
  })

  test('el nivel de riesgo nunca forma parte de la tarjeta', () => {
    const tarjeta = construirTarjetaRecursos('critical', 'ES')!
    assert.equal(JSON.stringify(tarjeta).includes('critical'), false)
    assert.equal('risk' in tarjeta, false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('PII · el cliente no es autoridad', () => {
  // ── FALLO nº 5 de la ficha ───────────────────────────────────────────────
  // `assertNoPii` es de lib/anonymity.ts y ya tiene su propia suite; lo que se
  // prueba aquí es que el esquema NO lo hace por su cuenta: un teléfono es un
  // cuerpo perfectamente válido para zod, y por eso la ruta tiene que llamar a
  // assertNoPii explícitamente. Si algún día alguien mueve esa comprobación a
  // zod, este test seguirá pasando pero el orden de la ficha se habrá roto; el
  // orden está fijado en el comentario de cabecera de route.ts.
  test('zod acepta un cuerpo con teléfono: la barrera es assertNoPii en la ruta', () => {
    const conTelefono = 'Si alguien quiere hablar, mi teléfono es el 612 345 678, escribidme.'
    assert.ok(esquemaCrearPost.safeParse({ body: conTelefono, kind: 'desahogo', topic: 'otro' }).success)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('rate limit por IP · la IP nunca se persiste en claro', () => {
  const sha256Falso = (v: string) => Buffer.from(v).toString('hex')

  test('la clave del rate limit no contiene la IP', () => {
    const clave = claveDeIp('203.0.113.42', 'pimienta', sha256Falso)
    assert.ok(!clave.includes('203.0.113.42'))
    assert.equal(clave.length, 32)
  })

  test('la pimienta cambia la clave: sin ella el espacio IPv4 es enumerable', () => {
    assert.notEqual(
      claveDeIp('203.0.113.42', 'pimienta-a', sha256Falso),
      claveDeIp('203.0.113.42', 'pimienta-b', sha256Falso),
    )
  })

  test('de x-forwarded-for se toma la PRIMERA, que es la del cliente', () => {
    assert.equal(ipDeCabeceras('203.0.113.42, 70.41.3.18, 150.172.238.178', null), '203.0.113.42')
  })

  test('sin x-forwarded-for se cae a x-real-ip, y sin ninguna de las dos, null', () => {
    assert.equal(ipDeCabeceras(null, '198.51.100.7'), '198.51.100.7')
    assert.equal(ipDeCabeceras(null, null), null)
    assert.equal(ipDeCabeceras('', ''), null)
  })
})
