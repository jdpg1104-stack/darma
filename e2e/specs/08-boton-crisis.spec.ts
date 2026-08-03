import { expect, omitirSinAdmin, test } from '../fixtures'
import { AnimoPage } from '../paginas/AnimoPage'
import { FeedPage } from '../paginas/FeedPage'
import { HiloPage } from '../paginas/HiloPage'
import { PerfilPage } from '../paginas/PerfilPage'
import { PublicarPage } from '../paginas/PublicarPage'

// ============================================================================
// Prueba nº 12 · el BotonCrisis está en TODAS las pantallas de app/(app).
//
// CONTRATOS §9: «el botón de crisis está siempre visible». No es una
// recomendación de diseño — quien lo necesita puede estar en cualquier pantalla
// de la app, no solo en la que alguien pensó al escribirlo. Y como HOY no
// existe `app/(app)/layout.tsx`, cada ruta lo monta por su cuenta: exactamente
// la clase de invariante que se rompe en silencio al añadir una pantalla nueva.
// ============================================================================

test.describe('El botón de crisis está en toda pantalla de app/(app)', () => {
  omitirSinAdmin()

  const rutas = ['/feed', '/publicar', '/perfil', '/animo', '/ranking', '/refugios']

  for (const ruta of rutas) {
    test(`${ruta} muestra el botón de crisis`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')

      const boton = page.getByRole('link', { name: 'Necesito ayuda ahora' })
      await expect(boton.first()).toBeVisible()
    })
  }

  test('/post/[id] muestra el botón de crisis', async ({ page, sembrarPosts }) => {
    const [postId] = await sembrarPosts(1)
    const hilo = new HiloPage(page)
    await hilo.irAPost(postId!)
    expect(await hilo.botonCrisisVisible()).toBe(true)
  })

  test('los Page Objects coinciden con lo que ve la persona', async ({
    page,
    sembrarPosts,
  }) => {
    // La misma comprobación a través de los Page Objects: si el localizador de
    // BasePage se desincroniza del componente, se entera esta prueba y no seis
    // recorridos con un fallo confuso.
    const feed = new FeedPage(page)
    await feed.ir()
    expect(await feed.botonCrisisVisible()).toBe(true)

    const publicar = new PublicarPage(page)
    await publicar.ir()
    expect(await publicar.botonCrisisVisible()).toBe(true)

    const perfil = new PerfilPage(page)
    await perfil.ir()
    expect(await perfil.botonCrisisVisible()).toBe(true)

    const animo = new AnimoPage(page)
    await animo.ir()
    expect(await animo.botonCrisisVisible()).toBe(true)

    const [postId] = await sembrarPosts(1)
    const hilo = new HiloPage(page)
    await hilo.irAPost(postId!)
    expect(await hilo.botonCrisisVisible()).toBe(true)
  })
})
