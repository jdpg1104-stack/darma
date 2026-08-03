// ============================================================================
// B19 · Navegación del centro de mando. SERVER COMPONENT.
//
// ⚠️ ESTO NO ES UN CONTROL DE ACCESO. Ocultar una pestaña es cosmética: la ruta
// se teclea a mano y la API se llama con `curl`. La comprobación real vuelve a
// ocurrir en `requireAdmin()` dentro de cada página y de cada ruta de API. Si
// alguien borra este componente, el sistema sigue siendo seguro; solo se vuelve
// incómodo de usar.
//
// Se oculta de todas formas por una razón que no es de seguridad: enseñarle a
// alguien de soporte una pestaña de economía que va a devolverle un 403 es
// contarle que existe y frustrarle a la vez.
// ============================================================================

import Link from 'next/link'
import type { RolAdmin } from '../_lib/acceso.ts'
import { tabsVisibles } from '../_lib/navegacion.ts'

export function NavegacionAdmin({ rol }: { rol: RolAdmin }) {
  const tabs = tabsVisibles(rol)

  return (
    <nav aria-label="Centro de mando">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link href={tab.ruta}>{tab.etiqueta}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
