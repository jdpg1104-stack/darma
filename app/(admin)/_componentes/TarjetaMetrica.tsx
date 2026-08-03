// ============================================================================
// B19 · La tarjeta de una métrica. SERVER COMPONENT — cero bytes de JS.
//
// Todo el panel es estático: números, un SVG y una tabla. No hay ni un estado
// ni un evento, así que no hay ninguna razón para enviar JavaScript. Un panel
// de operación tiene que abrirse rápido desde un móvil con mala cobertura a las
// tres de la mañana; eso es lo que decide este diseño, no la elegancia.
//
// El semáforo NO se comunica solo con el color: lleva además una palabra
// («Bien», «Atención», «Incidente»). Una tarjeta que solo se distingue por rojo
// o verde es inaccesible para daltonismo y, peor, ilegible en una captura en
// blanco y negro pegada en un canal de incidentes.
// ============================================================================

import type { ReactNode } from 'react'
import { Chip, Tarjeta } from '@/components/ui'
import type { Semaforo } from '../_lib/dashboard.ts'

const TONO_POR_SEMAFORO = {
  verde: 'logro',
  ambar: 'aviso',
  rojo: 'peligro',
} as const

const PALABRA_POR_SEMAFORO = {
  verde: 'Bien',
  ambar: 'Atención',
  rojo: 'Incidente',
} as const

export interface TarjetaMetricaProps {
  titulo: string
  /** La cifra grande. Ya formateada: esta tarjeta no calcula nada. */
  valor: string
  /** Una línea que explica qué significa la cifra, no qué es. */
  descripcion?: string
  semaforo?: Semaforo
  /** Métricas de apoyo: las que explican POR QUÉ se mueve la principal. */
  detalles?: Array<{ etiqueta: string; valor: string }>
  children?: ReactNode
}

export function TarjetaMetrica({
  titulo,
  valor,
  descripcion,
  semaforo,
  detalles,
  children,
}: TarjetaMetricaProps) {
  return (
    <Tarjeta como="section">
      <header>
        <h2>{titulo}</h2>
        {semaforo ? (
          <Chip tono={TONO_POR_SEMAFORO[semaforo]}>{PALABRA_POR_SEMAFORO[semaforo]}</Chip>
        ) : null}
      </header>

      <p>
        <strong>{valor}</strong>
      </p>

      {descripcion ? <p>{descripcion}</p> : null}

      {detalles && detalles.length > 0 ? (
        <dl>
          {detalles.map((d) => (
            <div key={d.etiqueta}>
              <dt>{d.etiqueta}</dt>
              <dd>{d.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}
    </Tarjeta>
  )
}
