// ============================================================================
// Pruebas del DISPARADOR del aviso «alma afín disponible» (B05 → B13)
//
//   node --test --experimental-strip-types "app/(app)/perfil/editar/acciones.test.ts"
//
// La Server Action no se puede importar aquí (es `'use server'` y arrastra
// `next/cache` e imports `@/` que node --test no resuelve), así que su parte se
// vigila como hacen `hilo.test.ts` y `enganche.test.ts`: leyendo el fuente y
// afirmando sobre él. La DECISIÓN de cuándo avisar es pura, vive en
// `components/perfil/proyecciones.ts` (`transicionANecesitoHablar`) y se prueba
// caso a caso en `components/perfil/perfil.test.ts`. Aquí queda lo demás:
//
//   · la llamada existe, UNA vez, guardada por la transición y tras
//     confirmarse la escritura — nunca en cada guardado;
//   · la disponibilidad PREVIA sale de la fila memoizada de `mi_sesion()`,
//     sin pagar una consulta extra;
//   · `avisarAlmasAfines()` resuelve sin lanzar aunque no haya Supabase ni
//     llaves VAPID: un fallo del push no puede romper el guardado.
// ============================================================================

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  avisarAlmasAfines,
  configurarDespacho,
} from '../../../../lib/push/despacho.ts'
import { restaurarEnvio } from '../../../../lib/push/enviar.ts'

const AQUI = import.meta.dirname

// ── 1. El fuente de acciones.ts ─────────────────────────────────────────────

test('acciones.ts avisa UNA vez, guardado por la transición y dentro de su try', () => {
  const fuente = readFileSync(join(AQUI, 'acciones.ts'), 'utf8')

  assert.equal(
    (fuente.match(/avisarAlmasAfines\(/g) ?? []).length,
    1,
    'una única llamada en toda la acción',
  )
  assert.match(
    fuente,
    /if \(transicionANecesitoHablar\(disponibilidadPrevia, cambios\)\) \{\s*try \{\s*await avisarAlmasAfines\(sesion\.userId\)/,
    'la guarda de la transición y el try envuelven la llamada, en ese orden',
  )
  assert.match(
    fuente,
    /catch \{\s*\/\/[^\n]*\n\s*console\.warn\('\[darma\]\[b13\] aviso de alma afín no enviado'\)/,
    'el fallo se registra con prefijo estable y SIN uuids',
  )
})

test('acciones.ts avisa DESPUÉS de confirmarse el UPDATE, nunca antes', () => {
  const fuente = readFileSync(join(AQUI, 'acciones.ts'), 'utf8')

  const iUpdate = fuente.indexOf('.update(cambios)')
  const iNoGuardado = fuente.indexOf('errores.noGuardado')
  const iAviso = fuente.indexOf('avisarAlmasAfines(')

  assert.ok(iUpdate > -1 && iNoGuardado > -1 && iAviso > -1)
  assert.ok(iUpdate < iAviso, 'el aviso va después del UPDATE')
  assert.ok(
    iNoGuardado < iAviso,
    'y después del camino de error: un guardado que falló no avisa a nadie',
  )
})

test('la disponibilidad previa sale de la fila memoizada, sin consulta extra', () => {
  const fuente = readFileSync(join(AQUI, 'acciones.ts'), 'utf8')

  assert.ok(
    fuente.includes('const disponibilidadPrevia = contexto.fila?.availability ?? null'),
    'la previa viene de la MISMA fila de mi_sesion() que ya pagó getContextoSesion',
  )
  assert.equal(
    (fuente.match(/\.select\(/g) ?? []).length,
    0,
    'la acción no añade ninguna lectura nueva para averiguarla',
  )
})

// ── 2. avisarAlmasAfines() no puede romper el guardado ──────────────────────

const CLAVES_ENTORNO = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  // Se vacían también las de Supabase: así la resolución de destinatarios
  // falla SIEMPRE de la misma forma, tenga o no la máquina un .env cargado.
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

const ENTORNO = new Map(CLAVES_ENTORNO.map((c) => [c, process.env[c]]))

beforeEach(() => {
  for (const clave of CLAVES_ENTORNO) delete process.env[clave]
  restaurarEnvio()
  configurarDespacho(null)
})

afterEach(() => {
  restaurarEnvio()
  configurarDespacho(null)
  for (const clave of CLAVES_ENTORNO) {
    const previa = ENTORNO.get(clave)
    if (previa === undefined) delete process.env[clave]
    else process.env[clave] = previa
  }
})

test('sin llaves VAPID (el estado real de hoy) es un no-op: resuelve a cero', async () => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY

  const r = await avisarAlmasAfines('11111111-2222-3333-4444-555555555555')

  assert.deepEqual(r, { destinatarios: 0, enviados: 0 })
})

test('FALLO: con llaves pero sin Supabase, resuelve sin lanzar — el guardado no se rompe', async () => {
  // En este proceso no hay SUPABASE_* : la resolución de destinatarios (la RPC
  // `destinatarios_alma_afin`) falla por dentro. Si eso lanzara, la Server
  // Action devolvería un error a quien acaba de decir que está mal, con su
  // disponibilidad YA escrita. Por eso el contrato es resolver siempre (y aun
  // así la acción lo envuelve en su propio try).
  process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba'
  process.env.VAPID_PRIVATE_KEY = 'PrivadaDePrueba'

  const r = await avisarAlmasAfines('11111111-2222-3333-4444-555555555555')

  assert.equal(r.enviados, 0)
  assert.equal(r.destinatarios, 0)
})
