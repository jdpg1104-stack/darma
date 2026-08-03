// Esqueleto de carga compartido por las pantallas de `(app)`.
//
// ⚠️ POR QUÉ CADA RUTA TIENE SU PROPIO `loading.tsx` EN VEZ DE UNO COMPARTIDO
// EN `app/(app)/loading.tsx`, Y POR QUÉ ESTO NO ES UNA MANÍA:
//
// El layout raíz es asíncrono —espera a `resolverLocale()` para poner el `lang`
// del documento—, así que suspende en todas las peticiones. Con un `loading.tsx`
// en un segmento SUPERIOR al de la página, React nunca completa el intercambio
// del fallback: se queda en el DOM junto al contenido y **la hidratación no
// arranca**. La app se ve entera y no responde a nada: el composer mostraba
// «Preparando el espacio para escribir…» para siempre, y ningún formulario
// funcionaba.
//
// Con el `loading.tsx` en el MISMO segmento que la página, funciona. Se
// comprobó ruta por ruta: `/feed` era la única sana de toda la app, y era la
// única que ya tenía el suyo propio.
//
// Nada de esto lo veía el `tsc`, ni el lint, ni los 1.209 tests: cada pieza
// estaba bien por separado. Salió al recorrer la app a mano.
//
// A propósito NO hay spinner ni animación: un esqueleto quieto con la forma del
// contenido que viene reduce la sensación de espera sin añadir movimiento a una
// pantalla que puede estar mirando alguien con ansiedad. También cumple solo
// con `prefers-reduced-motion` sin necesidad de una regla aparte.
export default function EsqueletoPantalla() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        padding: '56px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* El texto real para lectores de pantalla; los bloques de abajo son
          puramente decorativos y quedan fuera del árbol de accesibilidad. */}
      <span className="sr-only">Cargando…</span>

      <div aria-hidden="true" style={{ display: 'grid', gap: 14 }}>
        <div style={{ ...bloque, height: 34, width: '58%' }} />
        <div style={{ ...bloque, height: 18, width: '78%' }} />
        <div style={{ ...bloque, height: 18, width: '42%' }} />
      </div>

      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          marginTop: 16,
        }}
      >
        <div style={{ ...bloque, height: 168 }} />
        <div style={{ ...bloque, height: 168 }} />
        <div style={{ ...bloque, height: 168 }} />
      </div>
    </main>
  )
}

const bloque: React.CSSProperties = {
  background: 'var(--panel2)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
}
