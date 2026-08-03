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
//     que alguien no va a leer. Por eso el idioma se resuelve con
//     `obtenerTraductor(await resolverLocale())` y no con `useTraductor()`.
//
// ⚠️ LAS PÁGINAS DE ESTE GRUPO SON `force-static`. Bajo esa configuración Next
// devuelve cookies y cabeceras vacías, así que `resolverLocale()` cae al idioma
// por defecto y todo `/legal/**` se sirve en español aunque la persona tenga la
// interfaz en inglés. Es lo mismo que ya le pasa al `lang` del `<html>` en
// `app/layout.tsx` sobre estas rutas. Traducir esto de verdad exige decidir si
// `/legal` deja de ser estático — y esa decisión (una página legal tiene que
// poder leerse cuando la app está caída) no es de este encargo. Anotado en el
// resumen de la migración.
// ============================================================================

import Link from 'next/link'

import { obtenerTraductor, resolverLocale } from '@/i18n'

export default async function LayoutLegal({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = obtenerTraductor(await resolverLocale())

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
            ← {t('legal.volverAlIndice')}
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
            {t('legal.pie.antes')}{' '}
            <a href="/ayuda" style={{ color: 'var(--ink)' }}>
              {t('legal.pie.enlace')}
            </a>
            {t('legal.pie.despues')}
          </p>
        </footer>
      </div>
    </div>
  )
}
