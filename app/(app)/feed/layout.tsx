// ============================================================================
// Layout de /feed.
//
// Existe por UNA razón que no es de maquetación: `BotonCrisis` tiene que estar
// presente en todos los layouts de `app/(app)` (CONTRATOS §9), y `app/(app)` no
// tiene layout propio todavía —no es de este bloque—. Ponerlo aquí garantiza que
// la pantalla que más se carga de la app nunca se sirve sin el acceso a los
// recursos de ayuda.
//
// Cuando exista `app/(app)/layout.tsx` con el botón, este archivo puede quedarse
// solo con el `<main>`: tener el botón dos veces no rompe nada (el componente se
// oculta solo en /ayuda), pero sobra. Anotado en HANDOFF/PEDIDOS.md.
// ============================================================================

import type { ReactNode } from 'react'

export default function LayoutFeed({ children }: { children: ReactNode }) {
  return (
    <>
      <main id="contenido">{children}</main>
    </>
  )
}
