import type { Metadata } from 'next'

import { LOCALES, obtenerTraductor } from '@/i18n'

import estilos from './offline.module.css'

// ============================================================================
// /offline — la caída de la navegación sin red.
//
// `public/sw.js` la precachea en el `install` y la sirve cuando alguien navega
// sin cobertura a una ruta que no está en caché. Eso impone todas las
// decisiones de este archivo:
//
//  1. **`force-static` y ni una línea de JavaScript de cliente propio.** La
//     página se cachea UNA vez, en la instalación del service worker, y tiene
//     que pesar casi nada: cada byte de aquí es un byte que se descarga en la
//     primera visita de todo el mundo. Nada que hidratar, nada que pueda
//     fallar sin red.
//
//  2. **Los DOS idiomas a la vez, como una tarjeta de seguridad de avión.**
//     Bajo `force-static`, `cookies()` y `headers()` devuelven vacío, así que
//     `resolverLocale()` daría siempre `es`: no existe «el idioma de la
//     petición» en una página que se genera una sola vez para todo el mundo.
//     En vez de dejar a quien lee en inglés ante un mensaje que no entiende,
//     se pintan los dos bloques, cada uno con su atributo `lang` para que el
//     lector de pantalla pronuncie cada idioma con su fonética. El copy sale
//     del catálogo (`comun.pwa.*`, claves que ya existían): aquí no hay ni un
//     literal a pelo, y el guard de i18n lo vigila.
//
//  3. **El enlace a `/ayuda` es la razón de ser de la página.** `/ayuda`
//     también está en el precache: es el único destino que se puede prometer
//     sin red, y es el que importa — quien está en riesgo en un túnel tiene
//     que poder llegar a un teléfono al que llamar.
//
//  4. **`robots: noindex`.** Una pantalla de utilidad del service worker no
//     pinta nada en un buscador.
// ============================================================================

export const dynamic = 'force-static'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function PaginaSinConexion() {
  return (
    <main className={estilos.pagina} id="contenido">
      {LOCALES.map((locale) => {
        const t = obtenerTraductor(locale)
        return (
          <section key={locale} lang={locale} className={estilos.bloque}>
            <p className={estilos.mensaje}>
              <span className={estilos.punto} aria-hidden="true" />
              {t('comun.pwa.sinConexion')}
            </p>
            {/* <a> plano y no <Link>: sin red no hay prefetch que valga, y el
                destino tiene que resolverlo el service worker desde su caché. */}
            <a className={estilos.enlace} href="/ayuda">
              {t('comun.pwa.verAyuda')}
            </a>
          </section>
        )
      })}
    </main>
  )
}
