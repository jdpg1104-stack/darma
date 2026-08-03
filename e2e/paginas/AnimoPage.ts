import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

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
    return this.page.locator('article')
  }

  /** La tarjeta activa: la única con `data-activo`. */
  get tarjetaActiva(): Locator {
    return this.page.locator('article[data-activo]')
  }

  /** El reproductor incrustado de la tarjeta activa. */
  get reproductorActivo(): Locator {
    return this.tarjetaActiva.locator('iframe')
  }

  /** Capa de toque de la tarjeta activa: reproducir o pausar. */
  get botonReproducir(): Locator {
    return this.tarjetaActiva.getByRole('button', { name: /^Reproducir o pausar: / })
  }

  get barraProgreso(): Locator {
    return this.tarjetaActiva.getByRole('progressbar', { name: 'Progreso del vídeo' })
  }

  /** La marca de completado que pinta la tarjeta cuando el karma se acredita. */
  get marcaCompletado(): Locator {
    return this.tarjetaActiva.getByText('Completado')
  }

  get avisoTopeDiario(): Locator {
    return this.page.getByText('Hoy ya has llegado al máximo de karma. El vídeo cuenta igual.')
  }

  get estadoVacio(): Locator {
    return this.page.getByRole('heading', { name: 'Todavía no hay vídeos para ti' })
  }

  /** Baja al siguiente item del feed vertical. */
  async siguiente(): Promise<void> {
    await this.page.mouse.wheel(0, 900)
  }

  /**
   * Arranca la reproducción con un click real.
   *
   * En Chromium basta con `--autoplay-policy=no-user-gesture-required`, pero en
   * WebKit no hay flag equivalente: hace falta el gesto. Se hace en los dos
   * proyectos para que el recorrido sea el mismo — y porque un click es lo que
   * hace una persona.
   */
  async arrancar(): Promise<void> {
    await this.botonReproducir.click()
  }

  /** Espera a que la app registre la sesión de reproducción del item activo. */
  async esperarSesionAbierta(): Promise<void> {
    await this.page.waitForResponse(
      (r) => /\/api\/content\/[^/]+\/sesion/.test(r.url()) && r.request().method() === 'POST',
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
