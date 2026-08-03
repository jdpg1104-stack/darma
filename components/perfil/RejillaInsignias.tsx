// ============================================================================
// RejillaInsignias — el catálogo, con el requisito escrito al lado.
//
// Cada insignia pendiente muestra `comoSeConsigue`. No es relleno: una insignia
// que no explica cómo se consigue es una mecánica oscura, y en Darma la
// economía es auditable por principio (la tabla `karma_weights` es de lectura
// pública precisamente por eso). Si alguien no puede saber qué le falta, el
// sistema le está pidiendo que adivine.
//
// El estado «pendiente» NO se comunica solo con la opacidad: lleva borde
// discontinuo y, sobre todo, el texto «Te falta: …». El color y el contraste
// nunca son el único portador de información.
//
// Server Component.
// ============================================================================

import { EstadoVacio } from '../ui/index.ts'
import type { Insignia } from './tipos.ts'
import estilos from './perfil.module.css'

export interface RejillaInsigniasProps {
  insignias: Insignia[]
  /** Título de la sección. El perfil ajeno usa otro: lo que se ve ahí es un
   *  subconjunto, y llamarlo «Tus insignias» sería mentir sobre el alcance. */
  titulo?: string
  /** Texto del vacío. En el perfil ajeno el vacío no es un fallo ni una
   *  carencia de esa persona: es que no hay nada público que enseñar. */
  textoVacio?: string
}

export function RejillaInsignias({
  insignias,
  titulo = 'Insignias',
  textoVacio = 'Aún no hay ninguna. Aparecerán aquí solas.',
}: RejillaInsigniasProps) {
  const id = 'titulo-insignias'

  return (
    <section className={estilos.seccion} aria-labelledby={id}>
      <h2 className={estilos.tituloSeccion} id={id}>
        {titulo}
      </h2>

      {insignias.length === 0 ? (
        <EstadoVacio titulo={textoVacio} tono="neutro" />
      ) : (
        <ul className={estilos.rejilla}>
          {insignias.map((i) => (
            <li
              key={i.clave}
              className={`${estilos.insignia} ${i.conseguida ? '' : estilos.insigniaPendiente}`}
            >
              <span className={estilos.insigniaNombre}>{i.nombre}</span>
              <p className={estilos.insigniaTexto}>
                {i.conseguida ? i.descripcion : `Te falta: ${i.comoSeConsigue}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
