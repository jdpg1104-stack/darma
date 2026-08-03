// ============================================================================
// Pruebas del contrato de la ruta que se pueden ejecutar sin el runtime de Next.
//
// `route.ts` no se importa aquí a propósito: arrastra `next/server`,
// `next/headers` y el cliente de Supabase, y montar todo eso con `node --test`
// probaría más el andamiaje que la regla. Lo que sí se prueba —y es lo que la
// ficha exige— es la GARANTÍA: sin sesión, `no_autenticado` (401), no un feed
// vacío. Un feed vacío hace pensar que la app está rota y manda a la gente a
// cerrar sesión para «arreglarlo»; un 401 lleva a la pantalla de entrar.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esErrorApi } from '../../../lib/auth/errores.ts'
import { sobreDeError } from '../../../lib/auth/respuestas.ts'
import { requireSesion } from '../../../lib/auth/session.ts'

test('FALLO · sin sesión: no_autenticado con status 401, nunca un feed vacío', async () => {
  // Fuera del runtime de Next no hay cookies, que a todos los efectos es «no
  // hay sesión»: exactamente el caso que se quiere fijar.
  await assert.rejects(
    () => requireSesion(),
    (error: unknown) => {
      assert.ok(esErrorApi(error))
      assert.equal(error.code, 'no_autenticado')
      assert.equal(error.status, 401)
      return true
    },
  )
})

test('FALLO · el sobre público de ese error cumple CONTRATOS §4', async () => {
  const error = await requireSesion().then(
    () => null,
    (causa: unknown) => causa,
  )

  const sobre = sobreDeError(error)
  assert.equal(sobre.status, 401)
  assert.deepEqual(Object.keys(sobre.cuerpo).sort(), ['code', 'message', 'ok'])
  assert.equal(sobre.cuerpo.ok, false)
  // Ni `causa`, ni stack, ni nada del proveedor.
  assert.ok(!JSON.stringify(sobre.cuerpo).includes('causa'))
})
