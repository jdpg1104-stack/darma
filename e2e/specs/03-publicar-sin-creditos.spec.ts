import { reciprocityMessage } from '@/lib/reciprocity'
import { expect, omitirSinAdmin, test } from '../fixtures'
import { PublicarPage } from '../paginas/PublicarPage'
import { TEXTO_QUE_NO_SE_DEBE_PERDER } from '../utils/textos'

// ============================================================================
// Recorrido (c) · publicar SIN escuchas.
//
// Dos capas, y la segunda es la que importa: la UI es cosmética. El gate real
// es `trg_posts_reciprocity`, un BEFORE INSERT que comprueba y descuenta en la
// MISMA sentencia. Si solo se probara el botón deshabilitado, la prueba pasaría
// igual el día que alguien borrara el trigger.
// ============================================================================

test.describe('(c) Publicar sin escuchas', () => {
  omitirSinAdmin()

  test('la UI bloquea el botón y explica cuánto falta con el copy de lib/', async ({
    page,
    usuario,
    agotarEscuchas,
  }) => {
    // ⚠️ El primer post es gratis: con un usuario recién creado la publicación
    // FUNCIONARÍA y este test fallaría sin motivo aparente.
    await agotarEscuchas(usuario)

    const publicar = new PublicarPage(page)
    await publicar.ir()

    await expect(
      page.getByText(reciprocityMessage({ listenCredits: 0, postsPublished: 1 })),
    ).toBeVisible()

    await publicar.escribir(TEXTO_QUE_NO_SE_DEBE_PERDER)
    expect(await publicar.botonHabilitado()).toBe(false)
  })

  // ── El assert importante: la API, saltándose la UI ──────────────────────
  // ── Camino de fallo nº 4 ────────────────────────────────────────────────
  test('POST /api/posts sin escuchas → 403 code «reciprocidad» sin filtrar detalle interno', async ({
    page,
    usuario,
    agotarEscuchas,
  }) => {
    await agotarEscuchas(usuario)

    // Se llama con la cookie de sesión del contexto, no con fetch de Node: así
    // se recorre el proxy, el handler y el trigger, que es el camino real.
    await page.goto('/feed')
    const respuesta = await page.request.post('/api/posts', {
      data: {
        body: TEXTO_QUE_NO_SE_DEBE_PERDER,
        kind: 'desahogo',
        topic: 'otro',
      },
    })

    expect(respuesta.status()).toBe(403)
    const cuerpo = (await respuesta.json()) as {
      ok: boolean
      code: string
      message: string
    }
    expect(cuerpo.ok).toBe(false)
    expect(cuerpo.code).toBe('reciprocidad')

    // CONTRATOS §4: el `message` es para humanos y NUNCA lleva stack, SQL,
    // nombre de tabla ni detalle del proveedor. Quien está mal no tiene por qué
    // leer «check_violation», y quien ataca no tiene por qué aprender el
    // esquema.
    expect(cuerpo.message).not.toMatch(/trigger|postgres|check_violation|profiles|relation/i)
    expect(cuerpo.message.length).toBeGreaterThan(0)
  })

  // ── Camino de fallo nº 5 ────────────────────────────────────────────────
  test('el texto escrito sigue en el textarea tras el rechazo del servidor', async ({
    page,
    usuario,
    agotarEscuchas,
  }) => {
    await agotarEscuchas(usuario)

    const publicar = new PublicarPage(page)
    await publicar.ir()
    await publicar.escribir(TEXTO_QUE_NO_SE_DEBE_PERDER)

    // Se fuerza el envío aunque la UI lo deshabilite: lo que se prueba es qué
    // hace la app cuando el SERVIDOR rechaza, no cuando la UI se adelanta.
    await page.evaluate(() => {
      const form = document.querySelector('form')
      form?.requestSubmit()
    })

    await expect(publicar.errorServidor).toBeVisible()

    // Perder el texto de alguien que acaba de desahogarse es peor que el propio
    // rechazo: ha escrito lo que no le cuenta a nadie y la app se lo ha comido.
    expect(await publicar.textoEnElArea()).toBe(TEXTO_QUE_NO_SE_DEBE_PERDER)
  })

  test('con el primer post gratis SÍ se puede publicar (control positivo)', async ({
    page,
    usuario,
  }) => {
    // Sin este control, los tres de arriba pasarían igual si publicar estuviera
    // roto del todo: todo saldría «bloqueado» por el motivo equivocado.
    expect(usuario.id).toBeTruthy()

    const publicar = new PublicarPage(page)
    await publicar.ir()
    await publicar.escribir(TEXTO_QUE_NO_SE_DEBE_PERDER)
    expect(await publicar.botonHabilitado()).toBe(true)
    await publicar.enviar()
    await expect(publicar.confirmacion).toBeVisible()
  })
})
