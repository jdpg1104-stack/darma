import type { CSSProperties } from 'react'
import Link from 'next/link'

import { obtenerTraductor, resolverLocale } from '@/i18n'

// ============================================================================
// 404 de toda la aplicación.
//
// ── QUÉ HABÍA ANTES ─────────────────────────────────────────────────────────
// Nada. Sin este archivo, Next sirve su 404 de fábrica: «404 | This page could
// not be found», en inglés, sin estilo, sin navegación y —lo que de verdad
// importa aquí— SIN NINGUNA FORMA DE LLEGAR A /ayuda.
//
// No es una pantalla rara. Hay nueve `notFound()` en el repo y todos caían aquí:
// un post retirado por moderación, un perfil que ya no existe, un refugio del
// que no eres miembro, el panel de administración sin el rol. El caso concreto
// que hay que tener en la cabeza al leer este archivo: alguien pulsa una
// notificación push de un post que entre medias se borró. Abre la aplicación a
// las tres de la mañana, esperando una conversación, y se encuentra un callejón
// sin salida en un idioma que puede que ni siquiera lea.
//
// ── LAS TRES DECISIONES ─────────────────────────────────────────────────────
//
//  1. **Enlace visible a /ayuda.** Es la razón de ser de este archivo. La raíz
//     de `app/` está FUERA del grupo `(app)`, así que el `BotonCrisis` que monta
//     `app/(app)/layout.tsx` no llega hasta aquí: una pantalla de error de la
//     raíz es justo una de las poquísimas de Darma donde el botón de crisis no
//     aparece solo. Por eso el enlace se escribe a mano, y por eso lleva su
//     propia explicación de una línea en vez de ser un icono suelto.
//
//  2. **Server Component y cero JavaScript de cliente.** El idioma se resuelve
//     con `obtenerTraductor(await resolverLocale())`, igual que en `/ayuda`. Con
//     `useTraductor()` habría que marcar el archivo `'use client'` y esta
//     pantalla dejaría de funcionar sin bundle — precisamente el escenario en el
//     que es más probable acabar en un 404.
//
//  3. **Sin `<Suspense>` y sin `loading.tsx`.** Ver `app/SIN-LOADING.md`: el
//     layout raíz es asíncrono y cualquier límite de Suspense por debajo mata la
//     hidratación de toda la aplicación sin que falle ni un test.
//
// ── ALTERNATIVAS DESCARTADAS ────────────────────────────────────────────────
//
//  · **Redirigir a /feed.** Se descartó por dos motivos. El 404 dejaría de ser
//    un 404 (malo para el buscador y para quien depura), y sobre todo: `/feed`
//    exige sesión, así que a quien llega desde un enlace compartido sin haber
//    entrado se le contestaría con un login. Un muro de login no es una
//    respuesta a «esto ya no está».
//
//  · **Reusar `EstadoVacio` de `components/ui`.** Encaja de tono, pero pinta un
//    `<h2>`: en una pantalla que ES la página entera, el primer encabezado tiene
//    que ser `<h1>` o el documento se queda sin título para un lector de
//    pantalla. Se prefirió HTML plano antes que un componente ajeno con una
//    prop nueva que habría que pedir en `HANDOFF/PEDIDOS.md`.
//
//  · **Un CSS Module propio.** Es lo que haría cualquier otra pantalla, pero
//    estos tres archivos se escribieron en una sesión que solo posee estos tres
//    archivos, y `global-error.tsx` (que comparte esta misma pinta) no puede
//    depender de que una hoja de estilos haya llegado a cargarse. Los estilos
//    van en línea y TODO color sale de una variable de `app/globals.css`
//    (CONTRATOS §10: ningún hex escrito a mano). Si algún día esto crece,
//    el sitio es un `app/pantallas-limite.module.css`.
// ============================================================================

// El texto sale del catálogo según cookie `darma_idioma` → `Accept-Language`,
// así que esta pantalla se renderiza por petición. Explícito a propósito: sin
// esto, un futuro `force-static` (o el prerender de `/_not-found`) serviría el
// 404 congelado en español a todo el mundo, que es la mitad del problema que
// este archivo viene a arreglar.
export const dynamic = 'force-dynamic'

const PAGINA: CSSProperties = {
  maxWidth: '520px',
  margin: '0 auto',
  padding: '72px 20px 48px',
}

const TITULO: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '24px',
  lineHeight: 1.25,
  color: 'var(--ink)',
}

const CUERPO: CSSProperties = {
  margin: '0 0 28px',
  color: 'var(--muted)',
  fontSize: '15.5px',
  lineHeight: 1.6,
}

const VOLVER: CSSProperties = {
  display: 'inline-block',
  minHeight: 'var(--touch, 44px)',
  padding: '12px 20px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-pill, 999px)',
  color: 'var(--ink)',
  textDecoration: 'none',
  fontWeight: 600,
}

// El bloque de ayuda va SEPARADO del resto por una línea, y no por estética:
// tiene que leerse como algo distinto de «vuelve al inicio», porque no compite
// con ello. Borde en --danger igual que el `BotonCrisis`; nunca --accent, que
// está reservado a la acción primaria de cada pantalla.
const AYUDA: CSSProperties = {
  marginTop: '40px',
  paddingTop: '24px',
  borderTop: '1px solid var(--line)',
}

const AYUDA_ENLACE: CSSProperties = {
  display: 'inline-block',
  minHeight: 'var(--touch, 44px)',
  padding: '12px 20px',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-pill, 999px)',
  background: 'var(--panel)',
  color: 'var(--ink)',
  textDecoration: 'none',
  fontWeight: 700,
}

const AYUDA_PIE: CSSProperties = {
  margin: '12px 0 0',
  color: 'var(--muted)',
  fontSize: '14px',
  lineHeight: 1.55,
}

export default async function NoEncontrado() {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <main id="contenido" style={PAGINA}>
      <h1 style={TITULO}>{t('comun.noEncontrado.titulo')}</h1>
      <p style={CUERPO}>{t('comun.noEncontrado.descripcion')}</p>

      {/* `Link` y no `<a>` solo aquí: la portada es una ruta de la aplicación y
          `next/link` la prefetch-ea y navega sin recargar. Sigue emitiendo un
          `<a href="/">` real en el HTML, así que también funciona sin JS. */}
      <Link href="/" style={VOLVER}>
        {t('comun.irAlInicio')}
      </Link>

      {/* Para /ayuda, en cambio, un `<a href>` de toda la vida: si el bundle no
          ha hidratado —o nunca llega— el enlace sigue llevando a los teléfonos,
          y `/ayuda` es un Server Component sin una línea de JS que no gana nada
          con una navegación de cliente. Mismo razonamiento que la cabecera de
          `BotonCrisis`. */}
      <section style={AYUDA}>
        <a href="/ayuda" style={AYUDA_ENLACE}>
          {t('comun.atajoAyuda.enlace')}
        </a>
        <p style={AYUDA_PIE}>{t('comun.atajoAyuda.pie')}</p>
      </section>
    </main>
  )
}
