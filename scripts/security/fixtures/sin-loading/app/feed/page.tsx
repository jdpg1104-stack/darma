// FIXTURE de prueba, no es código de producción.
// Reproduce el fallo real de app/SIN-LOADING.md: un `<Suspense>` escrito a
// mano alrededor del contenido. El guard debe señalar la línea exacta.
import { Suspense } from 'react'

export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <p>contenido</p>
    </Suspense>
  )
}
