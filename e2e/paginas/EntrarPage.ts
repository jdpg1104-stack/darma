import type { Locator } from '@playwright/test'
import { obtenerTraductor } from '@/i18n/traductor'
// Constante pura (lib/privacy/avisos.ts no importa nada de servidor): el número
// de la casilla y el que valida el servidor son EL MISMO.
import { EDAD_MINIMA } from '@/lib/privacy/avisos'
import { BasePage } from './BasePage'

// El contexto del navegador se crea con `locale: 'es-ES'` (playwright.config.ts),
// así que la pantalla se pinta en español y en español hay que buscarla.
const t = obtenerTraductor('es')

/** `/entrar` — la única puerta pública con sesión de por medio. */
export class EntrarPage extends BasePage {
  readonly ruta = '/entrar'

  /**
   * El titular sí se busca por su TEXTO, resuelto del catálogo: aquí el test
   * afirma el contenido de la pantalla (que la promesa se lee tal cual), no
   * solo que exista un `<h1>`.
   */
  get titulo(): Locator {
    return this.page.getByRole('heading', { name: t('auth.entrada.titulo') })
  }

  /** El registro anónimo: ni nombre, ni correo, ni teléfono. */
  get botonAnonimo(): Locator {
    return this.page.getByTestId('auth-boton-anonimo')
  }

  /**
   * La casilla «Tengo {edad} años o más», desmarcada por defecto y obligatoria:
   * sin ella el cliente ni lanza la petición y el servidor devuelve 422 igual.
   *
   * El copy se resuelve del catálogo con `EDAD_MINIMA`, nunca escrito a mano:
   * si cambia la edad o la frase, este localizador la sigue solo. El nombre
   * accesible del checkbox es el texto del `<label>` entero (frase + enlace),
   * y `getByRole` casa por subcadena, así que con la frase basta.
   */
  get casillaEdad(): Locator {
    return this.page.getByRole('checkbox', {
      name: t('auth.entrada.casillaEdad', { edad: EDAD_MINIMA }),
    })
  }

  get campoCorreo(): Locator {
    return this.page.getByTestId('auth-campo-correo')
  }

  get botonEnlace(): Locator {
    return this.page.getByTestId('auth-boton-enlace')
  }

  get error(): Locator {
    return this.page.getByRole('alert')
  }

  /**
   * El aviso concreto de pulsar el alta sin declarar la edad, resuelto del
   * catálogo (`auth.entrada.errorEdadMinima`), nunca copiado en un spec.
   */
  get errorEdadMinima(): Locator {
    return this.error.filter({
      hasText: t('auth.entrada.errorEdadMinima', { edad: EDAD_MINIMA }),
    })
  }

  /**
   * Se registra de forma anónima y espera a llegar al onboarding.
   *
   * Marca ANTES la casilla de edad: es la única condición del camino anónimo
   * (desmarcada por defecto, y el servidor la exige igual con un 422).
   *
   * No se espera por un `waitForTimeout` sino por la URL destino, que es el
   * estado observable de que `POST /api/auth/anonimo` ha cuajado.
   */
  async registrarseAnonimo(): Promise<void> {
    await this.casillaEdad.check()
    await this.botonAnonimo.click()
    await this.page.waitForURL(/\/onboarding/)
  }
}
