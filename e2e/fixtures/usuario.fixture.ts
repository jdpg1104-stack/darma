import { clienteAdminE2E } from '../utils/admin'
import { CONTRASENA_E2E, correoE2E, nombreE2E } from '../utils/idRun'
import { iniciarSesion } from '../utils/sesion'

/** Usuario de prueba: existe en `auth.users` y en `profiles`, con sesión lista. */
export interface UsuarioE2E {
  id: string
  alias: string
  /** Solo del lado del fixture. JAMÁS se afirma en la UI. */
  email: string
  /** Para las llamadas directas a PostgREST (la capa que de verdad importa). */
  accessToken: string
  refreshToken: string
  expiresAt: number
}

let contador = 0

/**
 * Crea un usuario nuevo, aislado, con perfil ya completo y sesión iniciada.
 *
 * Un usuario NUEVO POR TEST, sin excepción: dos tests que compartan usuario
 * compiten por `listen_credits` y por el tope diario de karma, y el fallo será
 * intermitente e irreproducible. Aquí no hay `storageState` compartido.
 *
 * ⚠️ El perfil se crea con un INSERT de service_role y NO se tocan
 * `listen_credits` ni `posts_published`: dejarlos en su valor por defecto es
 * parte del contrato. Moverlos a mano se saltaría los triggers que son
 * justamente lo que hay que verificar.
 */
export async function crearUsuario(etiqueta?: string): Promise<UsuarioE2E> {
  const admin = clienteAdminE2E()
  contador += 1
  // El contador entra SIEMPRE, también con etiqueta: un retry de Playwright
  // reusa el worker, y si el teardown del intento fallido no llegó a borrar
  // al usuario, la etiqueta sola colisionaría con «already been registered».
  const sufijo = etiqueta ? `${contador}${etiqueta}` : String(contador)
  const alias = nombreE2E(sufijo)
  const email = correoE2E(sufijo)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: CONTRASENA_E2E,
    // Sin confirmar, GoTrue no deja iniciar sesión con contraseña y el fixture
    // se quedaría colgado esperando un correo que no existe.
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`No se ha podido crear el usuario ${alias}: ${error?.message}`)
  }

  const id = data.user.id

  const { error: errorPerfil } = await admin
    .from('profiles')
    .insert({ id, alias, avatar_seed: id.replace(/-/g, '').slice(0, 16) })

  if (errorPerfil) {
    await admin.auth.admin.deleteUser(id)
    throw new Error(`No se ha podido crear el perfil de ${alias}: ${errorPerfil.message}`)
  }

  const sesion = await iniciarSesion(email, CONTRASENA_E2E)

  return {
    id,
    alias,
    email,
    accessToken: sesion.access_token,
    refreshToken: sesion.refresh_token,
    expiresAt: sesion.expires_at,
  }
}

/** Borra un usuario concreto. El teardown por prefijo es la red de seguridad. */
export async function borrarUsuario(usuario: UsuarioE2E): Promise<void> {
  const admin = clienteAdminE2E()
  await admin.from('posts').delete().eq('author_id', usuario.id)
  await admin.from('profiles').delete().eq('id', usuario.id)
  await admin.auth.admin.deleteUser(usuario.id)
}
