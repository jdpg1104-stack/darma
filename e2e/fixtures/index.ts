import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  clienteAdminE2E,
  comprobarFusible,
  ErrorFusibleProduccion,
  hayCredencialesAdmin,
  refDeProyecto,
} from '../utils/admin'

import { CONTRASENA_E2E, idRun } from '../utils/idRun'
import { limpiarPorPrefijo } from '../utils/limpieza'
import { inyectarSesion, iniciarSesion } from '../utils/sesion'
import {
  agotarEscuchas,
  borrarVideo,
  creditosDeEscucha,
  karmaDelLedger,
  sembrarPosts,
  sembrarVideo,
  validarComentario,
} from './datos.fixture'
import { borrarUsuario, crearUsuario, type UsuarioE2E } from './usuario.fixture'

export type { UsuarioE2E }

// El fusible se re-exporta desde aquí para que su propia prueba siga la regla
// del bloque: un spec solo importa de `./fixtures`.
export { clienteAdminE2E, comprobarFusible, ErrorFusibleProduccion, refDeProyecto }

// ============================================================================
// El ÚNICO import de un spec.
//
// Un spec NUNCA importa `@playwright/test` ni `@supabase/supabase-js`
// directamente: si lo hiciera, tarde o temprano alguien crearía un cliente
// service_role dentro de un test y la disciplina se perdería.
// ============================================================================

/**
 * ¿Falta la clave de administración?
 *
 * Los fixtures de esta suite crean usuarios, siembran posts y validan
 * comentarios con `service_role`. Con `SUPABASE_SERVICE_ROLE_KEY` vacía en
 * `.env.local` no hay forma de montar el estado de partida —y además casi toda
 * ruta de escritura de la app devuelve hoy `error_interno` por lo mismo—, así
 * que los recorridos que dependan de ella se marcan `test.fixme()` con este
 * motivo. El día que la clave exista, se ejecutan solos: no hay que tocar nada.
 */
export const SIN_CLAVE_ADMIN = !hayCredencialesAdmin()

export const MOTIVO_SIN_CLAVE_ADMIN =
  'SUPABASE_SERVICE_ROLE_KEY está vacía en .env.local. Sin ella el fixture no ' +
  'puede crear usuarios ni validar comentarios, y las rutas de escritura de la ' +
  'app (POST /api/auth/anonimo, /api/posts, /api/comments, /api/content/*, ' +
  'GET /api/me) devuelven error_interno porque todas llaman a createAdminClient(). ' +
  'Ver HANDOFF/PEDIDOS.md · B18 → F4/humano.'

/**
 * Marca como `fixme` todos los tests del `describe` que la invoque cuando no
 * hay administración utilizable, con el motivo visible en el informe.
 *
 * Va en un `beforeEach` y no en el cuerpo del `describe` a propósito: llamar a
 * `test.fixme(condicion, motivo)` directamente en el cuerpo de un `describe`
 * NO es la forma de grupo —Playwright ejecuta los tests igual y salen en
 * rojo—, mientras que en un hook sí aborta antes de que se monte ningún
 * fixture. Comprobado en esta suite, no supuesto.
 */
export function omitirSinAdmin(): void {
  test.beforeEach(() => {
    test.fixme(SIN_CLAVE_ADMIN, MOTIVO_SIN_CLAVE_ADMIN)
  })
}

export interface FixturesDarma {
  /** Usuario nuevo, aislado, con sesión ya inyectada en el contexto. */
  usuario: UsuarioE2E
  /** Segundo usuario, para las pruebas de privacidad entre personas. */
  otroUsuario: UsuarioE2E
  /** Contexto y página del segundo usuario, con SU sesión (no la del primero). */
  paginaDeOtro: Page
  /** Siembra N posts de N autores distintos. Devuelve sus ids. */
  sembrarPosts: (n: number) => Promise<string[]>
  /** Marca un comentario como validado vía service_role → dispara el trigger. */
  validarComentario: (comentarioId: string) => Promise<void>
  /** Deja al usuario con posts_published>=1 y listen_credits=0, por la vía real. */
  agotarEscuchas: (u: UsuarioE2E) => Promise<void>
  /** Créditos de escucha reales del usuario (lectura con service_role). */
  creditosDe: (u: UsuarioE2E) => Promise<number>
  /** Karma acumulado en el LEDGER, que es la fuente de verdad. */
  karmaDe: (u: UsuarioE2E) => Promise<number>
  /** Siembra un vídeo publicado y lo retira al terminar. */
  sembrarVideo: (duracionSegundos?: number) => Promise<string>
  /** Prefijo único de esta ejecución: `e2e_<8hex>_`. */
  idRun: string
}

export const test = base.extend<FixturesDarma>({
  idRun: async ({}, usar) => {
    await usar(idRun)
  },

  usuario: async ({ context, baseURL }, usar) => {
    const u = await crearUsuario()
    const sesion = await iniciarSesion(u.email, CONTRASENA_E2E)
    await inyectarSesion(context, sesion, baseURL!)
    await usar(u)
    await borrarUsuario(u)
  },

  otroUsuario: async ({}, usar) => {
    const u = await crearUsuario('otro')
    await usar(u)
    await borrarUsuario(u)
  },

  paginaDeOtro: async ({ browser, otroUsuario, baseURL }, usar) => {
    // Contexto propio: compartir el del usuario principal mezclaría las dos
    // cookies de sesión y la prueba de privacidad daría un verde falso.
    const contexto: BrowserContext = await browser.newContext({ baseURL })
    const sesion = await iniciarSesion(otroUsuario.email, CONTRASENA_E2E)
    await inyectarSesion(contexto, sesion, baseURL!)
    const pagina = await contexto.newPage()
    await usar(pagina)
    await contexto.close()
  },

  sembrarPosts: async ({}, usar) => {
    const creados: UsuarioE2E[] = []
    await usar(async (n: number) => {
      const { ids, autores } = await sembrarPosts(n)
      creados.push(...autores)
      return ids
    })
    for (const autor of creados) await borrarUsuario(autor)
  },

  validarComentario: async ({}, usar) => {
    await usar(validarComentario)
  },

  agotarEscuchas: async ({}, usar) => {
    await usar(agotarEscuchas)
  },

  creditosDe: async ({}, usar) => {
    await usar((u: UsuarioE2E) => creditosDeEscucha(u.id))
  },

  karmaDe: async ({}, usar) => {
    await usar((u: UsuarioE2E) => karmaDelLedger(u.id))
  },

  sembrarVideo: async ({}, usar) => {
    const ids: string[] = []
    await usar(async (duracion?: number) => {
      const id = await sembrarVideo(String(ids.length + 1), duracion)
      ids.push(id)
      return id
    })
    for (const id of ids) await borrarVideo(id)
  },
})

/**
 * Barrido final de la ejecución. Es idempotente y borra POR PREFIJO, así que
 * recoge también lo que dejó un test que reventó a mitad y nunca llegó a su
 * teardown.
 */
export async function limpiarEjecucion(): Promise<number> {
  if (SIN_CLAVE_ADMIN) return 0
  return limpiarPorPrefijo(idRun)
}

export { expect }
