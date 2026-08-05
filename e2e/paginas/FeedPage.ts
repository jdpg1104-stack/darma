import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** `/feed` — «Para ti» y «Recientes», ambos con paginación keyset. */
export class FeedPage extends BasePage {
  readonly ruta = '/feed'

  get carriles(): Locator {
    return this.page.getByTestId('feed-carriles')
  }

  /** Todas las tarjetas de post del feed (solo posts: la encuesta va aparte). */
  get tarjetas(): Locator {
    return this.page.getByTestId('feed-tarjeta-post')
  }

  /** Enlaces «Abrir el hilo de {alias}»: la vía real de entrar a escuchar. */
  get enlacesAHilo(): Locator {
    return this.page.getByTestId('feed-abrir-hilo')
  }

  /** Abre el hilo del post cuyo cuerpo contiene este texto. */
  async abrirHiloConTexto(fragmento: string): Promise<void> {
    const tarjeta = this.tarjetas.filter({ hasText: fragmento }).first()
    await tarjeta.getByTestId('feed-abrir-hilo').click()
    await this.page.waitForURL(/\/post\//)
  }

  /** ¿Hay alguna tarjeta con este texto visible en el feed? */
  async contieneTexto(fragmento: string): Promise<boolean> {
    return (await this.tarjetas.filter({ hasText: fragmento }).count()) > 0
  }
}
