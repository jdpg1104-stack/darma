// Estado de carga raíz. Next lo muestra automáticamente mientras se resuelve un
// Server Component (Suspense implícito).
//
// A propósito NO hay spinner ni animación: un esqueleto quieto con la forma del
// contenido que viene reduce la sensación de espera sin añadir movimiento a una
// pantalla que puede estar mirando alguien con ansiedad. También cumple solo
// con `prefers-reduced-motion` sin necesidad de una regla aparte.
export default function Loading() {
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
