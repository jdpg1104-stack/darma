'use client'

import { useEffect, type CSSProperties } from 'react'

import { useTraductor } from '@/i18n/Proveedor'

// ============================================================================
// Frontera de error de TODA la aplicación.
//
// ── QUÉ CUBRE Y QUÉ NO ──────────────────────────────────────────────────────
// Ya existían dos límites de error de ruta: `app/(app)/feed/error.tsx` y
// `app/(app)/post/[id]/error.tsx`. Este NO los sustituye ni los duplica: React
// escoge siempre el límite más cercano, así que el feed y el hilo siguen
// usando el suyo, con su copy y su maquetación. Este archivo es la red que
// recoge todo lo demás — `/perfil`, `/refugios`, `/publicar`, `/ranking`,
// `/animo`, el panel de administración y cualquier ruta que se cree mañana sin
// que su autor tenga que acordarse de escribir un `error.tsx`.
//
// Lo que este archivo NO puede cubrir es un fallo del propio layout raíz: React
// no puede pintar un hijo del árbol que acaba de romperse. Ese caso es de
// `app/global-error.tsx`, y por eso los dos tienen que existir.
//
// ── LAS TRES REGLAS ─────────────────────────────────────────────────────────
//
//  1. **NUNCA se pinta `error.message`.** En producción Next ya lo sustituye
//     por un texto genérico, pero en desarrollo y en preview llega el mensaje
//     real — y aquí un mensaje real puede venir de Postgres con el nombre de una
//     tabla o de una restricción dentro. `uq_comments_one_listen_per_post` le
//     cuenta a quien lo lea la mecánica antifarmeo entera, gratis. Lo que sí se
//     muestra es `digest`: un identificador opaco que soporte puede cruzar con
//     la línea del log y que no dice nada de nadie.
//
//  2. **Se ofrece reintentar.** `reset()` vuelve a montar el segmento sin
//     recargar la página. Un error transitorio (una consulta que expiró, la red
//     que se cayó medio segundo) se arregla con un toque, y quien venía a
//     escribir no pierde el sitio.
//
//  3. **Enlace visible a /ayuda.** Es la razón principal por la que existe este
//     archivo. Los límites de error del feed y del hilo viven DENTRO del grupo
//     `(app)`, así que su layout sigue montando el `BotonCrisis` y quien está
//     ahí conserva el acceso a los teléfonos. Este límite es el de la raíz: si
//     salta, no hay layout de `(app)` alrededor y no hay botón de crisis. Por
//     eso el enlace va escrito a mano, y es lo último y más visible de la
//     pantalla.
//
// ── ALTERNATIVAS DESCARTADAS ────────────────────────────────────────────────
//
//  · **Recargar la ventana (`location.reload()`) en vez de `reset()`.** Tira el
//    estado de cliente de toda la aplicación y en una conexión mala tarda
//    segundos. `reset()` es lo que Next da para esto; el recargar completo se
//    reserva para `global-error.tsx`, donde no queda otra.
//
//  · **Reportar el error a un servicio externo.** La CSP de `next.config.ts`
//    bloquea a propósito toda petición a terceros, y en una red anónima de salud
//    mental esa decisión no se toca desde un archivo de error. El `digest` ya
//    está en el log del servidor; aquí solo se repite a la consola del
//    navegador, que es lo que `no-console` permite (`warn` y `error`).
//
//  · **Enseñar `error.message` solo en desarrollo.** Suena inofensivo y no lo
//    es: una preview desplegada es «no producción» y la ve gente de fuera. Una
//    regla que depende de `NODE_ENV` es una regla que un día se aplica y otro
//    no; la regla aquí es que no se pinta nunca.
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

const REINTENTAR: CSSProperties = {
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

const REFERENCIA: CSSProperties = {
  margin: '16px 0 0',
  color: 'var(--muted)',
  fontSize: '12.5px',
  fontFamily: 'var(--font-mono, monospace)',
  overflowWrap: 'anywhere',
}

// Separado por una línea del resto a propósito: el acceso a ayuda no es «otra
// opción más» de esta pantalla, es una salida distinta. Borde en --danger como
// el `BotonCrisis`; nunca --accent, reservado a la acción primaria.
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

export default function ErrorGlobalDeRuta({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // `useTraductor()` lee el locale del `ProveedorIdioma` del layout raíz. Si el
  // layout raíz hubiera fallado, este archivo no se pintaría (lo haría
  // `global-error.tsx`), así que el proveedor está montado; y aun así el hook
  // cae al idioma por defecto en vez de lanzar. Una pantalla en español es un
  // fallo cosmético; una pantalla en blanco, no.
  const t = useTraductor()

  useEffect(() => {
    // A la consola del navegador, NUNCA a la pantalla, y solo el digest: el
    // objeto `error` completo puede arrastrar el mensaje de Postgres.
    console.error('[darma] error no capturado por ninguna ruta', error.digest ?? '(sin digest)')
  }, [error])

  return (
    <main id="contenido" role="alert" style={PAGINA}>
      <h1 style={TITULO}>{t('comun.errorPantalla.titulo')}</h1>
      <p style={CUERPO}>{t('comun.errorPantalla.descripcion')}</p>

      <button type="button" onClick={reset} style={REINTENTAR}>
        {t('comun.reintentar')}
      </button>

      {error.digest ? (
        <p style={REFERENCIA}>{t('comun.errorPantalla.referencia', { digest: error.digest })}</p>
      ) : null}

      {/* `<a href>` y no un botón: si lo que se rompió fue el JavaScript, un
          enlace de verdad sigue llevando a los teléfonos. */}
      <section style={AYUDA}>
        <a href="/ayuda" style={AYUDA_ENLACE}>
          {t('comun.atajoAyuda.enlace')}
        </a>
        <p style={AYUDA_PIE}>{t('comun.atajoAyuda.pie')}</p>
      </section>
    </main>
  )
}
