import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * `/perfil` (propio) y `/perfil/[id]` (ajeno).
 *
 * La diferencia entre los dos es EL contrato de anonimato de Darma: el panel
 * «Solo tú ves esto» —karma gastable, cristales, escuchas por canjear— existe
 * en el propio y no debe existir, ni en el DOM, en el ajeno (CONTRATOS §2).
 */
export class PerfilPage extends BasePage {
  readonly ruta = '/perfil'

  async irAPerfilDe(id: string): Promise<void> {
    await this.page.goto(`/perfil/${id}`)
    await this.esperarQuieta()
  }

  /** El panel privado. En un perfil ajeno no debe existir. */
  get panelPrivado(): Locator {
    return this.page.locator('section[aria-labelledby="titulo-panel-privado"]')
  }

  get medidorKarma(): Locator {
    return this.page.getByRole('progressbar')
  }

  get alias(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  /** Valor numérico de una fila del panel privado, por su etiqueta. */
  async valorPrivado(etiqueta: string): Promise<number | null> {
    const fila = this.panelPrivado.locator('div', { hasText: etiqueta }).last()
    if (!(await fila.count())) return null
    const texto = await fila.locator('dd').first().innerText()
    const n = Number.parseInt(texto.replace(/\D/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }

  /** Karma de reputación visible en el medidor. */
  async karmaVisible(): Promise<number> {
    const texto = await this.page.getByText(/de karma/).first().innerText()
    return Number.parseInt(texto.replace(/\D/g, ''), 10)
  }
}
