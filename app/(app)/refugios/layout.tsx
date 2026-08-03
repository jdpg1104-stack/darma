// ============================================================================
// B10 · Layout de /refugios
//
// `BotonCrisis` va aquí porque CONTRATOS §9 lo exige en TODOS los layouts de
// `app/(app)` y `app/(app)/layout.tsx` todavía no existe (anotado en
// PEDIDOS.md, igual que hicieron B02, B03, B04, B05 y B07). Cuando exista el
// layout del grupo con su propio botón, este se borra en una línea o saldrán
// dos.
//
// Ojo con el del HILO: dentro de `/refugios/[id]` el botón de crisis va DENTRO
// del redactor (`components/refuge/Redactor.tsx`), no flotando, porque un
// elemento fijo al viewport se va detrás del teclado en móvil — justo cuando la
// conversación se pone seria y hace falta.
// ============================================================================

import type { ReactNode } from 'react'

export default function LayoutRefugios({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
    </>
  )
}
