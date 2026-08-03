import type { Metadata, Viewport } from 'next'
import './globals.css'

// ─────────────────────────────────────────────────────────────────────────────
// Layout raíz.
//
// SIN next/font, SIN <link> a Google Fonts, SIN scripts de terceros. No es una
// omisión: la CSP de next.config.ts los bloquea a propósito. Toda la tipografía
// es la pila del sistema (ver --font-sans en app/globals.css). En una red de
// apoyo emocional anónima, cada petición a un tercero es un tercero que puede
// saber que esta persona estuvo aquí — y eso vale más que una fuente bonita.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: {
    default: 'Darma',
    // Las páginas internas ponen su propio título; esta plantilla les añade la
    // marca sin que cada una tenga que acordarse.
    template: '%s · Darma',
  },
  description:
    'Red social anónima de crecimiento emocional basada en reciprocidad',
  applicationName: 'Darma',
  // Anonimato por diseño: no se indexa nada más allá de la portada pública, y
  // el contenido de la gente no aparece jamás en un buscador. Las rutas
  // privadas ya están tras el gate del proxy; esto es el cinturón además de los
  // tirantes.
  robots: {
    index: true,
    follow: true,
    nosnippet: true,
    noarchive: true,
  },
  // Sin `referrer` hacia fuera: si alguien pulsa un enlace externo, el sitio de
  // destino no debe recibir la URL desde la que venía.
  referrer: 'strict-origin-when-cross-origin',
  formatDetection: {
    // Evita que iOS convierta números y direcciones del cuerpo de un desahogo
    // en enlaces de teléfono o mapas.
    telephone: false,
    address: false,
    email: false,
  },
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        {/* Salto al contenido: primer elemento enfocable de la página, para
            quien navega con teclado o lector de pantalla. */}
        <a href="#contenido" className="sr-only">
          Saltar al contenido principal
        </a>
        {children}
      </body>
    </html>
  )
}
