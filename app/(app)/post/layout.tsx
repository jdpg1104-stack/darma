// ============================================================================
// Layout de /post — existe por una sola razón: el botón de crisis.
//
// CONTRATOS §9: «el botón de crisis está siempre visible; todos los layouts de
// app/(app) deben incluirlo». `app/(app)/layout.tsx` no es de este bloque y
// todavía no existe, así que B04 lo pone en el layout de SU ruta en vez de
// dejar el hilo —la pantalla donde más se lee dolor ajeno— sin él. Cuando el
// layout del grupo llegue con su propio `BotonCrisis`, este archivo sobra y se
// borra; hasta entonces, de más antes que de menos. Anotado en PEDIDOS.md.
// ============================================================================

import type { ReactNode } from 'react'
import { BotonCrisis } from '@/components/ui'

export default function LayoutPost({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BotonCrisis />
    </>
  )
}
