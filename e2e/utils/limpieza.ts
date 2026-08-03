import { clienteAdminE2E } from './admin'
import { PREFIJO_E2E } from './idRun'

// ============================================================================
// Teardown por PREFIJO, nunca por lista de ids.
//
// La diferencia importa: si un test revienta a mitad, la lista de ids que
// llevaba en memoria se pierde y esos usuarios se quedan en la base para
// siempre. El prefijo sobrevive al fallo.
//
// La base de desarrollo es un plan gratuito de 500 MB compartido con otros
// bloques. Dejar basura acumulándose no es un detalle estético: ya dejó a
// `darma-dev` en solo-lectura una vez.
// ============================================================================

/** Alias de los perfiles de prueba: `e2e_<8hex>_<n>`. */
function patronAlias(prefijo: string): string {
  return `${prefijo}%`
}

/**
 * Borra todo lo creado bajo un prefijo.
 *
 * El borrado va por `auth.admin.deleteUser`, no por `delete from profiles`:
 * la migración 0201 de B20 quitó la FK en cascada de `profiles → auth.users`
 * a propósito (destruía comentarios de terceros al ejercer el derecho de
 * supresión), así que borrar el perfil a secas dejaría el usuario huérfano en
 * `auth.users` y el correo sintético ocupado para siempre.
 */
export async function limpiarPorPrefijo(prefijo: string): Promise<number> {
  const admin = clienteAdminE2E()

  const { data: perfiles, error } = await admin
    .from('profiles')
    .select('id')
    .like('alias', patronAlias(prefijo))

  if (error) throw new Error(`No se han podido listar los perfiles de ${prefijo}: ${error.message}`)

  let borrados = 0
  for (const { id } of perfiles ?? []) {
    // Los posts y comentarios del usuario se van con él (FK on delete cascade
    // desde profiles); lo que sobrevive seudonimizado —karma_events,
    // crisis_events— es deliberado y no se toca.
    await admin.from('posts').delete().eq('author_id', id)
    await admin.from('profiles').delete().eq('id', id)
    const { error: errorAuth } = await admin.auth.admin.deleteUser(id)
    if (!errorAuth) borrados += 1
  }

  return borrados
}

/**
 * Barrido de arranque: elimina los restos de ejecuciones ANTERIORES con más de
 * 24 h. Sin esto, cada test que revienta deja basura que se acumula para
 * siempre; con esto, la basura tiene fecha de caducidad y el borrado nunca
 * pisa una ejecución en curso (ni la de otro desarrollador a la vez).
 */
export async function barrerRestosViejos(horas = 24): Promise<number> {
  const admin = clienteAdminE2E()
  const corte = new Date(Date.now() - horas * 3_600_000).toISOString()

  const { data: perfiles, error } = await admin
    .from('profiles')
    .select('id')
    .like('alias', `${PREFIJO_E2E}%`)
    .lt('created_at', corte)

  if (error) return 0

  let borrados = 0
  for (const { id } of perfiles ?? []) {
    await admin.from('posts').delete().eq('author_id', id)
    await admin.from('profiles').delete().eq('id', id)
    const { error: errorAuth } = await admin.auth.admin.deleteUser(id)
    if (!errorAuth) borrados += 1
  }
  return borrados
}
