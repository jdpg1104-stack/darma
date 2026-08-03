// ============================================================================
// /onboarding — los 3 pasos.
//
// Server Component. Hace tres cosas y ninguna de ellas es interactiva:
//   1. Comprueba la sesión (sin sesión no hay onboarding que hacer).
//   2. Echa a quien ya tiene perfil: volver aquí con la app montada no debe
//      ofrecer "crear identidad" otra vez.
//   3. Genera la tanda de identidades candidatas con el CSPRNG del servidor y
//      se las pasa a la hoja cliente, que las va rotando sin más peticiones.
//
// PRESUPUESTO: solo `AsistenteOnboarding` viaja al navegador. Esta es la
// primera pantalla que ve alguien y la que decide si se queda.
// ============================================================================

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createAnonymousIdentity } from '@/lib/anonymity'
import { getSesion } from '@/lib/auth/session'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { AsistenteOnboarding, type Candidato } from '@/components/auth/AsistenteOnboarding'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('auth.onboarding.metaTitulo'),
    robots: { index: false, follow: false },
  }
}

// La sesión se lee de la cookie: nada de esta página se puede prerrenderizar.
export const dynamic = 'force-dynamic'

/** Cuántos alias se preparan de una tanda.
 *
 *  Ocho es el número que hace que el botón «otro» se sienta infinito sin serlo:
 *  a la novena pulsación se repite el primero, y para entonces casi todo el
 *  mundo ha elegido. Generar cien "por si acaso" solo engordaría el HTML de la
 *  primera pantalla de la app. */
const CANDIDATOS = 8

export default async function PaginaOnboarding() {
  const sesion = await getSesion()

  // El proxy ya cierra esta ruta a quien no tiene sesión; esto es la defensa en
  // profundidad, y además evita renderizar medio árbol para nada.
  if (!sesion) redirect('/entrar')
  if (sesion.perfilCompleto) redirect('/feed')

  // `createAnonymousIdentity` usa randomBytes: la semilla NO deriva del user id
  // ni del correo, así que el alias no se puede recomputar a partir de una
  // filtración de auth.users (ver la cabecera de lib/anonymity.ts).
  const candidatos: Candidato[] = Array.from({ length: CANDIDATOS }, () => {
    const identidad = createAnonymousIdentity()
    return { alias: identidad.alias, avatarSeed: identidad.avatarSeed }
  })

  return <AsistenteOnboarding candidatos={candidatos} />
}
