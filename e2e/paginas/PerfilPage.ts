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

  /** El panel privado. En un perfil ajeno no debe existir (ni en el DOM). */
  get panelPrivado(): Locator {
    return this.page.getByTestId('perfil-panel-privado')
  }

  /** La barra del medidor, DENTRO del medidor: el rol sigue siendo el contrato
   *  accesible; el testid evita casar con cualquier otro progressbar. */
  get medidorKarma(): Locator {
    return this.page.getByTestId('ui-medidor-karma').getByRole('progressbar')
  }

  get alias(): Locator {
    return this.page.getByTestId('perfil-alias')
  }

  /** Valor numérico de una fila del panel privado, por su etiqueta VISIBLE.
   *  Para no depender del copy, usa `saldoPorClave`. */
  async valorPrivado(etiqueta: string): Promise<number | null> {
    const fila = this.panelPrivado.locator('div', { hasText: etiqueta }).last()
    if (!(await fila.count())) return null
    const texto = await fila.locator('dd').first().innerText()
    const n = Number.parseInt(texto.replace(/\D/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }

  /**
   * Valor de un saldo del panel privado por su clave ESTABLE
   * (`gastable` · `cristales` · `creditos` · `escuchas` · `publicaciones`),
   * que no cambia con el idioma ni con el copy.
   */
  async saldoPorClave(
    clave: 'gastable' | 'cristales' | 'creditos' | 'escuchas' | 'publicaciones',
  ): Promise<number | null> {
    const fila = this.page.getByTestId(`perfil-saldo-${clave}`)
    if (!(await fila.count())) return null
    const texto = await fila.locator('dd').first().innerText()
    const n = Number.parseInt(texto.replace(/\D/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }

  /** Karma de reputación visible en el medidor. */
  async karmaVisible(): Promise<number> {
    const texto = await this.page.getByTestId('ui-medidor-karma-valor').first().innerText()
    return Number.parseInt(texto.replace(/\D/g, ''), 10)
  }
}
