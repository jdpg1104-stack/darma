import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** `/entrar` — la única puerta pública con sesión de por medio. */
export class EntrarPage extends BasePage {
  readonly ruta = '/entrar'

  get titulo(): Locator {
    return this.page.getByRole('heading', { name: 'Entra sin decir quién eres' })
  }

  /** El registro anónimo: ni nombre, ni correo, ni teléfono. */
  get botonAnonimo(): Locator {
    return this.page.getByRole('button', { name: 'Entrar sin dar mis datos' })
  }

  get campoCorreo(): Locator {
    return this.page.getByLabel(/ya tenías cuenta/i)
  }

  get botonEnlace(): Locator {
    return this.page.getByRole('button', { name: 'Enviarme el enlace' })
  }

  get error(): Locator {
    return this.page.getByRole('alert')
  }

  /**
   * Se registra de forma anónima y espera a llegar al onboarding.
   *
   * No se espera por un `waitForTimeout` sino por la URL destino, que es el
   * estado observable de que `POST /api/auth/anonimo` ha cuajado.
   */
  async registrarseAnonimo(): Promise<void> {
    await this.botonAnonimo.click()
    await this.page.waitForURL(/\/onboarding/)
  }
}
