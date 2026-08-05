// ============================================================================
// BotonSalir — pruebas de la secuencia de cierre de sesión.
//
// Fuente, no runtime: lo que protege este archivo es un ORDEN, y el orden no lo
// vigila ningún tipo. Si `avisarCierreDeSesion()` se llama después de redirigir
// (o se deja de llamar), no falla nada visible: el shell cacheado de la cuenta
// anterior simplemente sigue vivo cuando otra persona entra en el mismo
// dispositivo — y compartir el móvil es lo normal en esta app, no la excepción
// (pedido B13 → B01 en HANDOFF/PEDIDOS.md).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BotonSalir.tsx'), 'utf8')

test('cierra sesión con POST a /api/auth/salir, nunca con GET', () => {
  // Un GET que cierra sesión es un CSRF de manual (cabecera de la ruta).
  assert.match(fuente, /fetch\('\/api\/auth\/salir', \{ method: 'POST'/)
})

// La cabecera del componente EXPLICA la secuencia y nombra las mismas llamadas,
// así que las posiciones se buscan con `lastIndexOf`: la última aparición es la
// del código, no la del comentario.

test('avisa al service worker ANTES de redirigir: borra las cachés del móvil compartido', () => {
  const posicionAviso = fuente.lastIndexOf('avisarCierreDeSesion()')
  const posicionRedireccion = fuente.lastIndexOf('window.location.replace')
  assert.ok(posicionAviso > -1, 'llama a avisarCierreDeSesion()')
  assert.ok(posicionRedireccion > -1, 'redirige a la salida')
  assert.ok(posicionAviso < posicionRedireccion, 'el aviso va antes de la redirección')
})

test('la redirección es navegación dura con replace, no con el router de Next', () => {
  // La recarga completa descarta el estado en memoria de la sesión anterior, y
  // `replace` impide que «atrás» vuelva a pintar el shell de quien ya se fue.
  assert.match(fuente, /window\.location\.replace\('\/entrar'\)/)
  assert.doesNotMatch(fuente, /useRouter/)
})

test('el fallo del POST no bloquea la salida: el aviso y la redirección van fuera del try', () => {
  // Si el token ya caducó, `fetch` puede fallar y la persona ya está fuera:
  // las cachés se borran y se redirige igual. El `catch` traga el error y el
  // código de después se ejecuta siempre.
  const posicionCatch = fuente.indexOf('} catch {')
  const posicionAviso = fuente.lastIndexOf('avisarCierreDeSesion()')
  assert.ok(posicionCatch > -1, 'el fetch va envuelto en try/catch')
  assert.ok(posicionAviso > posicionCatch, 'el aviso va después del catch, no dentro del try')
})

test('no importa la capa admin de push ni registra contenido de nadie', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
  assert.doesNotMatch(fuente, /console\./)
})
