// ============================================================================
// Pruebas de lib/auth/session.ts — los dos caminos de fallo
//
// Son los dos que revientan la app entera si se implementan mal, porque todos
// los bloques llaman a estas funciones:
//   · sin cookie → 'no_autenticado', NUNCA un 500 ni un null silencioso que la
//     ruta de turno interprete como "adelante".
//   · con sesión pero sin perfil → 'sin_permiso', NUNCA una sesión con alias
//     vacío arrastrada al resto de las pantallas.
// ============================================================================

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ErrorApi, esErrorApi } from './errores.ts'
import { exigirPerfil, getSesion, requirePerfil, requireSesion, type Sesion } from './session.ts'

/** Sesión anónima recién creada: autenticada, pero sin fila en `profiles`. */
const SESION_ANONIMA: Sesion = {
  userId: '00000000-0000-4000-8000-000000000001',
  esAnonimo: true,
  alias: null,
  nivel: 'semilla',
  shadowBanned: false,
  bannedUntil: null,
  perfilCompleto: false,
}

describe('requireSesion sin cookie', () => {
  // Fuera del runtime de Next no hay contexto de petición, que es exactamente
  // la situación de "nadie ha presentado una cookie válida".

  it('devuelve null en getSesion, sin lanzar', () => {
    return getSesion().then((sesion) => {
      assert.equal(sesion, null)
    })
  })

  it("lanza ErrorApi con code === 'no_autenticado'", async () => {
    await assert.rejects(
      () => requireSesion(),
      (error: unknown) => {
        assert.ok(esErrorApi(error), 'debe ser un ErrorApi, no un TypeError ni un 500')
        assert.equal((error as ErrorApi).code, 'no_autenticado')
        assert.equal((error as ErrorApi).status, 401)
        return true
      },
    )
  })

  it('requirePerfil también falla por no_autenticado antes que por perfil', async () => {
    await assert.rejects(
      () => requirePerfil(),
      (error: unknown) => (error as ErrorApi).code === 'no_autenticado',
    )
  })
})

describe('exigirPerfil', () => {
  it("con sesión anónima sin perfil lanza 'sin_permiso'", () => {
    assert.throws(
      () => exigirPerfil(SESION_ANONIMA),
      (error: unknown) => {
        assert.ok(esErrorApi(error))
        assert.equal((error as ErrorApi).code, 'sin_permiso')
        assert.equal((error as ErrorApi).status, 403)
        return true
      },
    )
  })

  it('no deja pasar un perfilCompleto=true con alias nulo', () => {
    // Defensa contra el estado incoherente: si algún día la fila llega sin
    // alias, el resto de la app no debe recibir `alias: null` tipado como string.
    assert.throws(
      () => exigirPerfil({ ...SESION_ANONIMA, perfilCompleto: true }),
      (error: unknown) => (error as ErrorApi).code === 'sin_permiso',
    )
  })

  it('con perfil devuelve la sesión con el alias ya estrechado', () => {
    const sesion = exigirPerfil({
      ...SESION_ANONIMA,
      alias: 'Faro Sereno 1234',
      perfilCompleto: true,
    })
    assert.equal(sesion.alias, 'Faro Sereno 1234')
  })

  it('el mensaje no menciona tablas, columnas ni SQL', () => {
    try {
      exigirPerfil(SESION_ANONIMA)
      assert.fail('debería haber lanzado')
    } catch (error) {
      const mensaje = (error as ErrorApi).message
      for (const prohibido of ['profiles', 'select', 'row-level', 'null', 'uuid']) {
        assert.equal(mensaje.toLowerCase().includes(prohibido), false, `filtra "${prohibido}"`)
      }
    }
  })
})
