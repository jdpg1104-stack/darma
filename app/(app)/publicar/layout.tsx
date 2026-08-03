// ============================================================================
// Layout de /publicar
//
// Existe por una sola razón obligatoria: `BotonCrisis` tiene que estar presente
// en el layout de toda ruta de `app/(app)` (CONTRATOS §9, último párrafo). Y de
// todas las pantallas de Darma, esta es donde menos se puede olvidar: es la
// única en la que alguien está escribiendo, ahora mismo, lo que le pasa.
//
// El botón se monta en el LAYOUT y no dentro del composer a propósito. Si
// viviera en el componente, desaparecería en cuanto el composer cambia de
// estado —al confirmar la publicación, por ejemplo—, y ese es exactamente el
// momento en que alguien que acaba de escribir algo grave podría necesitarlo.
// En el layout está siempre, pase lo que pase con el árbol de abajo.
//
// ⚠️ Este archivo NO es `app/(app)/layout.tsx`. Ese pertenece a la capa base
// (F4/B00) y lo comparten el feed (B02), el hilo (B04) y el perfil (B05); B03 no
// lo toca. Cuando exista, este layout quedará anidado dentro y `BotonCrisis`
// aparecerá dos veces: el componente lo contempla con `posicion`, y si molesta,
// el que sobra es este — se retira en una línea. Anotado en HANDOFF/PEDIDOS.md.
// ============================================================================

import type { ReactNode } from 'react'

export default function LayoutPublicar({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
    </>
  )
}
