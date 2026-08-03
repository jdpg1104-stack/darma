import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * `/post/[id]` — donde se escucha de verdad.
 *
 * El comentario que se escribe aquí nace `is_validated = false` (el cliente ni
 * siquiera tiene privilegio de INSERT sobre esa columna, ver 0004). Quien lo
 * pasa a `true` es el clasificador de IA — o, en pruebas, el fixture con
 * service_role, que es lo que dispara `trg_comments_validated` de verdad.
 */
export class HiloPage extends BasePage {
  /** La ruta lleva id: se navega con `irAPost`, no con `ir()`. */
  readonly ruta = '/post'

  private postId: string | null = null

  async irAPost(id: string): Promise<void> {
    this.postId = id
    await this.page.goto(`/post/${id}`)
    await this.esperarQuieta()
  }

  get textareaRespuesta(): Locator {
    return this.page.getByLabel('Escríbele algo')
  }

  get botonEnviar(): Locator {
    return this.page.getByRole('button', { name: 'Enviar', exact: true })
  }

  get comentarios(): Locator {
    return this.page.getByRole('article')
  }

  /** Chip que indica que el comentario ya cuenta como escucha. */
  get selloEscuchaContada(): Locator {
    return this.page.getByText('Ha contado como escucha')
  }

  /** Chip de comentario aún sin validar. */
  get selloEnRevision(): Locator {
    return this.page.getByText(/Comprobando tu mensaje|En revisión/)
  }

  /**
   * Escribe un comentario por la UI y espera la respuesta del servidor.
   *
   * Devuelve el id del comentario recién creado, leído de la respuesta de
   * `POST /api/comments` — que es lo que el fixture necesita para validarlo
   * después con service_role.
   */
  async comentar(texto: string): Promise<string | null> {
    const respuesta = this.page.waitForResponse(
      (r) => r.url().includes('/api/comments') && r.request().method() === 'POST',
    )
    await this.textareaRespuesta.fill(texto)
    await this.botonEnviar.click()

    const res = await respuesta
    const cuerpo = (await res.json()) as {
      ok?: boolean
      data?: { id?: string; comentario?: { id?: string } }
    }
    return cuerpo.data?.id ?? cuerpo.data?.comentario?.id ?? null
  }

  get idActual(): string | null {
    return this.postId
  }
}
