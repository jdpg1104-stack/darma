'use client'

import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'

import './globals.css'
import { obtenerTraductor } from '@/i18n/traductor'
import { LOCALE_POR_DEFECTO, esLocale, idiomaBase, type Locale } from '@/i18n/routing'

// ============================================================================
// El último recurso: el layout raíz se ha roto.
//
// `app/error.tsx` recoge lo que falla DENTRO del árbol. Este archivo recoge lo
// que falla al construir el árbol: un fallo en `app/layout.tsx` mismo, o en algo
// de lo que el layout raíz depende (`resolverLocale()`, `ProveedorIdioma`, la
// hoja global). React no puede pintar un hijo de un padre que acaba de reventar,
// así que Next sustituye el documento ENTERO por este componente — de ahí que
// tenga que traer su propio `<html>` y su propio `<body>`.
//
// Es la pantalla menos probable de Darma y la que menos margen tiene: si esto
// también falla, lo que queda es una página en blanco. Todo lo de abajo es
// consecuencia de eso.
//
// ── QUÉ SE PERMITE IMPORTAR AQUÍ, Y POR QUÉ ─────────────────────────────────
// Regla: solo módulos PUROS. Nada que lea la petición, la sesión, la base de
// datos ni el contexto de React del layout roto.
//
//  · `@/i18n/traductor` y `@/i18n/routing` son funciones puras sobre dos JSON
//    importados estáticamente. No tocan `next/headers` (esa es justamente la
//    razón por la que `traductor.ts` vive separado del barril `@/i18n` — ver su
//    cabecera) y ya viajan en el bundle de cliente por `ProveedorIdioma`, así
//    que no añaden un byte.
//  · `./globals.css` es un archivo estático: no se puede «romper», solo no
//    llegar. Y si no llega, esta pantalla sigue siendo legible: sin la hoja no
//    hay `--bg` oscuro en el `<body>` NI `--ink` claro en el texto, así que
//    quedan los colores por defecto del navegador (negro sobre blanco). Los dos
//    escenarios son coherentes; lo que había que evitar es el intermedio.
//  · NO se importa `@/i18n` (el barril arrastra `next/headers`), ni
//    `@/i18n/Proveedor` (su contexto lo monta el layout que ha fallado), ni
//    `components/ui` (sus CSS Modules son otra hoja que puede no haber llegado).
//
// ── EL IDIOMA ───────────────────────────────────────────────────────────────
// Si el layout raíz ha caído, `resolverLocale()` puede ser exactamente lo que
// falló, y en cualquier caso no se puede llamar: es asíncrono y de servidor, y
// esto es un componente de cliente.
//
// El brief admitía texto fijo en español aquí. Se hace algo un poco mejor, y en
// dos tiempos, porque no cuesta casi nada y en Darma la mitad de la gente puede
// no leer español:
//
//   1. En servidor y durante la hidratación se usa `LOCALE_POR_DEFECTO` ('es').
//   2. Ya montado, se lee `navigator.language` —que es del NAVEGADOR y no de la
//      petición, así que sobrevive a que el servidor esté mal— y se cambia a
//      'en' si procede. En el peor caso se ve un parpadeo de español a inglés
//      en una pantalla que ya es un desastre.
//
// El mecanismo es `useSyncExternalStore` y no `useEffect` + `setState`, que es
// lo primero que se escribió: esa versión funciona pero la marca
// `react-hooks/set-state-in-effect`, y con razón —es un render en cascada—.
// `useSyncExternalStore` es la API que React tiene exactamente para esto: se le
// dan las DOS instantáneas, la del servidor y la del cliente, y React se encarga
// de hidratar con la primera y cambiar a la segunda sin desajuste. Sale más
// corto, sin `eslint-disable` y sin estado que mantener.
//
// Si el JavaScript nunca arranca, se queda el español del paso 1, que es
// exactamente el mínimo que el brief daba por aceptable. El texto vive en el
// catálogo (`comun.errorGrave.*`) y no escrito a pelo, para que exista en los
// dos idiomas y lo cubran los guards de paridad de `i18n/claves.test.ts`.
//
// ── LO DEMÁS ────────────────────────────────────────────────────────────────
//
//  · **Enlace visible a /ayuda.** Es la razón de ser de este trabajo. Aquí no
//    hay layout, luego no hay `BotonCrisis`, y quien llega puede estar en mal
//    momento. `/ayuda` es pública en `proxy.ts`, es un Server Component sin una
//    línea de JS y sus teléfonos son enlaces `tel:`: funciona sin sesión, sin
//    base de datos y sin bundle. Es literalmente lo único de la aplicación que
//    se puede prometer que sigue en pie cuando esta pantalla aparece.
//  · **NUNCA se pinta `error.message`** (misma regla que los otros tres límites
//    de error del repo). Solo el `digest`, que es opaco.
//  · **Estilos en línea, con variables.** Un CSS Module es otra hoja más que
//    podría no cargar; y aun así no se escribe ningún hex a mano (CONTRATOS
//    §10): todo sale de un token de `globals.css`, con degradación limpia al
//    valor por defecto del navegador si la hoja no llegó.
//  · **Sin `<Suspense>`**, como en todo el proyecto (`app/SIN-LOADING.md`).
// ============================================================================

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

const ACCIONES: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  alignItems: 'center',
}

const RECARGAR: CSSProperties = {
  minHeight: 'var(--touch, 44px)',
  padding: '12px 20px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-pill, 999px)',
  background: 'var(--panel)',
  color: 'var(--ink)',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
}

const INICIO: CSSProperties = {
  minHeight: 'var(--touch, 44px)',
  padding: '12px 4px',
  color: 'var(--muted)',
  fontWeight: 600,
}

const REFERENCIA: CSSProperties = {
  margin: '16px 0 0',
  color: 'var(--muted)',
  fontSize: '12.5px',
  fontFamily: 'var(--font-mono, monospace)',
  overflowWrap: 'anywhere',
}

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

// El `<body>` puede quedarse sin la hoja global: se le repite aquí lo mínimo
// para que el texto no salga pegado al borde ni con la fuente serif por defecto.
const CUERPO_DOC: CSSProperties = {
  margin: 0,
  minHeight: '100dvh',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans, system-ui, sans-serif)',
  lineHeight: 1.6,
}

/** Nadie se suscribe: el idioma del navegador no cambia a media pantalla. */
function sinSuscripcion(): () => void {
  return () => {}
}

/**
 * El idioma según el NAVEGADOR. `idiomaBase` recorta la variante regional
 * ('en-GB' → 'en') y devuelve `null` ante cualquier basura, así que no hace
 * falta validar nada más. Devuelve siempre una de dos cadenas constantes, que
 * es lo que `useSyncExternalStore` exige para no re-renderizar en bucle.
 */
function localeDelNavegador(): Locale {
  const base = idiomaBase(navigator.language)
  return esLocale(base) ? base : LOCALE_POR_DEFECTO
}

/** La instantánea del SERVIDOR (y la de la hidratación): siempre el defecto. */
function localeDelServidor(): Locale {
  return LOCALE_POR_DEFECTO
}

export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const locale = useSyncExternalStore(sinSuscripcion, localeDelNavegador, localeDelServidor)

  useEffect(() => {
    console.error('[darma] fallo del layout raíz', error.digest ?? '(sin digest)')
  }, [error])

  const t = obtenerTraductor(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body style={CUERPO_DOC}>
        <main role="alert" style={PAGINA}>
          <h1 style={TITULO}>{t('comun.errorGrave.titulo')}</h1>
          <p style={CUERPO}>{t('comun.errorGrave.descripcion')}</p>

          <div style={ACCIONES}>
            {/* `reset()` es lo que Next da para reintentar: vuelve a montar el
                árbol sin tirar la página. Va primero porque es lo barato. */}
            <button type="button" onClick={reset} style={RECARGAR}>
              {t('comun.errorGrave.recargar')}
            </button>
            {/* Y esto es la salida dura: una navegación de DOCUMENTO completa,
                que descarta el bundle roto y vuelve a pedirlo todo. Es un enlace
                de verdad para que funcione aunque el JS no haya arrancado.
                `next/link` haría exactamente lo contrario —una navegación de
                cliente que vuelve a montar el árbol que acaba de romperse, con
                el mismo router del que puede venir el fallo—, así que la regla
                se salta a propósito y solo aquí. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={INICIO}>
              {t('comun.irAlInicio')}
            </a>
          </div>

          {error.digest ? (
            <p style={REFERENCIA}>{t('comun.errorGrave.referencia', { digest: error.digest })}</p>
          ) : null}

          <section style={AYUDA}>
            <a href="/ayuda" style={AYUDA_ENLACE}>
              {t('comun.atajoAyuda.enlace')}
            </a>
            <p style={AYUDA_PIE}>{t('comun.atajoAyuda.pie')}</p>
          </section>
        </main>
      </body>
    </html>
  )
}
