import { expect, omitirSinAdmin, test } from '../fixtures'
import { EntrarPage } from '../paginas/EntrarPage'
import { OnboardingPage } from '../paginas/OnboardingPage'

// ============================================================================
// Recorrido (a) · registro anónimo → onboarding → alias generado.
//
// Lo que se prueba aquí no es que el alta «funcione»: es que al terminar el
// recorrido NO haya en ninguna parte de la pantalla nada que identifique a la
// persona. El anonimato de Darma no se garantiza no enseñando el correo; se
// garantiza no teniéndolo donde la aplicación puede leerlo (ARCHITECTURE §2), y
// esta prueba vigila el lado visible de esa promesa.
// ============================================================================

test.describe('(a) Registro anónimo y onboarding', () => {
  // `POST /api/auth/anonimo` llama a createAdminClient() en su PRIMERA línea
  // (para el rate limit por IP) y hoy devuelve 500 error_interno. No es un
  // fallo del recorrido: es la clave que falta.
  omitirSinAdmin()

  test('entra sin datos, elige alias y sale con identidad completa', async ({ page }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()

    await expect(entrar.titulo).toBeVisible()
    await expect(entrar.botonAnonimo).toBeEnabled()

    await entrar.registrarseAnonimo()

    const onboarding = new OnboardingPage(page)
    await expect(onboarding.barraProgreso).toBeVisible()

    // El servidor propone el alias: la persona no tiene que inventarse nada.
    const alias = await onboarding.aliasPropuesto()
    expect(alias.length).toBeGreaterThanOrEqual(3)
    expect(alias.length).toBeLessThanOrEqual(24)

    // El avatar es SVG INLINE, no una <img> con src remoto: cada petición
    // saliente sería alguien que podría saber que esta persona estuvo aquí.
    await expect(onboarding.avatar).toBeVisible()
    expect(await onboarding.avatarEsSvgInline()).toBe(true)

    const aliasFinal = await onboarding.completar()
    expect(aliasFinal).toBe(alias)
    await expect(page).toHaveURL(/\/feed/)
  })

  test('«Otro» propone un alias distinto sin pedir nada a la persona', async ({ page }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()
    await entrar.registrarseAnonimo()

    const onboarding = new OnboardingPage(page)
    const primero = await onboarding.aliasPropuesto()
    await onboarding.botonOtroAlias.click()
    await expect(onboarding.campoAlias).not.toHaveValue(primero)
  })

  // ── Camino de fallo nº 1 ────────────────────────────────────────────────
  test('el registro no deja el correo, ni «@», ni el uuid visibles en el DOM', async ({
    page,
  }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()

    // El userId se captura de la respuesta de la API, no del DOM: si estuviera
    // en el DOM, eso mismo sería el fallo.
    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/auth/anonimo') && r.request().method() === 'POST',
    )
    // Click directo (no `registrarseAnonimo()`) para capturar la respuesta,
    // así que la casilla de edad hay que marcarla aquí a mano.
    await entrar.casillaEdad.check()
    await entrar.botonAnonimo.click()
    const cuerpo = (await (await respuesta).json()) as { data?: { userId?: string } }
    const userId = cuerpo.data?.userId
    expect(userId).toBeTruthy()

    await page.waitForURL(/\/onboarding/)
    const onboarding = new OnboardingPage(page)
    await onboarding.completar()

    // Se mira el HTML ENTERO, no solo el texto visible: un uuid escondido en un
    // atributo o en el payload de hidratación también es una fuga.
    const html = await onboarding.htmlCompleto()
    expect(html).not.toContain(userId!)

    const visible = await onboarding.textoVisible()
    expect(visible).not.toContain('@')
    expect(visible).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
  })
})

// ── Camino de fallo nº 0: la casilla de edad, sin marcar ────────────────────
// FUERA del describe con `omitirSinAdmin()` a propósito: la guarda es del
// cliente (pulsar sin marcar ni siquiera lanza la petición), así que esta
// prueba se ejecuta y pasa también sin SUPABASE_SERVICE_ROLE_KEY.
test.describe('(a) Casilla de edad mínima', () => {
  test('pulsar sin marcarla no navega y pinta el porqué', async ({ page }) => {
    const entrar = new EntrarPage(page)
    await entrar.ir()

    await expect(entrar.casillaEdad).not.toBeChecked()
    await entrar.botonAnonimo.click()

    // El botón no se deshabilita: responde con el porqué, con el copy del
    // catálogo (auth.entrada.errorEdadMinima)…
    await expect(entrar.errorEdadMinima).toBeVisible()
    // …y la persona sigue en /entrar: no hubo POST ni navegación.
    await expect(page).toHaveURL(/\/entrar/)
  })
})
