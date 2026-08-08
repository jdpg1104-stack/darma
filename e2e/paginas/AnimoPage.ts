import { expect, type Locator } from '@playwright/test'
import { obtenerTraductor } from '@/i18n/traductor'
import { BasePage } from './BasePage'

// El contexto se crea con `locale: 'es-ES'`: cuando un localizador afirma una
// frase (el aviso del tope diario), la frase sale del catálogo, no de un spec.
const t = obtenerTraductor('es')

/**
 * `/animo` — el feed vertical de vídeo (nivel 1: solo recibir, sin escribir).
 *
 * ⚠️ El medio NO es un `<video>`: la app incrusta `youtube-nocookie` en un
 * `<iframe>` (no hay ni un `<video>` en todo el repo). La consecuencia práctica
 * para esta suite es que no se puede leer `currentTime` ni `paused` desde el
 * documento —el iframe es de otro origen—, así que «se está reproduciendo» se
 * comprueba por lo observable en NUESTRO lado: la tarjeta activa
 * (`data-activo`), el progreso que publica la app y las llamadas de latido a
 * `/api/content/{id}/latido`, que son las que de verdad acreditan el karma.
 */
export class AnimoPage extends BasePage {
  readonly ruta = '/animo'

  /** Todas las tarjetas de vídeo montadas. */
  get tarjetas(): Locator {
    return this.page.getByTestId('video-tarjeta')
  }

  /** La tarjeta activa: la única con `data-activo`. */
  get tarjetaActiva(): Locator {
    return this.page.locator('[data-testid="video-tarjeta"][data-activo]')
  }

  /** El reproductor incrustado de la tarjeta activa. */
  get reproductorActivo(): Locator {
    return this.tarjetaActiva.locator('iframe')
  }

  /** Capa de toque de la tarjeta activa: reproducir o pausar. */
  get botonReproducir(): Locator {
    return this.tarjetaActiva.getByTestId('video-boton-reproducir')
  }

  get barraProgreso(): Locator {
    return this.tarjetaActiva.getByTestId('video-progreso')
  }

  /** La marca de completado que pinta la tarjeta cuando el karma se acredita. */
  get marcaCompletado(): Locator {
    return this.tarjetaActiva.getByTestId('video-completado')
  }

  /** El aviso del tope diario, en el pie del feed y con la frase del catálogo:
   *  aquí el TEXTO es parte de lo que se afirma (que se explica que el vídeo
   *  cuenta igual), así que el copy se queda como aserción de contenido. */
  get avisoTopeDiario(): Locator {
    return this.page
      .getByTestId('video-pie-estado')
      .filter({ hasText: t('contenido.topeDiario') })
  }

  get estadoVacio(): Locator {
    return this.page.getByTestId('video-vacio')
  }

  /**
   * El fragmento que encuadra la tarjeta activa, tal y como lo publica el DOM.
   *
   * No se lee del `src` del iframe a propósito: bajo el fusible del stub e2e el
   * reproductor va con `srcdoc` y NO tiene `src`, así que esa comprobación
   * pasaría en el camino real y quedaría muda justo donde corre la suite. Los
   * `data-clip-*` de la tarjeta son la misma verdad y están en los dos caminos;
   * que los parámetros `start`/`end` acaben en la URL lo cubre `embed.test.ts`.
   */
  async fragmentoActivo(): Promise<{ inicio: number | null; fin: number | null; util: number }> {
    const tarjeta = this.tarjetaActiva
    const leer = async (atributo: string): Promise<number | null> => {
      const valor = await tarjeta.getAttribute(atributo)
      return valor === null ? null : Number(valor)
    }
    return {
      inicio: await leer('data-clip-inicio'),
      fin: await leer('data-clip-fin'),
      util: (await leer('data-duracion-util')) ?? 0,
    }
  }

  /**
   * El HTML tal y como lo entrega el SERVIDOR, sin ejecutar JavaScript.
   *
   * `page.request` viaja con las cookies del contexto —la sesión inyectada—
   * pero no hidrata, así que esto es el PRIMER FOTOGRAMA: justo donde se mide
   * el LCP. `page.content()` no serviría para eso: cuando se lee, el iframe ya
   * ha sustituido a la miniatura de la tarjeta activa.
   */
  async htmlDelServidor(): Promise<string> {
    const respuesta = await this.page.request.get(this.ruta)
    return respuesta.text()
  }

  /**
   * Baja al siguiente item del feed vertical.
   *
   * No es `mouse.wheel`: en WebKit móvil no existe (Playwright lanza
   * «Mouse wheel is not supported in mobile WebKit») y este spec corre en los
   * DOS proyectos. Se desplaza la siguiente tarjeta a la vista — el mismo
   * efecto observable que el gesto: el snap asienta en ella, el observador de
   * visibilidad la ve por encima del umbral y el coordinador la elige activa.
   */
  async siguiente(): Promise<void> {
    await this.page.evaluate(() => {
      const activa = document.querySelector('[data-testid="video-tarjeta"][data-activo]')
      activa?.nextElementSibling?.scrollIntoView({ behavior: 'smooth' })
    })
  }

  /**
   * Lleva el feed hasta el contenido dado y espera a que sea la tarjeta ACTIVA.
   *
   * Los specs que completan un vídeo anclan la reproducción a SU contenido
   * sembrado, nunca a «la primera tarjeta»: el catálogo de `/animo` es
   * COMPARTIDO (el otro proyecto de esta misma suite, otro worker, otra
   * persona contra darma-dev) y la primera tarjeta puede ser una siembra ajena
   * — que su dueño borrará en su teardown A MITAD de la reproducción, matando
   * la sesión en cascada y dejando los latidos acreditando 0 para siempre.
   */
  async irAlContenido(contenidoId: string): Promise<void> {
    const nodo = this.page.locator(`[data-testid="video-tarjeta"][id="${contenidoId}"]`)
    await nodo.waitFor({ state: 'attached' })
    await nodo.evaluate((elemento) => elemento.scrollIntoView({ behavior: 'smooth' }))
    await this.page
      .locator(`[data-testid="video-tarjeta"][data-activo][id="${contenidoId}"]`)
      .waitFor({ state: 'attached' })
  }

  /**
   * Espera a que la tarjeta activa sea OTRA distinta de `previa`.
   *
   * Con reintento A PROPÓSITO: el wheel dispara un scroll con snap que tarda
   * unos cientos de ms en asentar, y `data-activo` no cambia en el instante
   * del gesto sino cuando el coordinador ve a la siguiente tarjeta por encima
   * del umbral de visibilidad. Una comparación inmediata del id lee el estado
   * de ANTES del scroll y falla siempre.
   */
  async esperarOtraActiva(previa: string | null): Promise<void> {
    await expect(this.tarjetaActiva).not.toHaveAttribute('id', previa ?? '')
  }

  /**
   * Asegura que la reproducción está en marcha.
   *
   * En Chromium con `--autoplay-policy=no-user-gesture-required` el vídeo
   * arranca solo en cuanto la tarjeta es la activa; un click a ciegas aquí lo
   * PAUSARÍA (el toque es un conmutador). Por eso primero se espera a que la
   * tarjeta declare `data-reproduciendo`; solo si no llega (WebKit, sin flag
   * de autoplay; o `prefers-reduced-motion`) se hace el click — que es
   * exactamente el gesto que haría una persona.
   */
  async arrancar(): Promise<void> {
    const yaSonando = this.page.locator(
      '[data-testid="video-tarjeta"][data-activo][data-reproduciendo]',
    )
    try {
      await yaSonando.waitFor({ state: 'attached', timeout: 8_000 })
      return
    } catch {
      await this.botonReproducir.click()
    }
  }

  /**
   * Espera la señal de que la app está acreditando la reproducción.
   *
   * Vale tanto la apertura de sesión como un latido: la sesión se abre UNA vez
   * (en el primer latido) y puede haber ocurrido antes de registrar esta
   * espera; los latidos se repiten cada 5 s mientras reproduce, así que
   * siempre hay uno que cazar.
   */
  async esperarSesionAbierta(): Promise<void> {
    await this.page.waitForResponse(
      (r) =>
        /\/api\/content\/[^/]+\/(sesion|latido)/.test(r.url()) &&
        r.request().method() === 'POST',
      { timeout: 15_000 },
    )
  }

  /** Espera a que la app confirme la acreditación del contenido completado. */
  async esperarCompletado(timeoutMs = 30_000): Promise<{ acreditado: boolean; karma: number }> {
    const res = await this.page.waitForResponse(
      (r) => /\/api\/content\/[^/]+\/completado/.test(r.url()) && r.request().method() === 'POST',
      { timeout: timeoutMs },
    )
    const cuerpo = (await res.json()) as {
      data?: { acreditado?: boolean; karma?: number }
    }
    return {
      acreditado: cuerpo.data?.acreditado ?? false,
      karma: cuerpo.data?.karma ?? 0,
    }
  }
}
