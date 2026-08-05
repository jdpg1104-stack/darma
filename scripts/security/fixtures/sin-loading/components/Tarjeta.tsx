// FIXTURE de prueba, no es código de producción.
// Menciona <Suspense> SOLO en comentarios — igual que las advertencias reales
// de app/(app)/feed/page.tsx — y el guard NO debe marcarlo: si la advertencia
// disparara el guard, habría que borrar la advertencia.
/* ⛔ nada de <Suspense> aquí; ver app/SIN-LOADING.md */
export function Tarjeta({ texto }: { texto: string }) {
  return (
    <article>
      {/* tampoco un <Suspense> en un comentario JSX debe contar */}
      <p>{texto}</p>
    </article>
  )
}
