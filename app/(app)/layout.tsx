import type { ReactNode } from 'react'

import { AvisoSinConexion, RegistroServiceWorker } from '@/components/pwa'
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
// ── CAPA PWA (B13) ─────────────────────────────────────────────────────────
// Por el mismo motivo estructural se montan aquí las dos piezas globales de
// `components/pwa`:
//
//  · `RegistroServiceWorker` registra `/sw.js` UNA sola vez para toda la app
//    con sesión. Renderiza `null`. Sin este registro no hay precache, y sin
//    precache **`/ayuda` no funciona sin cobertura** — que es la única razón
//    por la que este bloque tiene service worker.
//  · `AvisoSinConexion` es el banner fijo de «sin conexión», con el enlace a
//    `/ayuda` (que sí está cacheada).
//
// Los otros dos componentes del barril NO van aquí, y es una decisión:
//  · `OptInPush` está PROHIBIDO en un layout (ver su cabecera): pedir permiso
//    de notificaciones al cargar quema el origen de forma permanente. Se monta
//    en el momento oportuno (primer comentario validado, primera Alma Afín).
//  · `BotonInstalar` pertenece a ajustes/perfil, no a un flotante global.
// Ambos montajes están pedidos a sus dueños en HANDOFF/PEDIDOS.md.
//
// A propósito NO lleva `<main>`: cada pantalla monta el suyo con su propio
// ancho, y anidar dos elementos `main` es HTML inválido y confunde a los
// lectores de pantalla.
// ============================================================================

export default function LayoutApp({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AvisoSinConexion />
      <BotonCrisis posicion="flotante" />
      <RegistroServiceWorker />
    </>
  )
}
