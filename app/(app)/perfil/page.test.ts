// ============================================================================
// /perfil — pruebas del montaje de la capa PWA (B13) en el perfil propio.
//
// Fuente, no runtime (mismo enfoque que app/(app)/layout.test.ts): quitar
// `BotonInstalar` o `BotonSalir` de esta página no rompe ningún tipo ni ningún
// test de integración — simplemente la app deja de poderse instalar desde
// ningún sitio, o la sesión deja de poderse cerrar y las cachés del service
// worker sobreviven al cambio de persona en un móvil compartido.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const carpeta = dirname(fileURLToPath(import.meta.url))
const fuente = readFileSync(join(carpeta, 'page.tsx'), 'utf8')

test('monta BotonInstalar: la instalación pertenece al perfil, no a un flotante global', () => {
  assert.match(fuente, /<BotonInstalar \/>/)
})

test('monta BotonSalir: sin él no hay forma de cerrar sesión ni de vaciar las cachés del SW', () => {
  assert.match(fuente, /<BotonSalir \/>/)
})

test('NO monta OptInPush: cargar el perfil no es un momento oportuno', () => {
  // La cabecera de components/pwa/OptInPush.tsx lo prohíbe fuera del momento en
  // que la notificación acaba de tener sentido: pedir permiso al abrir una
  // pantalla quema el origen de forma permanente si se deniega.
  assert.doesNotMatch(fuente, /<OptInPush\b/)
})

test('no importa la capa admin de push: eso jamás puede acabar en un bundle de navegador', () => {
  assert.doesNotMatch(fuente, /lib\/push\/(despacho|enviar)/)
})

// ── Sin onboarding: redirección, no 500 ─────────────────────────────────────
// Una cuenta anónima recién creada (`perfilCompleto: false`) que entraba en
// /perfil o /perfil/editar recibía un HTTP 500: `requirePerfil()` lanza
// `ErrorApi('sin_permiso')`, correcto en una ruta de API pero fatal en una
// página, donde nadie lo convierte en respuesta. El idioma correcto para
// páginas es el de /publicar: `requireSesion()` + `redirect('/onboarding')`.
// Estas pruebas leen la fuente de las tres páginas de perfil y fijan ese
// idioma; `exigirPerfil()` con `perfilCompleto: false` ya está cubierto en
// lib/auth/session.test.ts.

const paginasDePerfil = [
  ['page.tsx', fuente],
  ['editar/page.tsx', readFileSync(join(carpeta, 'editar', 'page.tsx'), 'utf8')],
  ['[id]/page.tsx', readFileSync(join(carpeta, '[id]', 'page.tsx'), 'utf8')],
] as const

for (const [ruta, codigo] of paginasDePerfil) {
  test(`${ruta} redirige al onboarding con perfilCompleto: false, no revienta`, () => {
    assert.match(codigo, /if \(!sesion\.perfilCompleto\) redirect\('\/onboarding'\)/)
  })

  test(`${ruta} no importa requirePerfil: su 'sin_permiso' en una página es un 500`, () => {
    // Se busca el import y no el nombre a secas: los comentarios de las páginas
    // mencionan `requirePerfil()` en prosa precisamente para explicar por qué
    // NO se usa. Sin import no hay llamada que compile.
    assert.doesNotMatch(codigo, /import \{[^}]*\brequirePerfil\b[^}]*\}/)
  })
}

test('la Server Action de editar SÍ conserva requirePerfil: una action no debe redirigir en silencio', () => {
  const acciones = readFileSync(join(carpeta, 'editar', 'acciones.ts'), 'utf8')
  assert.match(acciones, /requirePerfil\(\)/)
})
