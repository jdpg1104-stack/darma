import type { MetadataRoute } from 'next'

// El import es relativo y con extensión (no `@/lib/...`) a propósito: así el
// test colocado (`app/sitemap.test.ts`) puede cargar este módulo con
// `node --test --experimental-strip-types`, que no resuelve los alias de
// tsconfig. Next lo acepta igual (`allowImportingTsExtensions`).
import {
  DOCUMENTOS_LEGALES,
  ORDEN_DOCUMENTOS,
  rutaDocumento,
} from '../lib/privacy/textos.ts'

// ============================================================================
// Sitemap: SOLO la superficie pública.
//
// Darma es una red anónima de apoyo emocional: que un desahogo no aparezca en
// un buscador no es una preferencia de SEO, es una promesa de privacidad. Por
// eso este archivo enumera una lista blanca cerrada — la portada, el acceso,
// la ayuda de crisis y los textos legales — y NADA se añade por convención ni
// por recorrido del árbol de rutas. Todo lo demás (/feed, /post, /perfil, …)
// vive tras el gate de sesión de proxy.ts y además está vetado en app/robots.ts.
//
// Las rutas legales no van escritas a mano: salen de `ORDEN_DOCUMENTOS`, la
// misma fuente que genera el índice de /legal. Si mañana se añade un documento
// a lib/privacy/textos.ts, aparece aquí solo, con su fecha real de revisión.
// ============================================================================

/**
 * Origen canónico del sitio. Mismo patrón que `urlDelSitio()` en
 * lib/auth/peticion.ts, pero sin `Request` de la que caer: un sitemap se
 * genera sin petición, así que el único fallback posible es el de desarrollo.
 */
function urlBaseDelSitio(): string {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return configurada || 'http://localhost:3000'
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = urlBaseDelSitio()

  // Las cuatro puertas públicas. `/offline` NO está aunque proxy.ts la deje
  // pasar: es una página utilitaria del service worker, no un destino.
  const puertas: MetadataRoute.Sitemap = [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/entrar` },
    { url: `${base}/ayuda` },
    { url: `${base}/legal` },
  ]

  const legales: MetadataRoute.Sitemap = ORDEN_DOCUMENTOS.map((tipo) => ({
    url: `${base}${rutaDocumento(tipo)}`,
    // La fecha de «Última actualización» que ya muestra la propia página.
    lastModified: DOCUMENTOS_LEGALES[tipo].actualizadoEn,
  }))

  return [...puertas, ...legales]
}
