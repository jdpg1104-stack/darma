import type { MetadataRoute } from 'next'

// ============================================================================
// robots.txt: la promesa de privacidad, dicha también a los rastreadores.
//
// Todas estas rutas ya exigen sesión en proxy.ts (fail-closed), así que un
// crawler educado recibiría una redirección a /entrar de todos modos. Este
// archivo existe por dos razones que el gate no cubre:
//
//   1. Que ningún buscador indexe siquiera la EXISTENCIA de las superficies
//      privadas (/feed, /post/…, /perfil/…). En una app de salud mental, que
//      un desahogo o un perfil no sean indexables es privacidad, no SEO.
//   2. Que el presupuesto de rastreo se quede en lo único que queremos que se
//      comparta bien: la portada, la ayuda de crisis y los textos legales.
//
// La lista se mantiene A MANO y en espejo del test colocado
// (app/robots.test.ts): una ruta privada nueva se añade aquí y allí, y el test
// de coherencia comprueba que nada de lo que anuncia app/sitemap.ts quede
// vetado aquí.
// ============================================================================

/** Mismo patrón que en app/sitemap.ts (y que `urlDelSitio()` de
 *  lib/auth/peticion.ts): variable de entorno o fallback de desarrollo. */
function urlBaseDelSitio(): string {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return configurada || 'http://localhost:3000'
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // La portada y todo lo que no esté vetado abajo: /entrar, /ayuda y
        // /legal/* quedan permitidos sin listarlos uno a uno.
        allow: '/',
        disallow: [
          // Toda la API: JSON de sesión, cron, webhooks, métricas.
          '/api/',
          // Callback de Supabase Auth: llega sin sesión, pero es maquinaria.
          '/auth/',
          // Superficies con contenido de personas. `/post/` con barra final:
          // no existe un índice /post, solo /post/<id>.
          '/feed',
          '/animo',
          '/publicar',
          '/post/',
          '/perfil',
          '/refugios',
          '/ranking',
          '/onboarding',
          // Panel de administración completo (grupo (admin) de app/).
          '/panel',
          '/moderacion',
          '/encuestas',
          // Página utilitaria del service worker: pública, pero no un destino.
          '/offline',
        ],
      },
    ],
    sitemap: `${urlBaseDelSitio()}/sitemap.xml`,
  }
}
