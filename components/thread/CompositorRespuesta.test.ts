// ============================================================================
// CompositorRespuesta — pruebas del montaje del opt-in de push (B13).
//
// Mismo enfoque que app/(app)/layout.test.ts: se lee la FUENTE, porque el modo
// de fallo de este montaje es silencioso en las dos direcciones. Si alguien lo
// quita, no se rompe ningún tipo: simplemente nadie vuelve a activar los avisos
// (así estuvo la app semanas, con components/pwa completo y sin montar). Y si
// alguien lo saca del condicional y lo monta al cargar, el permiso se pide en
// el vacío — y la denegación de Chrome es PERMANENTE para el origen (cabecera
// de components/pwa/OptInPush.tsx).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const carpeta = dirname(fileURLToPath(import.meta.url))
const fuente = readFileSync(join(carpeta, 'CompositorRespuesta.tsx'), 'utf8')

test('monta OptInPush con el momento correcto: primer_comentario_validado', () => {
  assert.match(fuente, /<OptInPush momento="primer_comentario_validado" \/>/)
})

test('el opt-in solo se pinta cuando el comentario quedó válido, nunca antes', () => {
  // El montaje va dentro del condicional `estado === 'valido'`. Con
  // `en_revision` o `no_valido` no hay nada que avisar, y pedir el permiso ahí
  // es pedirlo en el vacío.
  assert.match(
    fuente,
    /\{estado === 'valido' \? <OptInPush momento="primer_comentario_validado" \/> : null\}/,
  )
})

test('EstadoValidacion sigue sin montar OptInPush: es presentación pura', () => {
  const estadoValidacion = readFileSync(join(carpeta, 'EstadoValidacion.tsx'), 'utf8')
  assert.doesNotMatch(estadoValidacion, /OptInPush/)
})

test('no importa la capa admin de push: eso jamás puede acabar en un bundle de navegador', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
})
