import type { Locator } from '@playwright/test'
import {
  LISTENS_PER_POST,
  reciprocityMessage,
  type ReciprocityState,
} from '@/lib/reciprocity'
import { BasePage } from './BasePage'

/**
 * `/publicar` — el composer y el gate de reciprocidad.
 *
 * ⚠️ La UI de esta pantalla es COSMÉTICA. El gate real es el trigger
 * `trg_posts_reciprocity` de Postgres, y por eso el recorrido (c) prueba las dos
 * capas: que el botón esté deshabilitado no demuestra nada, porque cualquiera
 * puede hablar con PostgREST con la anon key que va en el bundle.
 */
export class PublicarPage extends BasePage {
  readonly ruta = '/publicar'

  get textarea(): Locator {
    return this.page.getByLabel('Cuéntanoslo')
  }

  get botonPublicar(): Locator {
    return this.page.getByRole('button', { name: 'Publicar' })
  }

  get selectorTema(): Locator {
    return this.page.getByLabel('¿De qué va?')
  }

  /** Confirmación de que el texto salió: `role="status"`. */
  get confirmacion(): Locator {
    return this.page.getByText('Ya está publicado. Alguien lo va a leer.')
  }

  /** El error que devuelve el SERVIDOR (incluido el rechazo del trigger). */
  get errorServidor(): Locator {
    return this.page.getByRole('alert')
  }

  async escribir(texto: string): Promise<void> {
    await this.textarea.fill(texto)
  }

  async enviar(): Promise<void> {
    await this.botonPublicar.click()
  }

  async botonHabilitado(): Promise<boolean> {
    return this.botonPublicar.isEnabled()
  }

  /** El texto que la persona escribió, tal y como está AHORA en el textarea. */
  async textoEnElArea(): Promise<string> {
    return this.textarea.inputValue()
  }

  /**
   * El mensaje de reciprocidad que se está pintando.
   *
   * Se localiza por el texto que produce `reciprocityMessage()` —importado de
   * `lib/reciprocity.ts`, nunca escrito a mano en un spec— porque el `<p>` que
   * lo contiene no tiene id, role ni `data-testid`. Pedido a B03 en PEDIDOS.md.
   */
  mensajeParaEstado(estado: ReciprocityState): Locator {
    return this.page.getByText(reciprocityMessage(estado), { exact: false })
  }

  async mensajeReciprocidad(): Promise<string> {
    // La frase siempre termina en la misma coletilla cuando falta escuchar, y
    // empieza igual cuando ya se puede: se busca por el fragmento invariable
    // que produce lib/reciprocity.ts para no fijar copy en el Page Object.
    const marca = reciprocityMessage({ listenCredits: 0, postsPublished: 1 })
    const cola = marca.slice(marca.indexOf('Aquí nadie habla'))
    const nodo = this.page.locator(`p:has-text("${cola}")`).first()
    if (await nodo.count()) return (await nodo.innerText()).trim()

    const permitido = reciprocityMessage({
      listenCredits: LISTENS_PER_POST,
      postsPublished: 1,
    })
    return (await this.page.getByText(permitido).first().innerText()).trim()
  }

  /**
   * Escuchas ya hechas de las 3 que hacen falta, leídas de la UI.
   *
   * ⚠️ La ficha de B18 pedía `data-testid="escuchas-hechas"`, y hoy NO EXISTE:
   * `/publicar` pasa al Composer la FRASE de `reciprocityMessage()` y un
   * booleano, nunca el número (decisión deliberada, documentada en la cabecera
   * de la página). Mientras el testid no llegue —pedido a B03 en PEDIDOS.md—,
   * el número se DERIVA comparando el texto pintado con lo que produce
   * `reciprocityMessage()` para cada estado posible. Así el spec sigue sin
   * contener copy y el día que aparezca el testid solo cambia este método.
   */
  async escuchasHechas(): Promise<number> {
    const porTestId = this.page.getByTestId('escuchas-hechas')
    if (await porTestId.count()) {
      return Number.parseInt((await porTestId.innerText()).replace(/\D/g, ''), 10)
    }

    for (let hechas = 0; hechas <= LISTENS_PER_POST; hechas += 1) {
      const esperado = reciprocityMessage({
        listenCredits: hechas,
        postsPublished: 1,
      })
      if (await this.page.getByText(esperado, { exact: false }).count()) return hechas
    }

    throw new Error(
      'No se ha podido leer el estado de reciprocidad en /publicar: ni data-testid ' +
        'ni ninguna de las frases de reciprocityMessage() está en la pantalla.',
    )
  }
}
