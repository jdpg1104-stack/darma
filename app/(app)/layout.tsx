import type { ReactNode } from 'react'

import { AvisoSinConexion, RegistroServiceWorker } from '@/components/pwa'
import { BotonCrisis } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'

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
// ── AVISO PERMANENTE DE NO-TERAPIA (pedido B20 → B16/F4) ───────────────────
// Por la misma garantía estructural se pinta aquí `legal.avisoNoTerapia`: la
// frase de `AVISO_NO_TERAPIA` (`lib/privacy/avisos.ts`), que debe verse en
// TODAS las pantallas con sesión, no solo en /legal. Es un `<footer>` de texto
// plano, sin JS, y el copy sale del CATÁLOGO —no del literal español— porque
// este layout se sirve en los dos idiomas. La prueba de este archivo vigila
// que no desaparezca, y `layout.test.ts` comprueba además que la clave española
// del catálogo sigue siendo palabra por palabra el texto de `avisos.ts`.
//
// A propósito NO lleva `<main>`: cada pantalla monta el suyo con su propio
// ancho, y anidar dos elementos `main` es HTML inválido y confunde a los
// lectores de pantalla.
// ============================================================================

export default async function LayoutApp({ children }: { children: ReactNode }) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <>
      {children}
      {/* Discreto a propósito (tokens de globals.css, nada de hex): presente
          siempre, protagonista nunca. El padding inferior deja sitio al botón
          de crisis flotante para que no tape la frase en móvil. */}
      <footer
        style={{
          color: 'var(--muted)',
          fontSize: 13,
          lineHeight: 1.6,
          textAlign: 'center',
          maxWidth: '46rem',
          margin: '0 auto',
          padding: '16px 20px calc(72px + env(safe-area-inset-bottom))',
        }}
      >
        <p style={{ margin: 0 }}>{t('legal.avisoNoTerapia')}</p>
      </footer>
      <AvisoSinConexion />
      <BotonCrisis posicion="flotante" />
      <RegistroServiceWorker />
    </>
  )
}
