import type { ReactNode } from 'react'

import { BotonCrisis } from '@/components/ui'

// ============================================================================
// Layout de `app/(app)` — todo lo que hay detrás de la sesión.
//
// Existe por una sola razón, y no es de maquetación: **el botón de crisis tiene
// que estar en todas las pantallas** (CONTRATOS §9). Hasta ahora se montaba por
// repetición en siete layouts, uno por bloque, porque este archivo no era de
// nadie. Eso funciona para las siete pantallas que existen hoy y falla para la
// que se añada mañana: quien cree una ruta nueva no tiene forma de enterarse de
// que le falta algo, porque nada se rompe. Simplemente no está el botón.
//
// Aquí arriba, la garantía es estructural: cualquier ruta bajo `(app)` lo hereda
// sin que su autor tenga que saber que existe.
//
// A propósito NO lleva `<main>`: cada pantalla monta el suyo con su propio
// ancho, y anidar dos elementos `main` es HTML inválido y confunde a los
// lectores de pantalla.
// ============================================================================

export default function LayoutApp({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BotonCrisis posicion="flotante" />
    </>
  )
}
