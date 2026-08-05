import { expect, omitirSinAdmin, test } from '../fixtures'
import { FeedPage } from '../paginas/FeedPage'
import { PublicarPage } from '../paginas/PublicarPage'
import { TEXTO_CRISIS, TEXTO_CRISIS_ALTA, TEXTO_RIESGO_BAJO } from '../utils/textos'

// ============================================================================
// Recorrido (d) · texto con señales de crisis → recursos en la MISMA respuesta.
//
// CONTRATOS §9.1 no dice «mostrar recursos»: dice mostrarlos **al autor en la
// misma respuesta**. No en un correo diferido, no en la pantalla siguiente. La
// diferencia entre las dos cosas es la persona que cierra la app en cuanto
// termina de escribir, que es exactamente la persona a la que hay que llegar.
//
// Y §9.2: nunca ocultar ni borrar el contenido en silencio. Se prioriza, no se
// censura — quien escribió eso necesita seguir siendo escuchado.
// ============================================================================

test.describe('(d) Crisis: recursos en la misma respuesta', () => {
  omitirSinAdmin()

  // ── Camino de fallo nº 6 ────────────────────────────────────────────────
  test('la tarjeta aparece en menos de 2 s, sin navegar y sin recargar', async ({ page, usuario }) => {
    void usuario
    const publicar = new PublicarPage(page)
    await publicar.ir()

    // Si la app resolviera esto navegando a otra pantalla, este contador
    // dejaría de ser 0 y el contrato estaría roto aunque la tarjeta saliera.
    let navegaciones = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navegaciones += 1
    })

    await publicar.escribir(TEXTO_CRISIS)
    const inicio = Date.now()
    await publicar.enviar()

    await publicar.esperarTarjetaCrisis(2_000)
    const transcurrido = Date.now() - inicio

    expect(transcurrido).toBeLessThan(2_000)
    expect(navegaciones).toBe(0)

    // Al menos un número MARCABLE. Un teléfono como texto plano obliga a
    // copiarlo a mano justo cuando menos capacidad hay para hacerlo.
    expect(await publicar.telefonosDeCrisis.count()).toBeGreaterThan(0)

    // El botón de crisis flotante no desaparece por haber salido la tarjeta.
    expect(await publicar.botonCrisisVisible()).toBe(true)
  })

  // ── Camino de fallo nº 7 ────────────────────────────────────────────────
  test('el post de crisis SIGUE existiendo y visible para su autor', async ({ page, usuario }) => {
    void usuario
    const publicar = new PublicarPage(page)
    await publicar.ir()
    await publicar.escribir(TEXTO_CRISIS)
    await publicar.enviar()
    await publicar.esperarTarjetaCrisis()

    // Se prioriza, no se censura: la política `posts_read` está escrita para
    // que el autor siga viendo lo suyo pase lo que pase.
    const feed = new FeedPage(page)
    await feed.ir()
    expect(await feed.contieneTexto(TEXTO_CRISIS.slice(0, 40))).toBe(true)
  })

  test('el riesgo ALTO también enseña recursos, no solo el crítico', async ({ page, usuario }) => {
    void usuario
    const publicar = new PublicarPage(page)
    await publicar.ir()
    await publicar.escribir(TEXTO_CRISIS_ALTA)
    await publicar.enviar()

    // `requiresIntervention()` empieza en 'high'. Si la tarjeta solo saliera en
    // 'critical', la mitad de los casos que importan se quedarían sin ella.
    await publicar.esperarTarjetaCrisis(2_000)
  })

  test('un riesgo BAJO no dispara la tarjeta', async ({ page, usuario }) => {
    void usuario
    const publicar = new PublicarPage(page)
    await publicar.ir()
    await publicar.escribir(TEXTO_RIESGO_BAJO)
    await publicar.enviar()
    await expect(publicar.confirmacion).toBeVisible()

    // Escalar de más tiene un coste real: la tarjeta que sale siempre es la
    // tarjeta que nadie mira el día que hace falta.
    expect(await publicar.tarjetaCrisis.count()).toBe(0)
  })

  test('la respuesta de la API trae los recursos DENTRO, no en una segunda llamada', async ({
    page,
    usuario,
  }) => {
    void usuario
    await page.goto('/publicar')
    const respuesta = await page.request.post('/api/posts', {
      data: { body: TEXTO_CRISIS, kind: 'desahogo', topic: 'otro' },
    })

    expect(respuesta.status()).toBe(201)
    const cuerpo = (await respuesta.json()) as {
      ok: boolean
      data: { post: { id: string }; recursos: { lineas?: unknown[] } | null }
    }

    expect(cuerpo.ok).toBe(true)
    // El post existe: no se ha bloqueado ni descartado.
    expect(cuerpo.data.post.id).toBeTruthy()
    // Y los recursos van en el MISMO JSON.
    expect(cuerpo.data.recursos).not.toBeNull()
    expect((cuerpo.data.recursos?.lineas ?? []).length).toBeGreaterThan(0)
  })
})
