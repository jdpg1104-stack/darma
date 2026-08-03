// ============================================================================
// B06 · Layout de /ranking.
//
// ── POR QUÉ ESTE LAYOUT EXISTE AQUÍ Y NO EN app/(app)/layout.tsx ───────────
// CONTRATOS §9 exige `BotonCrisis` en TODOS los layouts de `app/(app)`. El
// layout del grupo —que sería su sitio natural— todavía no existe y no
// pertenece a B06: crearlo desde aquí impondría decisiones de navegación a las
// otras seis rutas hermanas. B02 y B05 hicieron lo mismo por la misma razón.
// Anotado en HANDOFF/PEDIDOS.md; cuando exista el del grupo, basta con borrar
// el `<BotonCrisis>` de este archivo.
//
// ── Y POR QUÉ IMPORTA ESPECIALMENTE EN ESTA PANTALLA ───────────────────────
// /ranking es, de todas las pantallas de Darma, la que más invita a compararse
// con los demás. Alguien que llega mal y se ve en el puesto 12 000 puede
// sentirse muy solo justo aquí. La salida hacia recursos de ayuda tiene que
// estar visible sin buscarla, y funcionar sin JavaScript.
// ============================================================================

export default function LayoutRanking({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <main id="contenido">{children}</main>
    </>
  )
}
