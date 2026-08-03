import type { Metadata } from 'next'

// Landing pública. Server Component puro: cero JavaScript de cliente, cero
// estado, cero dependencias nuevas. Es la primera pantalla que ve alguien que
// probablemente no está en su mejor momento — tiene que cargar al instante y
// explicarse sola, sin animaciones ni ruido.

export const metadata: Metadata = {
  title: 'Darma · Red social anónima de crecimiento emocional',
  description:
    'Red social anónima de crecimiento emocional basada en reciprocidad. Escucha a tres personas y desbloquea tu voz.',
}

// Renderizado estático: esta página no depende de la sesión ni de la base de
// datos, así que se sirve desde el CDN de Vercel. A cientos de miles de
// usuarios, la portada no debería tocar el servidor ni una vez.
export const dynamic = 'force-static'

/** Los tres niveles de implicación. De menos a más compromiso, a propósito:
 *  nadie debería tener que empezar contando lo peor que le pasa. */
const NIVELES = [
  {
    n: '01',
    nombre: 'Ánimo',
    resumen: 'Un gesto de un segundo.',
    detalle:
      'Lees a alguien y le haces saber que no está solo. Sin escribir nada, sin exponerte. Es la puerta de entrada y no pide nada a cambio.',
    color: 'var(--gold)',
  },
  {
    n: '02',
    nombre: 'Escucha',
    resumen: 'Respondes de verdad.',
    detalle:
      'Escribes a alguien que se ha desahogado. No consejos rápidos: escucha. Cada escucha validada suma un crédito, y tres créditos abren tu turno de hablar.',
    color: 'var(--accent2)',
  },
  {
    n: '03',
    nombre: 'Apoyo',
    resumen: 'Te quedas.',
    detalle:
      'Acompañas un proceso, no un mensaje suelto. Círculos, seguimiento y presencia sostenida. Es el nivel que desbloquea quien ya ha demostrado que escucha.',
    color: 'var(--accent)',
  },
] as const

/** El bucle. Está aquí como dato para que la página y la documentación cuenten
 *  exactamente lo mismo. */
const BUCLE = [
  {
    paso: 'Escuchas a 3 personas',
    texto:
      'Comentarios reales, validados por calidad. Un «ánimo!» repetido no cuenta.',
  },
  {
    paso: 'Desbloqueas tu voz',
    texto:
      'Tres escuchas equivalen a una publicación. La regla vive en la base de datos, no en un botón que se pueda saltar.',
  },
  {
    paso: 'Alguien te escucha a ti',
    texto:
      'Quien te responde ya ha pasado por lo mismo que tú acabas de hacer. Por eso responde como responde.',
  },
] as const

export default function Home() {
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
          Anónimo por diseño
        </span>

        <h1 style={{ fontSize: 'clamp(34px, 6vw, 56px)', margin: 0 }}>
          Aquí nadie sabe quién eres.
          <br />
          <span style={{ color: 'var(--accent)' }}>
            Y aun así, alguien te escucha.
          </span>
        </h1>

        <p style={{ color: 'var(--muted)', fontSize: 18, maxWidth: '58ch' }}>
          Darma es una red social anónima de crecimiento emocional basada en
          reciprocidad. Sin foto, sin nombre real, sin voz. Solo personas que
          han decidido escuchar antes de hablar.
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
            Entrar
          </a>
          <a className="btn btn--ghost" href="#como-funciona">
            Cómo funciona
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
            Tres niveles, y empiezas por el más fácil
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '62ch' }}>
            No hace falta contar nada para participar. Se sube de nivel
            haciendo, no pagando.
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
              <h3 style={{ fontSize: 20 }}>{nivel.nombre}</h3>
              <p style={{ fontWeight: 600 }}>{nivel.resumen}</p>
              <p style={{ color: 'var(--muted)', fontSize: 15 }}>
                {nivel.detalle}
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
            El bucle: escuchar es lo que da derecho a hablar
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '62ch' }}>
            En casi toda red social, hablar es gratis y escuchar es opcional.
            Aquí es al revés. Es la única regla que hace falta entender.
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
          {BUCLE.map((item, i) => (
            <li
              key={item.paso}
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
              <h3 style={{ fontSize: 17 }}>{item.paso}</h3>
              <p style={{ color: 'var(--muted)', fontSize: 15 }}>
                {item.texto}
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
          Tu primera publicación es gratuita. A partir de ahí, el ciclo se
          sostiene solo.
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
        <h2 style={{ fontSize: 24 }}>¿Empezamos escuchando?</h2>
        <p style={{ color: 'var(--muted)', maxWidth: '58ch' }}>
          No pedimos tu nombre, ni tu cara, ni tu voz. Eliges un seudónimo y ya
          estás dentro.
        </p>
        <a className="btn btn--primary" href="/entrar">
          Entrar en Darma
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
        <p style={{ maxWidth: '52ch' }}>
          Darma es apoyo entre iguales, no atención sanitaria. Si estás en
          peligro, busca ayuda profesional de inmediato.
        </p>
        <nav
          aria-label="Enlaces legales y de ayuda"
          style={{ display: 'flex', gap: 18 }}
        >
          <a href="/ayuda">Ayuda urgente</a>
          <a href="/legal">Legal</a>
        </nav>
      </footer>
    </main>
  )
}
