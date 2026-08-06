import { KARMA_WEIGHTS } from '@/lib/karma'
import { expect, omitirSinAdmin, test } from '../fixtures'
import { AnimoPage } from '../paginas/AnimoPage'

// ============================================================================
// Recorrido (f) · feed vertical de vídeo: reproducir, completar, +1 de karma.
//
// ⚠️ El medio NO es un `<video>`: la app incrusta youtube-nocookie en un
// `<iframe>` (no hay ni un `<video>` en todo el repo). El karma no lo decide el
// reproductor sino el SERVIDOR: `completar_contenido()` solo marca completado
// si el tiempo acumulado en Postgres llega al 90 % de `duration_seconds`, y es
// el trigger `content_views_sync()` quien llama a `award_karma()`. Por eso este
// recorrido se afirma contra las respuestas de `/api/content/*` y contra el
// ledger, no contra el estado interno del reproductor — que además vive en otro
// origen y no se puede leer.
// ============================================================================

// Secuencial dentro del archivo, A PROPÓSITO (y `default`, no `serial`: un
// fallo no arrastra a los demás). Estos cuatro tests siembran contenido en un
// catálogo COMPARTIDO por los workers: con dos en paralelo, la tarjeta activa
// de un test puede ser la siembra del otro, y cuando ese otro termina su
// teardown la borra A MITAD de reproducción — la sesión muere en cascada, los
// latidos pasan a acreditar 0 y `/completado` no llega nunca. Los usuarios se
// aíslan por test; el catálogo de `/animo` no se puede aislar por usuario.
test.describe.configure({ mode: 'default' })

test.describe('(f) Feed vertical de vídeo', () => {
  omitirSinAdmin()

  test('reproducir un vídeo entero acredita exactamente +1 de karma', async ({
    page,
    usuario,
    sembrarVideo,
    karmaDe,
  }) => {
    // Duración corta a propósito: el presupuesto de la suite son 6 minutos y el
    // servidor exige el 90 % del tiempo real.
    const contenidoId = await sembrarVideo(10)
    const antes = await karmaDe(usuario)

    const animo = new AnimoPage(page)
    await animo.ir()

    await expect(animo.tarjetaActiva).toBeVisible()
    // Reproducir EL VÍDEO SEMBRADO, no «el primero»: la primera tarjeta puede
    // ser la siembra de otro worker u otro proyecto (ver irAlContenido).
    await animo.irAlContenido(contenidoId)
    await expect(animo.reproductorActivo).toBeVisible()

    await animo.arrancar()
    await animo.esperarSesionAbierta()

    const resultado = await animo.esperarCompletado()
    expect(resultado.acreditado).toBe(true)
    expect(resultado.karma).toBe(KARMA_WEIGHTS.content_completed.reputation)

    await expect(animo.marcaCompletado).toBeVisible()
    expect(await karmaDe(usuario)).toBe(antes + KARMA_WEIGHTS.content_completed.reputation)
  })

  // ── Camino de fallo nº 10 ───────────────────────────────────────────────
  test('completar el MISMO contenido dos veces suma karma UNA sola vez', async ({
    page,
    usuario,
    sembrarVideo,
    karmaDe,
  }) => {
    const contenidoId = await sembrarVideo(10)

    const animo = new AnimoPage(page)
    await animo.ir()
    await animo.irAlContenido(contenidoId)
    await animo.arrancar()
    await animo.esperarSesionAbierta()
    await animo.esperarCompletado()

    const trasLaPrimera = await karmaDe(usuario)

    // Segundo intento por la API, con una sesión nueva del mismo contenido.
    const sesion = await page.request.post(`/api/content/${contenidoId}/sesion`)
    const { data } = (await sesion.json()) as { data: { sesionId: string } }
    const segunda = await page.request.post(`/api/content/${contenidoId}/completado`, {
      data: { sesionId: data.sesionId },
    })

    const cuerpo = (await segunda.json()) as {
      ok: boolean
      data: { acreditado: boolean; karma: number; motivo?: string }
    }

    // Lo impide la PK de `content_views (content_id, user_id)`. Y responde 200,
    // no 4xx, a propósito: un error sería un oráculo para quien farmea.
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.data.acreditado).toBe(false)
    expect(cuerpo.data.karma).toBe(0)
    expect(await karmaDe(usuario)).toBe(trasLaPrimera)
  })

  test('el scroll pasa al siguiente item del feed vertical', async ({
    page,
    usuario,
    sembrarVideo,
  }) => {
    // `usuario` inyecta la sesión aunque el test no lo lea: sin él, /animo
    // redirige a /entrar y no hay ni una tarjeta (mismo hueco que el spec 08).
    void usuario
    await sembrarVideo(10)
    await sembrarVideo(10)

    const animo = new AnimoPage(page)
    await animo.ir()
    await expect(animo.tarjetaActiva).toHaveCount(1)

    const primera = await animo.tarjetaActiva.getAttribute('id')
    await animo.siguiente()

    // Sigue habiendo exactamente UNA tarjeta activa: si hubiera dos, dos vídeos
    // sonarían a la vez, que en una app que se usa de noche en el móvil es un
    // fallo grave y no un detalle.
    await expect(animo.tarjetaActiva).toHaveCount(1)
    await animo.esperarOtraActiva(primera)
  })

  test('la miniatura de la PRIMERA tarjeta se precarga; las demás, en diferido', async ({
    page,
    usuario,
    sembrarVideo,
  }) => {
    void usuario
    await sembrarVideo(10)
    await sembrarVideo(10)

    // El HTML del servidor, sin hidratar: ahí la primera tarjeta todavía es su
    // miniatura (el iframe se monta en cliente), y esa imagen ES el LCP de
    // /animo — la métrica que CONTRATOS §11 acota en 2,5 s sobre 4G.
    const animo = new AnimoPage(page)
    const html = (await animo.htmlDelServidor()).toLowerCase()

    // Exactamente UNA imagen prioritaria. Si fueran varias, no habría
    // prioridad: compiten entre ellas por el ancho de banda inicial, que es
    // justo lo que la ventana de iframes evita por el otro lado.
    // `data-nimg="fill"` y no la clase del módulo CSS: el nombre de la clase se
    // ofusca en el build de producción (que es el que corre en CI) y el test
    // se caería allí y solo allí. Ese atributo lo pone next/image en los dos.
    const miniaturas = html.match(/<img[^>]*data-nimg="fill"[^>]*>/g) ?? []
    expect(miniaturas.length).toBeGreaterThan(1)

    // La primera, sin diferir. Las DEMÁS, diferidas: sin esta segunda mitad,
    // marcar todas como prioritarias pasaría la prueba de una forma que nadie
    // querría — con diez imágenes «prioritarias» no hay ninguna prioritaria.
    expect(miniaturas[0]).not.toContain('loading="lazy"')
    for (const resto of miniaturas.slice(1)) {
      expect(resto).toContain('loading="lazy"')
    }

    // Y exactamente UNA precarga de imagen en la cabecera: es lo que adelanta
    // la petición del LCP sin esperar a que el navegador descubra el `<img>`.
    const precargas = html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? []
    expect(precargas).toHaveLength(1)
  })

  // ── Camino de fallo nº 11 ───────────────────────────────────────────────
  test('con prefers-reduced-motion el feed sigue siendo navegable', async ({
    page,
    usuario,
    sembrarVideo,
  }) => {
    void usuario
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await sembrarVideo(10)
    await sembrarVideo(10)

    const animo = new AnimoPage(page)
    await animo.ir()

    await expect(animo.tarjetaActiva).toBeVisible()
    await animo.siguiente()
    await expect(animo.tarjetaActiva).toHaveCount(1)

    // Y el autoplay no rompe: la reproducción sigue pudiendo arrancarse a mano.
    await animo.arrancar()
    await animo.esperarSesionAbierta()
  })
})
