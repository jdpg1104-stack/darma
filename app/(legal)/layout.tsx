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
//
// ── EL PIE DE CRISIS: POR QUÉ ES INTERNACIONAL Y NO POR PAÍS ───────────────
// Este pie citaba «el 112 en toda la Unión Europea y el 024 en España» a todo el
// mundo. Contradice la regla dura del proyecto: el teléfono es un dato NACIONAL.
// A quien lee las condiciones desde México el 024 no le sirve, y —peor— ocupa el
// sitio del número que sí le serviría.
//
// El pie llama ahora a `recursosParaPais(await resolverPais())`, como todo el
// mundo. Bajo `force-static` `resolverPais()` devuelve `null` —Next entrega
// cookies y cabeceras vacías— así que en la práctica SIEMPRE cae al bloque
// INTERNACIONAL. Se ha elegido eso a conciencia, en vez de volver la ruta
// dinámica:
//
//   · Estas páginas se sirven prerenderizadas desde el CDN: se leen aunque la
//     base de datos esté caída, aunque el runtime falle y sin sesión. Una página
//     legal que necesita que la app funcione es una página que no se puede
//     enseñar el día que hay que enseñarla. Volverla dinámica cambia
//     DISPONIBILIDAD —lo único que este grupo de rutas garantiza— por precisión
//     geográfica en un pie de página.
//   · El coste es pequeño y acotado: el pie internacional no es un pie
//     equivocado. Dice «si hay peligro inmediato, llama al número de emergencias
//     de tu país», que es cierto en todos ellos, y el enlace a `/ayuda` está a
//     una pulsación. `/ayuda` sí es `force-dynamic`, sí resuelve el país de
//     verdad y es la pantalla a la que empuja el botón de crisis: ahí están los
//     números. Este pie es un recordatorio de salida, no la pantalla de crisis.
//   · Un pie por país sobre una ruta cacheada exigiría además que la respuesta
//     no se compartiera entre países. Mal cacheado enseñaría el número del
//     primer visitante a todos los demás: peor que el internacional.
//   · El pie hereda el mismo español fijo que el resto del grupo mientras
//     `force-static` siga puesto; se resolverá con la misma decisión, no con
//     otra distinta.
//
// El código NO da nada de esto por supuesto: si algún día `/legal` deja de ser
// estático, el pie pasa a mostrar las emergencias del país sin tocar una línea.
// Lo que se ha eliminado es la posibilidad de escribir un número a mano.
//

import Link from 'next/link'

import { obtenerTraductor, recursosParaPais, resolverLocale, resolverPais } from '@/i18n'

export default async function LayoutLegal({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, pais] = await Promise.all([resolverLocale(), resolverPais()])
  const t = obtenerTraductor(locale)

  // Regla dura del proyecto: los teléfonos salen SIEMPRE de
  // `recursosParaPais(await resolverPais())`, nunca escritos a mano y nunca
  // derivados del idioma. Bajo `force-static` esto resuelve `INTERNACIONAL`
  // (ver la nota de arriba), que es justo lo que este pie necesita.
  const { recursos } = recursosParaPais(pais)
  const emergencias = recursos.find((r) => r.tipo === 'emergencias') ?? null

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
            .
          </p>
          <p style={{ margin: '8px 0 0' }}>
            {emergencias === null ? (
              // Bloque internacional: la instrucción SUSTITUYE al número que no
              // podemos saber. No se inventa ninguno.
              t('crisis.ayuda.internacionalUrgente')
            ) : (
              <>
                {t('crisis.recursos.emergencias')}{' '}
                {/* Nombre y número son datos oficiales del país: no se traducen
                    ni se reformatean (`i18n/recursosCrisis.ts`). El texto queda
                    visible además del `tel:`, que en escritorio no hace nada. */}
                <a href={`tel:${emergencias.valor}`} style={{ color: 'var(--ink)' }}>
                  {emergencias.nombre} · {emergencias.valor}
                </a>
              </>
            )}
          </p>
        </footer>
      </div>
    </div>
  )
}
