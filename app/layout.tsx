import type { Metadata, Viewport } from 'next'
import './globals.css'

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { ProveedorIdioma } from '@/i18n/Proveedor'

// ─────────────────────────────────────────────────────────────────────────────
// Layout raíz.
//
// SIN next/font, SIN <link> a Google Fonts, SIN scripts de terceros. No es una
// omisión: la CSP de next.config.ts los bloquea a propósito. Toda la tipografía
// es la pila del sistema (ver --font-sans en app/globals.css). En una red de
// apoyo emocional anónima, cada petición a un tercero es un tercero que puede
// saber que esta persona estuvo aquí — y eso vale más que una fuente bonita.
// ─────────────────────────────────────────────────────────────────────────────

// Los textos de compartir (OG/Twitter) viven en `comun.og.*` de messages/*.json,
// como todo el copy. Llegaron a estar hardcodeados aquí en los dos idiomas
// porque el bloque de SEO no podía tocar los catálogos mientras otro los
// editaba en paralelo; la deuda quedó anotada en PEDIDOS.md y ya está pagada.
// Son el lema del README («escuchar es lo que da derecho a hablar»).

/** Mismo patrón que `urlDelSitio()` en lib/auth/peticion.ts, sin `Request` de
 *  la que caer: el fallback es el de desarrollo, como en app/sitemap.ts. */
function urlBaseDelSitio(): string {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return configurada || 'http://localhost:3000'
}

// Era un `export const metadata` fijo en español; pasa a función por el mismo
// motivo que el `lang` del documento: una tarjeta de compartir en un idioma
// que la persona no entiende es media landing perdida. En las páginas
// `force-static` (los legales) `resolverLocale()` ve cookies vacías y cae al
// locale por defecto — exactamente lo que ya hacía el cuerpo del layout.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolverLocale()
  // Mismo patrón que app/ayuda/page.tsx: traductor propio en servidor, sin hook.
  const t = obtenerTraductor(locale)

  return {
    // Con esto, cualquier URL relativa del árbol de metadata (canónicos, og)
    // se resuelve contra el dominio real y no contra el del deploy interno.
    metadataBase: new URL(urlBaseDelSitio()),
    title: {
      default: 'Darma',
      // Las páginas internas ponen su propio título; esta plantilla les añade
      // la marca sin que cada una tenga que acordarse.
      template: '%s · Darma',
    },
    description: t('comun.og.descripcion'),
    applicationName: 'Darma',
    // Anonimato por diseño: no se indexa nada más allá de la portada pública,
    // y el contenido de la gente no aparece jamás en un buscador. Las rutas
    // privadas ya están tras el gate del proxy; esto es el cinturón además de
    // los tirantes (y app/robots.ts, los tirantes además del cinturón).
    robots: {
      index: true,
      follow: true,
      nosnippet: true,
      noarchive: true,
    },
    // Sin `referrer` hacia fuera: si alguien pulsa un enlace externo, el sitio
    // de destino no debe recibir la URL desde la que venía.
    referrer: 'strict-origin-when-cross-origin',
    formatDetection: {
      // Evita que iOS convierta números y direcciones del cuerpo de un
      // desahogo en enlaces de teléfono o mapas.
      telephone: false,
      address: false,
      email: false,
    },
    openGraph: {
      type: 'website',
      siteName: 'Darma',
      title: t('comun.og.titulo'),
      description: t('comun.og.descripcion'),
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      alternateLocale: locale === 'es' ? 'en_US' : 'es_ES',
      // SIN `images` a propósito: no existe un og.png real. Anunciar una
      // imagen rota es peor que no anunciar ninguna (ver PEDIDOS).
    },
    twitter: {
      // `summary`, no `summary_large_image`: la tarjeta grande exige una
      // imagen 1200×630 que todavía no hay.
      card: 'summary',
      title: t('comun.og.titulo'),
      description: t('comun.og.descripcion'),
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Los dos valores para que la barra del navegador acompañe al tema activo.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
    { media: '(prefers-color-scheme: light)', color: '#f6f8fb' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // El locale se resuelve una sola vez, aquí, y sirve para dos cosas distintas:
  // el atributo `lang` del documento y el traductor de los componentes de
  // cliente. Estaba fijado a "es", y no es un detalle: un lector de pantalla
  // anuncia el texto inglés con fonética española, y el traductor automático del
  // navegador se ofrece a traducir a un idioma que ya es el del usuario.
  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        {/* Salto al contenido: primer elemento enfocable de la página, para
            quien navega con teclado o lector de pantalla. */}
        <a href="#contenido" className="sr-only">
          {t('comun.saltarAlContenido')}
        </a>
        <ProveedorIdioma locale={locale}>{children}</ProveedorIdioma>
      </body>
    </html>
  )
}
