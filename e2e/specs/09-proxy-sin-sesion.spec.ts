import { expect, test } from '../fixtures'
import { EntrarPage } from '../paginas/EntrarPage'

// ============================================================================
// La frontera pública, sin sesión.
//
// No es uno de los seis recorridos de la ficha, pero es la única parte del
// camino real que se puede verificar de extremo a extremo SIN service_role, y
// cubre dos invariantes que sí están en los contratos:
//
//   · CONTRATOS §6 / proxy.ts: lo que no es público exige sesión, y las rutas
//     de API devuelven 401 en JSON — nunca un redirect a HTML, que haría
//     reventar `res.json()` en el cliente.
//   · CONTRATOS §2: la pantalla de acceso no filtra nada de nadie.
//
// Estas pruebas no llevan `fixme`: se ejecutan y pasan hoy.
// ============================================================================

test.describe('Frontera pública sin sesión', () => {
  test('la pantalla de acceso se sirve y ofrece entrar sin datos', async ({ page }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()

    await expect(entrar.titulo).toBeVisible()
    await expect(entrar.botonAnonimo).toBeVisible()

    // La promesa está escrita en la propia pantalla; si alguien la cambia por
    // un formulario de registro, esto se entera.
    await expect(page.getByText(/No pedimos nombre, ni correo, ni teléfono/)).toBeVisible()
  })

  test('una ruta privada redirige a /entrar conservando el destino', async ({ page }) => {
    await page.goto('/feed')
    await expect(page).toHaveURL(/\/entrar\?siguiente=%2Ffeed/)
  })

  test('las rutas privadas de API devuelven 401 en JSON, no HTML', async ({ request }) => {
    const respuesta = await request.get('/api/me')
    expect(respuesta.status()).toBe(401)

    // Un redirect a HTML aquí es el bug clásico: el cliente hace res.json() y
    // revienta con un error que no dice nada del problema real.
    expect(respuesta.headers()['content-type']).toContain('application/json')
    const cuerpo = (await respuesta.json()) as { ok?: boolean; code?: string }
    expect(cuerpo.ok).toBe(false)
    expect(cuerpo.code).toBe('no_autenticado')
  })

  test('publicar sin sesión no llega ni al gate de reciprocidad', async ({ request }) => {
    const respuesta = await request.post('/api/posts', {
      data: { body: 'x'.repeat(50), kind: 'desahogo', topic: 'otro' },
    })
    expect(respuesta.status()).toBe(401)
  })

  test('/ayuda es alcanzable SIN sesión y existe de verdad', async ({ page }) => {
    // `/ayuda` es el destino del BotonCrisis y está declarada pública en
    // proxy.ts por una razón que no es técnica: una persona en riesgo no puede
    // toparse con un muro de login. Se prueba sin sesión a propósito.
    //
    // Estuvo en `test.fixme` porque la página NO EXISTÍA (el hallazgo más
    // grave de B18: el botón de crisis de toda la app llevaba a un 404). Hoy
    // `app/ayuda/page.tsx` existe; si esta prueba vuelve a rojo, ese 404 ha
    // vuelto y es bloqueante de despliegue, no deuda.
    const respuesta = await page.goto('/ayuda')
    expect(
      respuesta?.status(),
      'El destino del botón de crisis (/ayuda) no existe',
    ).toBeLessThan(400)
  })

  test('la pantalla de acceso no filtra ningún dato de nadie', async ({ page }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()

    const html = await entrar.htmlCompleto()
    // Ni un uuid, ni un correo real, ni rastro de la service_role key.
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(html).not.toContain('service_role')
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
