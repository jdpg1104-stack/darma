import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * `/onboarding` — cuatro pasos: alias, nivel de entrada, edad declarada y
 * confirmación.
 *
 * Es la pantalla donde se cumple o se rompe la promesa del producto: al salir
 * de aquí la persona tiene una identidad completa y en ningún momento se ha
 * pedido —ni se ha enseñado— nada que la identifique. La fecha de nacimiento
 * del paso 3 no la contradice: se comprueba en el cliente y se descarta en el
 * acto, sin viajar en ninguna petición (ver `components/auth/edad.ts`).
 */
export class OnboardingPage extends BasePage {
  readonly ruta = '/onboarding'

  // Localizadores por `data-testid` (B18): el copy de esta pantalla vive en el
  // catálogo y cambia con el idioma; los roles y etiquetas siguen en el DOM y
  // los afirman los specs que hablan de accesibilidad, no estos anclajes.
  get barraProgreso(): Locator {
    return this.page.getByTestId('auth-progreso-onboarding')
  }

  // ── Paso 1 · alias ────────────────────────────────────────────────────────
  get campoAlias(): Locator {
    return this.page.getByTestId('auth-campo-alias')
  }

  /** «Otro»: pide al servidor otro seudónimo generado. */
  get botonOtroAlias(): Locator {
    return this.page.getByTestId('auth-boton-otro-alias')
  }

  /** Solo hay UN «Continuar» montado a la vez (los pasos son excluyentes). */
  get botonContinuar(): Locator {
    return this.page.getByTestId('auth-boton-continuar')
  }

  // ── Paso 3 · edad declarada ───────────────────────────────────────────────
  get campoFechaNacimiento(): Locator {
    return this.page.getByTestId('auth-campo-fecha-nacimiento')
  }

  // ── Paso 4 · confirmación ─────────────────────────────────────────────────
  get botonEntrar(): Locator {
    return this.page.getByTestId('auth-boton-entrar-darma')
  }

  /**
   * El avatar generado. Debe ser SVG INLINE: una `<img src="…">` remota sería
   * una petición saliente por persona, y eso es un rastreador con otro nombre
   * (ARCHITECTURE §2, «cero terceros en el navegador»).
   */
  get avatar(): Locator {
    return this.page.getByTestId('auth-avatar')
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

  /** Recorre los cuatro pasos aceptando lo que propone el servidor. */
  async completar(): Promise<string> {
    const alias = await this.aliasPropuesto()
    await this.botonContinuar.click()
    // Paso 2: se acepta el nivel de entrada por defecto ('escucha').
    await this.botonContinuar.click()
    // Paso 3: fecha declarada mayor de edad; se comprueba en el cliente y se
    // descarta en el acto, así que cualquier fecha válida sirve al spec.
    await this.campoFechaNacimiento.fill('1990-01-01')
    await this.botonContinuar.click()
    await this.botonEntrar.click()
    await this.page.waitForURL(/\/feed/)
    return alias
  }
}
