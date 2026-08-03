// ============================================================================
// Layout del grupo (legal).
//
// ── DOS COSAS QUE PARECEN DETALLES Y NO LO SON ─────────────────────────────
//  1. Los paréntesis del grupo NO crean segmento de URL, así que las páginas
//     viven en `app/(legal)/legal/<doc>/page.tsx` y responden en `/legal/<doc>`.
//     Si estuvieran en `app/(legal)/<doc>/page.tsx` responderían en `/<doc>` y
//     `proxy.ts` —que solo declara pública la ruta `/legal`— las dejaría detrás
//     del login: exactamente lo contrario de lo que necesitan, porque estos
//     textos hay que poder leerlos ANTES de registrarse.
//  2. Server Component puro, sin estado y sin eventos: cero KB de JavaScript de
//     cliente. Una página legal que necesita JS para leerse es una página legal
//     que alguien no va a leer.
// ============================================================================

import Link from 'next/link'

export default function LayoutLegal({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        padding: 'max(24px, env(safe-area-inset-top)) 20px max(48px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <Link
            href="/legal"
            style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: 14 }}
          >
            ← Documentos legales de Darma
          </Link>
        </header>

        <main id="contenido">{children}</main>

        <footer
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: '1px solid var(--line)',
            color: 'var(--muted)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: 0 }}>
            Si ahora mismo estás en peligro, no esperes a terminar de leer esto:{' '}
            <a href="/ayuda" style={{ color: 'var(--ink)' }}>
              aquí tienes los teléfonos de ayuda
            </a>
            . El 112 funciona en toda la Unión Europea y el 024 es gratuito en España, las
            veinticuatro horas.
          </p>
        </footer>
      </div>
    </div>
  )
}
