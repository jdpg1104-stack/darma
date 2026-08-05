import type { Metadata } from 'next'

import { obtenerTraductor, resolverLocale, type Traductor } from '@/i18n'

// Landing pública. Server Component puro: cero JavaScript de cliente, cero
// estado, cero dependencias nuevas. Es la primera pantalla que ve alguien que
// probablemente no está en su mejor momento — tiene que cargar al instante y
// explicarse sola, sin animaciones ni ruido.

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('auth.landing.metaTitulo'),
    description: t('auth.landing.metaDescripcion'),
    // La portada es la única URL que se comparte fuera. El canónico (resuelto
    // contra `metadataBase` del layout) hace que las variantes con parámetros
    // de campaña cuenten como la misma página y no se indexen por separado.
    alternates: { canonical: '/' },
  }
}

// ⚠️ ESTA PÁGINA YA NO ES `force-static`, y el motivo es el idioma.
//
// El texto sale del catálogo según el locale de la petición (cookie
// `darma_idioma` → `Accept-Language`), y `force-static` hace que `cookies()` y
// `headers()` devuelvan vacío: la portada se habría servido SIEMPRE en español
// desde el CDN, también a quien llega con el navegador en inglés. Una landing
// cacheada en un solo idioma no es una optimización, es la mitad de la gente
// leyendo algo que no entiende en el peor momento posible.
//
// El coste es real y hay que decirlo: la portada pasa a renderizarse por
// petición. Si hace falta recuperar la caché, la vía es una ruta por idioma
// (`/es`, `/en`) con `generateStaticParams`, no volver a fijar el texto.

/** Claves de los tres niveles de implicación. De menos a más compromiso, a
 *  propósito: nadie debería tener que empezar contando lo peor que le pasa. */
const NIVELES = [
  { n: '01', clave: 'animo', color: 'var(--gold)' },
  { n: '02', clave: 'escucha', color: 'var(--accent2)' },
  { n: '03', clave: 'apoyo', color: 'var(--accent)' },
] as const

/** El bucle. Está aquí como dato para que la página y la documentación cuenten
 *  exactamente lo mismo. */
const BUCLE = ['escuchas', 'desbloqueas', 'teEscuchan'] as const

export default async function Home() {
  const t: Traductor = obtenerTraductor(await resolverLocale())

  return (
    <main
      id="contenido"
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        padding: '56px 20px 72px',
        display: 'flex',
        flexDirection: 'column',
        gap: 56,
      }}
    >
      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span className="chip" style={{ alignSelf: 'flex-start' }}>
          {t('auth.landing.chip')}
        </span>

        <h1 style={{ fontSize: 'clamp(34px, 6vw, 56px)', margin: 0 }}>
          {t('auth.landing.tituloLinea1')}
          <br />
          <span style={{ color: 'var(--accent)' }}>
            {t('auth.landing.tituloLinea2')}
          </span>
        </h1>

        <p style={{ color: 'var(--muted)', fontSize: 18, maxWidth: '58ch' }}>
          {t('auth.landing.intro')}
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <a className="btn btn--primary" href="/entrar">
            {t('auth.entrar')}
          </a>
          <a className="btn btn--ghost" href="#como-funciona">
            {t('auth.landing.comoFunciona')}
          </a>
        </div>
      </header>

      {/* ── Los tres niveles ───────────────────────────────────────────── */}
      <section
        id="como-funciona"
        aria-labelledby="titulo-niveles"
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="titulo-niveles" style={{ fontSize: 26 }}>
            {t('auth.landing.nivelesTitulo')}
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '62ch' }}>
            {t('auth.landing.nivelesIntro')}
          </p>
        </div>

        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {NIVELES.map((nivel) => (
            <li
              key={nivel.n}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                // El borde superior de color es la única señal cromática: cada
                // nivel se distingue de un vistazo sin recurrir a iconos.
                borderTop: `3px solid ${nivel.color}`,
              }}
            >
              <span
                className="mono"
                style={{ color: nivel.color, fontSize: 13, fontWeight: 700 }}
              >
                {nivel.n}
              </span>
              <h3 style={{ fontSize: 20 }}>
                {t(`auth.landing.niveles.${nivel.clave}.nombre`)}
              </h3>
              <p style={{ fontWeight: 600 }}>
                {t(`auth.landing.niveles.${nivel.clave}.resumen`)}
              </p>
              <p style={{ color: 'var(--muted)', fontSize: 15 }}>
                {t(`auth.landing.niveles.${nivel.clave}.detalle`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── El bucle de reciprocidad ───────────────────────────────────── */}
      <section
        aria-labelledby="titulo-bucle"
        className="card"
        style={{
          background: 'var(--panel2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          padding: 28,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="titulo-bucle" style={{ fontSize: 26 }}>
            {t('auth.landing.bucleTitulo')}
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '62ch' }}>
            {t('auth.landing.bucleIntro')}
          </p>
        </div>

        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          {BUCLE.map((clave, i) => (
            <li
              key={clave}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <span
                aria-hidden="true"
                className="mono"
                style={{
                  color: 'var(--accent2)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {i + 1} {i < BUCLE.length - 1 ? '→' : '↺'}
              </span>
              <h3 style={{ fontSize: 17 }}>
                {t(`auth.landing.bucle.${clave}.paso`)}
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: 15 }}>
                {t(`auth.landing.bucle.${clave}.texto`)}
              </p>
            </li>
          ))}
        </ol>

        <p
          style={{
            color: 'var(--muted)',
            fontSize: 14,
            borderTop: '1px solid var(--line)',
            paddingTop: 16,
            margin: 0,
          }}
        >
          {t('auth.landing.primeraGratis')}
        </p>
      </section>

      {/* ── Cierre + CTA ───────────────────────────────────────────────── */}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        <h2 style={{ fontSize: 24 }}>{t('auth.landing.cierreTitulo')}</h2>
        <p style={{ color: 'var(--muted)', maxWidth: '58ch' }}>
          {t('auth.landing.cierreTexto')}
        </p>
        <a className="btn btn--primary" href="/entrar">
          {t('auth.entrarEnDarma')}
        </a>
      </section>

      {/* ── Pie ────────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid var(--line)',
          paddingTop: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        <p style={{ maxWidth: '52ch' }}>{t('auth.landing.pie')}</p>
        <nav
          aria-label={t('auth.landing.enlacesPie')}
          style={{ display: 'flex', gap: 18 }}
        >
          <a href="/ayuda">{t('auth.landing.ayudaUrgente')}</a>
          <a href="/legal">{t('legal.titulo')}</a>
        </nav>
      </footer>
    </main>
  )
}
