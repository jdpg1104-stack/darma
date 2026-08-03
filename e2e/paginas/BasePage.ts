import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Base de todos los Page Objects.
 *
 * Regla del bloque: NINGÚN spec contiene un selector. Todo vive aquí abajo, de
 * modo que un cambio de copy o de marcado se arregla en un archivo y no en seis.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Ruta relativa de la pantalla. */
  abstract readonly ruta: string

  async ir(): Promise<void> {
    await this.page.goto(this.ruta)
    await this.esperarQuieta()
  }

  /**
   * Espera a que la red se calme. Se usa DESPUÉS de navegar, nunca en lugar de
   * una aserción: el estado observable manda, esto solo evita carreras con el
   * streaming de React.
   */
  async esperarQuieta(): Promise<void> {
    await this.page.waitForLoadState('networkidle')
  }

  /**
   * El botón de crisis. Es un ENLACE a /ayuda, no un botón: funciona sin JS a
   * propósito, porque quien lo necesita puede estar en una red pésima.
   */
  get botonCrisis(): Locator {
    return this.page.getByRole('link', { name: 'Necesito ayuda ahora' })
  }

  /** El BotonCrisis debe estar en TODA pantalla de app/(app) (CONTRATOS §9). */
  async botonCrisisVisible(): Promise<boolean> {
    return this.botonCrisis.first().isVisible()
  }

  /**
   * La tarjeta de recursos de ayuda que se muestra al autor de un texto de
   * riesgo. Hoy hay CUATRO marcados distintos en la app (composer, hilo,
   * refugio, pie del feed) y ninguno lleva `data-testid`; el del composer es el
   * único con ancla estable (`#recursos-titulo`), así que el localizador es una
   * unión de los tres marcados accionables. Pedido a B03/B04/B10 y B16 en
   * PEDIDOS.md para unificarlo en un solo `data-testid="tarjeta-recursos"`.
   */
  get tarjetaCrisis(): Locator {
    return this.page.locator(
      [
        '[data-testid="tarjeta-recursos"]',
        'section[aria-labelledby="recursos-titulo"]',
        '[role="note"][aria-label="Recursos de ayuda"]',
      ].join(', '),
    )
  }

  /**
   * Espera la tarjeta de recursos SIN recargar y sin navegar.
   *
   * El plazo por defecto son 2 s y no es arbitrario: CONTRATOS §9.1 exige que
   * la tarjeta salga «en la misma respuesta», no en la pantalla siguiente ni en
   * un correo diferido. Si tarda más, el contrato está roto aunque acabe
   * apareciendo.
   */
  async esperarTarjetaCrisis(timeoutMs = 2_000): Promise<void> {
    await expect(this.tarjetaCrisis.first()).toBeVisible({ timeout: timeoutMs })
  }

  /** Al menos un número marcable dentro de la tarjeta de recursos. */
  get telefonosDeCrisis(): Locator {
    return this.tarjetaCrisis.locator('a[href^="tel:"]')
  }

  /** Texto visible completo de la pantalla. Para las aserciones de anonimato. */
  async textoVisible(): Promise<string> {
    return this.page.locator('body').innerText()
  }

  /** HTML completo. Para comprobar que algo NO está ni siquiera oculto. */
  async htmlCompleto(): Promise<string> {
    return this.page.content()
  }
}
