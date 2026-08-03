// ============================================================================
// Pruebas de la lógica de las rutas de B01: magic link, validación y límites.
//
// Se prueban los módulos y no los handlers de Next a propósito: un handler
// necesita el runtime entero (cookies, NextRequest) y lo que hay que verificar
// aquí es la DECISIÓN, no el envoltorio. La frontera está puesta en
// lib/auth/respuestas.ts, que devuelve `{ status, cuerpo }` sin tocar Next.
// ============================================================================

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { __resetMemoryBuckets } from '../rateLimit.ts'
import { ErrorApi, esErrorApi } from './errores.ts'
import { LIMITES_AUTH, limitar } from './limites.ts'
import { procesarMagicLink } from './magicLink.ts'
import { sobreDeError, sobreOk } from './respuestas.ts'
import { PATRON_ALIAS, validarAlias, validarEmail, validarParcheMe } from './validacion.ts'

beforeEach(() => {
  __resetMemoryBuckets()
})

// ── 5 · El magic link no es un oráculo ──────────────────────────────────────

describe('procesarMagicLink', () => {
  it('devuelve EXACTAMENTE el mismo status y el mismo cuerpo exista o no la cuenta', async () => {
    // Cuenta que existe: el proveedor envía y resuelve.
    const existente = await procesarMagicLink({
      email: 'ana@gmail.com',
      enviar: async () => {},
    })

    // Cuenta que no existe: el proveedor rechaza (`shouldCreateUser: false`).
    const inexistente = await procesarMagicLink({
      email: 'nadie@gmail.com',
      enviar: async () => {
        throw new Error('User not found')
      },
    })

    assert.equal(existente.status, inexistente.status)
    assert.deepEqual(existente.cuerpo, inexistente.cuerpo)
    assert.deepEqual(existente.cuerpo, { ok: true, data: { enviado: true } })
  })

  it('no deja escapar el mensaje del proveedor', async () => {
    const sobre = await procesarMagicLink({
      email: 'ana@gmail.com',
      enviar: async () => {
        throw new Error('relation "auth.users" does not exist')
      },
    })
    assert.equal(JSON.stringify(sobre).includes('auth.users'), false)
  })
})

// ── 6 · Alias: entrada inválida sin filtrar el patrón ───────────────────────

describe('validarAlias', () => {
  const invalidos = ['<script>alert(1)</script>', 'ab', '', '   ', 'a'.repeat(25), 'ana@gmail.com']

  for (const valor of invalidos) {
    it(`rechaza ${JSON.stringify(valor)} con entrada_invalida`, () => {
      assert.throws(
        () => validarAlias(valor),
        (error: unknown) => {
          assert.ok(esErrorApi(error))
          assert.equal((error as ErrorApi).code, 'entrada_invalida')
          assert.equal((error as ErrorApi).status, 422)

          // Lo que NO puede salir: la expresión regular. Es el mismo CHECK que
          // protege profiles.alias, y publicarlo es publicar el esquema.
          const mensaje = (error as ErrorApi).message
          assert.equal(mensaje.includes(PATRON_ALIAS.source), false)
          assert.equal(mensaje.includes('^['), false)
          assert.equal(mensaje.includes('regex'), false)
          assert.equal(mensaje.toLowerCase().includes('profiles'), false)
          return true
        },
      )
    })
  }

  it('acepta los alias que genera lib/anonymity.ts y los acentos del CHECK', () => {
    assert.equal(validarAlias('Faro Sereno 1234'), 'Faro Sereno 1234')
    assert.equal(validarAlias('Vigía_Cálido 42'), 'Vigía_Cálido 42')
    assert.equal(validarAlias('  Río Tenaz 7777  '), 'Río Tenaz 7777')
  })
})

describe('validarEmail', () => {
  it('rechaza lo que no es un correo y lo que pasa de 254 caracteres', () => {
    assert.throws(() => validarEmail('no-es-un-correo'), /correo/)
    assert.throws(() => validarEmail(`${'a'.repeat(250)}@gmail.com`))
    assert.throws(() => validarEmail(undefined))
  })

  it('normaliza a minúsculas y sin espacios', () => {
    assert.equal(validarEmail('  Ana@Gmail.COM '), 'ana@gmail.com')
  })
})

describe('validarParcheMe', () => {
  it('ignora en silencio los campos que no le corresponden', () => {
    // Asignación masiva: si esto dejara pasar karmaSpendable, la ruta lo
    // intentaría escribir. (Postgres lo impediría igual por privilegio de
    // columna, pero la API no debe llegar siquiera a intentarlo.)
    const parche = validarParcheMe({
      disponibilidad: 'necesito_hablar',
      karmaSpendable: 999999,
      alias: 'otro',
    })
    assert.deepEqual(parche, { disponibilidad: 'necesito_hablar' })
  })

  it('rechaza un parche vacío y un valor fuera del enum', () => {
    assert.throws(() => validarParcheMe({}), /No has cambiado nada/)
    assert.throws(() => validarParcheMe({ entryLevel: 'administrador' }))
    assert.throws(() => validarParcheMe(null))
  })
})

// ── 8 · Rate limit de alias-libre ───────────────────────────────────────────

describe('limitar', () => {
  it('superar el límite de alias-libre lanza demasiadas_peticiones con retryAfter en segundos', async () => {
    const preset = LIMITES_AUTH.aliasLibre
    const sujeto = 'usuario-de-prueba'

    // Las `limite` primeras pasan (la que hace exactamente el límite todavía
    // entra: ver check_rate_limit en 0002).
    for (let i = 0; i < preset.limite; i++) {
      await limitar('aliasLibre', sujeto)
    }

    await assert.rejects(
      () => limitar('aliasLibre', sujeto),
      (error: unknown) => {
        assert.ok(esErrorApi(error))
        const fallo = error as ErrorApi
        assert.equal(fallo.code, 'demasiadas_peticiones')
        assert.equal(fallo.status, 429)
        assert.ok(typeof fallo.retryAfter === 'number')
        assert.ok(fallo.retryAfter! > 0)
        // En SEGUNDOS, no en milisegundos: una ventana de 60 s no puede pedir
        // 60 000 de espera.
        assert.ok(fallo.retryAfter! <= preset.ventanaSegundos)
        return true
      },
    )
  })

  it('el 429 llega al cuerpo público con su retryAfter', async () => {
    const sujeto = 'otro-usuario'
    for (let i = 0; i < LIMITES_AUTH.aliasLibre.limite; i++) {
      await limitar('aliasLibre', sujeto)
    }

    try {
      await limitar('aliasLibre', sujeto)
      assert.fail('debería haber lanzado')
    } catch (error) {
      const sobre = sobreDeError(error)
      assert.equal(sobre.status, 429)
      assert.equal(sobre.cuerpo.ok, false)
      assert.equal(sobre.cuerpo.ok === false && sobre.cuerpo.code, 'demasiadas_peticiones')
      assert.ok(sobre.cuerpo.ok === false && typeof sobre.cuerpo.retryAfter === 'number')
    }
  })

  it('contadores independientes por sujeto', async () => {
    for (let i = 0; i < LIMITES_AUTH.aliasLibre.limite; i++) {
      await limitar('aliasLibre', 'persona-a')
    }
    // La segunda persona no hereda el contador de la primera.
    await limitar('aliasLibre', 'persona-b')
  })
})

// ── Forma de las respuestas ─────────────────────────────────────────────────

describe('sobres de respuesta', () => {
  it('el éxito es { ok: true, data }', () => {
    assert.deepEqual(sobreOk({ libre: true }), {
      status: 200,
      cuerpo: { ok: true, data: { libre: true } },
    })
  })

  it('un error desconocido se convierte en error_interno sin detalle', () => {
    const sobre = sobreDeError(new Error('duplicate key value violates unique constraint "uq_x"'))
    assert.equal(sobre.status, 500)
    assert.deepEqual(sobre.cuerpo, {
      ok: false,
      code: 'error_interno',
      message: 'Algo ha fallado por nuestra parte. Ya lo estamos mirando.',
    })
    // Ni el nombre del índice, ni el stack, ni la causa.
    assert.equal(JSON.stringify(sobre).includes('uq_x'), false)
  })

  it('la causa de un ErrorApi no se serializa', () => {
    const error = new ErrorApi('entrada_invalida', {
      mensaje: 'Ese alias ya está en uso.',
      causa: new Error('constraint "profiles_alias_key"'),
    })
    assert.equal(JSON.stringify(sobreDeError(error)).includes('profiles_alias_key'), false)
  })
})
