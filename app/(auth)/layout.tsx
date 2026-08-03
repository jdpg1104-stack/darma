// ============================================================================
// Layout del grupo (auth): entrar y onboarding.
//
// Es un grupo de rutas —los paréntesis no aparecen en la URL— porque estas dos
// pantallas comparten forma (una tarjeta centrada, sin navegación) y no
// comparten nada con el resto de la app: aquí todavía no hay feed, ni perfil,
// ni menú. Meterlas en el layout de `app/(app)` obligaría a pintar una barra
// de navegación llena de enlaces que la persona aún no puede usar.
//
// Server Component sin estado ni eventos: cero JavaScript de cliente. Todo el
// presupuesto de `/onboarding` (< 40 KB) se lo gasta la hoja interactiva.
// ============================================================================

export default function LayoutAuth({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main
      id="contenido"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        // El padding lateral usa el área segura para que en un móvil con muesca
        // la tarjeta no se pegue al borde redondeado.
        padding: 'max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>{children}</div>
    </main>
  )
}
