// ============================================================================
// B06 · Podio (top 3). Server Component: cero JS de cliente.
//
// El podio NO hace su propia consulta. Recibe las tres primeras filas de la
// MISMA página 1 que pinta el tablero: una consulta extra para tres filas que
// ya están en memoria es desperdicio puro, y multiplicada por cada visita a la
// pantalla más «social» de la app, deja de ser un detalle.
//
// Sobre el tono: aquí no hay oro, plata ni bronce. En Darma el podio es de
// quien más ha ESCUCHADO, y la iconografía de competición deportiva contradice
// el mensaje entero del producto. Se realza el primero con el borde de acento y
// se deja que los números hablen.
// ============================================================================

import { Avatar, Insignia } from '../ui/index.ts'
import type { FilaRanking } from '@/lib/ranking/tipos'
import estilos from './ranking.module.css'

export interface PodioProps {
  /** Las tres primeras filas del tablero. Menos de tres también vale. */
  filas: readonly FilaRanking[]
}

export function Podio({ filas }: PodioProps) {
  const top = filas.slice(0, 3)
  if (top.length === 0) return null

  return (
    <ol className={estilos.podio} aria-label="Quienes más han acompañado en este periodo">
      {top.map((fila, indice) => (
        <li
          key={fila.perfil.id}
          className={`${estilos.escalon} ${indice === 0 ? estilos.primero : ''}`}
        >
          <span className={estilos.puesto}>
            <span className="sr-only">Puesto </span>
            {fila.posicion}
          </span>

          <Avatar
            semilla={fila.perfil.avatarSeed}
            tamano={indice === 0 ? 80 : 56}
            alias={fila.perfil.alias}
            nivel={fila.perfil.nivel}
          />

          <span className={estilos.aliasPodio}>{fila.perfil.alias}</span>
          <Insignia nivel={fila.perfil.nivel} />

          {/* «personas acompañadas», no «escuchas» ni «puntos»: el copy del
              sistema de diseño (B16, Trampa #5) no usa la palabra métrica. */}
          <span className={estilos.escuchasPodio}>
            {fila.escuchas} {fila.escuchas === 1 ? 'persona acompañada' : 'personas acompañadas'}
          </span>
        </li>
      ))}
    </ol>
  )
}
