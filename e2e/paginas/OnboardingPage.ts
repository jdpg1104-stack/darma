import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * `/onboarding` — tres pasos: alias, nivel de entrada y confirmación.
 *
 * Es la pantalla donde se cumple o se rompe la promesa del producto: al salir
 * de aquí la persona tiene una identidad completa y en ningún momento se ha
 * pedido —ni se ha enseñado— nada que la identifique.
 */
export class OnboardingPage extends BasePage {
  readonly ruta = '/onboarding'

  get barraProgreso(): Locator {
    return this.page.getByRole('progressbar', { name: 'Progreso del onboarding' })
  }

  // ── Paso 1 · alias ────────────────────────────────────────────────────────
  get campoAlias(): Locator {
    return this.page.getByLabel('Tu alias')
  }

  /** «Otro»: pide al servidor otro seudónimo generado. */
  get botonOtroAlias(): Locator {
    return this.page.getByRole('button', { name: 'Otro', exact: true })
  }

  get botonContinuar(): Locator {
    return this.page.getByRole('button', { name: 'Continuar' })
  }

  // ── Paso 3 · confirmación ─────────────────────────────────────────────────
  get botonEntrar(): Locator {
    return this.page.getByRole('button', { name: 'Entrar en Darma' })
  }

  /**
   * El avatar generado. Debe ser SVG INLINE: una `<img src="…">` remota sería
   * una petición saliente por persona, y eso es un rastreador con otro nombre
   * (ARCHITECTURE §2, «cero terceros en el navegador»).
   */
  get avatar(): Locator {
    return this.page.getByRole('img', { name: 'Avatar generado' })
  }

  /** Alias que el servidor propuso, tal y como está en el campo. */
  async aliasPropuesto(): Promise<string> {
    return this.campoAlias.inputValue()
  }

  /** ¿El avatar es un `<svg>` inline y no un `<img>`? */
  async avatarEsSvgInline(): Promise<boolean> {
    const etiqueta = await this.avatar.evaluate((el) => el.tagName.toLowerCase())
    return etiqueta === 'svg'
  }

  /** Recorre los tres pasos aceptando lo que propone el servidor. */
  async completar(): Promise<string> {
    const alias = await this.aliasPropuesto()
    await this.botonContinuar.click()
    // Paso 2: se acepta el nivel de entrada por defecto ('escucha').
    await this.botonContinuar.click()
    await this.botonEntrar.click()
    await this.page.waitForURL(/\/feed/)
    return alias
  }
}
