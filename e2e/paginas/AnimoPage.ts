import type { Locator } from '@playwright/test'
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

  /** Baja al siguiente item del feed vertical. */
  async siguiente(): Promise<void> {
    await this.page.mouse.wheel(0, 900)
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
