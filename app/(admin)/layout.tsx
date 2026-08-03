// ============================================================================
// B19 · Layout del grupo (admin). SERVER COMPONENT.
//
// ⚠️⚠️ ESTE ARCHIVO ENVUELVE TAMBIÉN `app/(admin)/moderacion/**`, QUE ES DE
// B11 Y NO SE TOCA. Es el único punto de contacto entre los dos bloques, y por
// eso está deliberadamente VACÍO de maquetación:
//
//   · Sin `<main>` con `max-width`.
//   · Sin grid ni flex que imponga columnas.
//   · Sin estilos que asuman una estructura de página concreta.
//
// Si este layout impusiera un contenedor estrecho, la cola de moderación —que
// es una lista larga con acciones a la derecha— se rompería sin que nadie de
// este bloque se enterara, porque nadie de este bloque la abre. Un `max-width`
// puesto aquí «para que quede bonito el panel» es un incidente de moderación a
// tres semanas vista.
//
// Lo que sí hace, y es lo único que hace:
//   1. Repite el guard (defensa en profundidad).
//   2. Pinta la navegación filtrada por rol.
//   3. Impide la indexación.
//
// ── POR QUÉ 404 Y NO 403 ───────────────────────────────────────────────────
// `notFound()` en vez de una página de «no tienes permiso». Un 403 confirma
// que la ruta existe, y de un centro de mando lo mejor que puede saber quien no
// entra es nada. El intento SÍ queda auditado: la ausencia de pista para quien
// llama no significa ausencia de registro para nosotros.
// ============================================================================

import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { requireAdmin } from '../api/admin/_guard.ts'
import { ACCIONES } from './_lib/acceso.ts'
import { NavegacionAdmin } from './_componentes/NavegacionAdmin.tsx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Centro de mando · Darma',
  // Un panel de operación indexado sería un mapa del sistema para cualquiera.
  robots: { index: false, follow: false },
}

export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  let rol
  try {
    // `soporte` es el mínimo absoluto: quien no llegue ni a eso no ve el grupo
    // entero. Cada página vuelve a exigir SU mínimo por su cuenta.
    const contexto = await requireAdmin('soporte', { accion: ACCIONES.panel })
    rol = contexto.rol
  } catch {
    // El detalle del error se queda dentro del guard, que ya lo auditó y ya lo
    // registró. Aquí no se distingue «sin sesión» de «sin permiso»: las dos
    // cosas son un 404.
    notFound()
  }

  return (
    <>
      <NavegacionAdmin rol={rol} />
      {children}
    </>
  )
}
