import { clienteAdminE2E } from '../utils/admin'
import { CONTRASENA_E2E, correoE2E, nombreE2E } from '../utils/idRun'
import { iniciarSesion, type SesionSupabase } from '../utils/sesion'

/**
 * Cuenta creada SIN sesión: para SIEMBRA (autores cuyos posts inserta
 * service_role y que jamás navegan).
 *
 * La distinción no es cosmética: cada grant de contraseña cuenta contra el
 * límite POR IP del Auth de Supabase (~30 por 5 min), y la suite entera
 * compite por esa ventana. Iniciar sesión con alguien que no la va a usar es
 * gastar suite — era, junto con el doble login del fixture `usuario`, la
 * causa de los `429 over_request_rate_limit` al correr todo de una tacada.
 */
export interface CuentaSembrada {
  id: string
  alias: string
  /** Solo del lado del fixture. JAMÁS se afirma en la UI. */
  email: string
}

/** Usuario de prueba: existe en `auth.users` y en `profiles`, con sesión lista. */
export interface UsuarioE2E extends CuentaSembrada {
  /** La sesión completa, para inyectarla en el navegador SIN un segundo login. */
  sesion: SesionSupabase
  /** Para las llamadas directas a PostgREST (la capa que de verdad importa). */
  accessToken: string
  refreshToken: string
  expiresAt: number
}

let contador = 0

/**
 * Crea la cuenta (auth + perfil), sin iniciar sesión.
 *
 * ⚠️ El perfil se crea con un INSERT de service_role y NO se tocan
 * `listen_credits` ni `posts_published`: dejarlos en su valor por defecto es
 * parte del contrato. Moverlos a mano se saltaría los triggers que son
 * justamente lo que hay que verificar.
 */
export async function crearCuenta(etiqueta?: string): Promise<CuentaSembrada> {
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

  return { id, alias, email }
}

/**
 * Crea un usuario nuevo, aislado, con perfil ya completo y sesión iniciada.
 *
 * Un usuario NUEVO POR TEST, sin excepción: dos tests que compartan usuario
 * compiten por `listen_credits` y por el tope diario de karma, y el fallo será
 * intermitente e irreproducible. Aquí no hay `storageState` compartido.
 *
 * El login de aquí es EL ÚNICO del usuario: el fixture inyecta esta misma
 * sesión en el navegador. Un segundo grant de contraseña por usuario no
 * verificaba nada y duplicaba la presión sobre el límite por IP del Auth.
 */
export async function crearUsuario(etiqueta?: string): Promise<UsuarioE2E> {
  const cuenta = await crearCuenta(etiqueta)
  const sesion = await iniciarSesion(cuenta.email, CONTRASENA_E2E)

  return {
    ...cuenta,
    sesion,
    accessToken: sesion.access_token,
    refreshToken: sesion.refresh_token,
    expiresAt: sesion.expires_at,
  }
}

/** Borra un usuario concreto. El teardown por prefijo es la red de seguridad. */
export async function borrarUsuario(usuario: CuentaSembrada): Promise<void> {
  const admin = clienteAdminE2E()
  await admin.from('posts').delete().eq('author_id', usuario.id)
  await admin.from('profiles').delete().eq('id', usuario.id)
  await admin.auth.admin.deleteUser(usuario.id)
}
