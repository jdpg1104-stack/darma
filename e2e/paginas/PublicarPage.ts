import type { Locator } from '@playwright/test'
import { obtenerTraductor } from '@/i18n/traductor'
import {
  LISTENS_PER_POST,
  reciprocityMessage,
  type ReciprocityState,
} from '@/lib/reciprocity'
import { BasePage } from './BasePage'

// El contexto del navegador se crea con `locale: 'es-ES'` (playwright.config.ts),
// así que la pantalla se pinta en español y en español hay que buscarla.
const t = obtenerTraductor('es')

/**
 * El texto que `/publicar` pinta para un estado dado, ya resuelto.
 *
 * Sale de `reciprocityMessage()` + el catálogo, nunca de copy escrito a mano en
 * un spec: si cambia la frase, estos localizadores la siguen solos.
 */
function copyDeReciprocidad(estado: ReciprocityState): string {
  const { clave, params } = reciprocityMessage(estado)
  return t(clave, params)
}

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
   * Se localiza por el texto derivado de `reciprocityMessage()`, nunca escrito a
   * mano en un spec, porque el `<p>` que lo contiene no tiene id, role ni
   * `data-testid`. Pedido a B03 en PEDIDOS.md.
   */
  mensajeParaEstado(estado: ReciprocityState): Locator {
    return this.page.getByText(copyDeReciprocidad(estado), { exact: false })
  }

  /**
   * Cuál de los estados posibles está pintado ahora mismo, y con qué texto.
   *
   * Recorre los cuatro estados alcanzables desde `/publicar` (faltan 3, 2, 1 y
   * listo) en vez de buscar por un fragmento de copy: así no hay ni una frase
   * fijada en el Page Object.
   */
  private async estadoPintado(): Promise<{ hechas: number; texto: string } | null> {
    for (let hechas = 0; hechas <= LISTENS_PER_POST; hechas += 1) {
      const nodo = this.page
        .getByText(copyDeReciprocidad({ listenCredits: hechas, postsPublished: 1 }), {
          exact: false,
        })
        .first()
      if (await nodo.count()) return { hechas, texto: (await nodo.innerText()).trim() }
    }
    return null
  }

  async mensajeReciprocidad(): Promise<string> {
    const pintado = await this.estadoPintado()
    if (!pintado) throw new Error(SIN_ESTADO)
    return pintado.texto
  }

  /**
   * Escuchas ya hechas de las 3 que hacen falta, leídas de la UI.
   *
   * ⚠️ La ficha de B18 pedía `data-testid="escuchas-hechas"`, y hoy NO EXISTE:
   * `/publicar` pasa al Composer el MOTIVO y el número que faltan, nunca las
   * hechas (decisión deliberada, documentada en la cabecera de la página).
   * Mientras el testid no llegue —pedido a B03 en PEDIDOS.md—, el número se
   * DERIVA de qué mensaje está pintado. El día que aparezca el testid solo
   * cambia este método.
   */
  async escuchasHechas(): Promise<number> {
    const porTestId = this.page.getByTestId('escuchas-hechas')
    if (await porTestId.count()) {
      return Number.parseInt((await porTestId.innerText()).replace(/\D/g, ''), 10)
    }

    const pintado = await this.estadoPintado()
    if (!pintado) throw new Error(SIN_ESTADO)
    return pintado.hechas
  }
}

const SIN_ESTADO =
  'No se ha podido leer el estado de reciprocidad en /publicar: ni data-testid ' +
  'ni ninguno de los mensajes de reciprocityMessage() está en la pantalla.'
