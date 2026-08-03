import type { NextConfig } from 'next'

// ─────────────────────────────────────────────────────────────────────────────
// Darma · configuración de Next 16 (App Router) para Vercel.
//
// Las decisiones de seguridad de este archivo están adaptadas de un proyecto
// hermano ya en producción; los comentarios explican POR QUÉ existe cada
// directiva, que es lo único que evita que alguien la borre "porque no hacía
// nada" y rompa algo seis meses después.
// ─────────────────────────────────────────────────────────────────────────────

// El origen de Supabase se DERIVA de la variable de entorno en vez de escribirse
// a mano: así el mismo archivo vale para el proyecto de desarrollo, el de
// preview y el de producción sin tocar la CSP. Si la variable falta o está mal
// formada, caemos al comodín `*.supabase.co` de más abajo (degradación, no
// caída: preferimos una CSP algo más ancha que una app rota).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
let supabaseOrigin = ''
try {
  if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin
} catch {
  // URL malformada — se ignora y queda solo el comodín.
}

// ── Content-Security-Policy (en modo ENFORCE) ───────────────────────────────
// Regla de oro: todo lo que no esté aquí, el navegador lo bloquea. Si añades una
// integración nueva y "no carga y no da error", mira aquí antes que en el código.
// Para desbloquear temporalmente mientras investigas, cambia la clave de la
// cabecera de abajo a 'Content-Security-Policy-Report-Only'.
const csp = [
  // Todo lo no cubierto por una directiva específica: solo nuestro propio origen.
  "default-src 'self'",
  // Impide que una inyección de <base href> reescriba TODAS las URLs relativas
  // de la página hacia un dominio atacante.
  "base-uri 'self'",
  // Ni <object>, ni <embed>, ni <applet>. Darma no usa plugins; dejarlos
  // abiertos es superficie de ataque pura.
  "object-src 'none'",
  // Nadie puede meter Darma en un iframe → clickjacking descartado. Regula quién
  // nos embebe a NOSOTROS; es independiente de `frame-src` (qué embebemos).
  "frame-ancestors 'none'",
  // Imágenes: nuestras, data:/blob: (avatares generados en cliente a partir de
  // avatar_seed) y Supabase Storage (adjuntos y contenido curado). `i.ytimg.com`
  // = miniaturas de los vídeos de bienestar en la lista, antes de abrir el
  // reproductor. No se abre `https:` entero: solo los hosts que de verdad usamos.
  `img-src 'self' data: blob: ${supabaseOrigin} https://*.supabase.co https://i.ytimg.com`.trim(),
  // Reproductor de los vídeos curados de bienestar. Sin `frame-src` explícito
  // caería a `default-src 'self'` y el iframe saldría EN BLANCO sin error
  // visible. Solo el origen `youtube-nocookie` (no deja cookies de tracking al
  // usuario, que en una app de salud emocional no es un detalle menor).
  // Darma NO integra TikTok ni Instagram: sus embeds exigen cargar el script
  // propietario de la plataforma en nuestra página, lo que equivale a darles
  // telemetría de quién lee qué en una red de apoyo emocional. Descartado.
  "frame-src 'self' https://www.youtube-nocookie.com",
  // Tipografía del sistema, cero fuentes externas (ver app/layout.tsx). `data:`
  // cubre las fuentes embebidas por el propio bundle si alguna vez hace falta.
  "font-src 'self' data:",
  // 'unsafe-inline' sigue siendo necesario porque React escribe estilos inline.
  "style-src 'self' 'unsafe-inline'",
  // Ningún script de terceros. 'unsafe-inline'/'unsafe-eval' siguen aquí porque
  // los scripts de hidratación de Next todavía no están cableados con nonce;
  // migrarlos al nonce que ya emite proxy.ts es el siguiente paso de endurecido.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Auth, PostgREST y Realtime de Supabase (wss:// es el canal de tiempo real).
  `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co`.trim(),
  // Un formulario de la app no puede hacer POST a un dominio ajeno: corta el
  // clásico "formulario de login inyectado que manda las credenciales fuera".
  "form-action 'self'",
].join('; ')

const nextConfig: NextConfig = {
  compress: true,
  // No anunciar "X-Powered-By: Next.js": no aporta nada y facilita el
  // fingerprinting de versión a quien escanea.
  poweredByHeader: false,
  // Fija la raíz del workspace. Sin esto, Turbopack la infiere buscando
  // lockfiles hacia arriba y en un git worktree encuentra el del repo padre.
  turbopack: { root: process.cwd() },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    // Mismo host que ya confía la CSP en img-src. Sin esto, el optimizador de
    // <Image> rechaza cualquier URL remota y las imágenes de Storage se
    // servirían crudas, a tamaño completo y sin AVIF/WebP.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/**' },
      { protocol: 'https', hostname: 'i.ytimg.com', pathname: '/**' },
    ],
  },
  experimental: {
    // Tree-shaking real de los barrels que más se importan en toda la app.
    optimizePackageImports: ['@supabase/supabase-js', '@supabase/ssr'],
  },
  async headers() {
    const headers = [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HTTPS obligatorio durante un año, subdominios incluidos. Solo se
          // honra sobre HTTPS, así que es inocuo en http://localhost.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // ⚠️ CÁMARA Y MICRÓFONO DENEGADOS A NIVEL DE NAVEGADOR, a propósito.
          // Darma es anónima POR DISEÑO: nunca hay cara ni voz identificable.
          // No es una preferencia de producto que se pueda revertir a la ligera:
          // una grabación de voz es un identificador biométrico, y su sola
          // posibilidad cambiaría lo que la gente se atreve a contar aquí.
          // Si algún día se plantea audio, tiene que ser una decisión explícita
          // de producto Y de privacidad, no un cambio de una línea en este
          // archivo. Geolocalización y pagos, igualmente cerrados.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'Content-Security-Policy', value: csp },
          // Aísla el contexto de navegación: nada de compartir memoria ni
          // referencias de ventana con orígenes cruzados.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ]

    // Caché inmutable de un año SOLO en producción: allí Next pone un hash de
    // contenido en el nombre del chunk (cambio de código ⇒ hash nuevo ⇒ descarga
    // nueva). En desarrollo Turbopack usa nombres ESTABLES, así que esta
    // cabecera serviría JS rancio durante un año y rompería el HMR.
    if (process.env.NODE_ENV === 'production') {
      headers.push({
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      })
    }

    return headers
  },
}

export default nextConfig
