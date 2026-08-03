// ============================================================================
// Layout de /perfil.
//
// ── POR QUÉ ESTE LAYOUT EXISTE AQUÍ Y NO EN app/(app)/layout.tsx ───────────
// CONTRATOS §9 exige que TODOS los layouts de `app/(app)` incluyan
// `BotonCrisis`. El layout del grupo —`app/(app)/layout.tsx`, que sería su sitio
// natural— todavía no existe y no pertenece a B05, así que no se crea desde
// aquí: crear un layout de grupo desde un bloque significa que las seis rutas
// hermanas heredan decisiones de navegación que su dueño no ha tomado.
//
// La solución es este layout de ruta, que garantiza el botón en /perfil hoy y
// no estorba mañana: cuando exista el del grupo, los dos layouts se anidan y
// bastará con borrar el `<BotonCrisis>` de este archivo. Queda anotado en
// HANDOFF/PEDIDOS.md.
//
// El botón es un `<a href="/ayuda">` que funciona sin JavaScript, y está
// SIEMPRE visible. En una pantalla donde alguien mira su karma y su nivel, es
// además el sitio donde más falta hace que exista una salida que no sea la
// competición.
// ============================================================================

export default function LayoutPerfil({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <main id="contenido">{children}</main>
    </>
  )
}
