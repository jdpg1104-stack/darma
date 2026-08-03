// ============================================================================
// B06 · Insignia de movimiento respecto al corte anterior. Server Component,
// puro: cero JS de cliente.
//
// TRES DECISIONES QUE NO SON DE ESTILO:
//
//  1. En `historico` NO se pinta movimiento. `calcularMovimiento` ya devuelve
//     `null` allí, pero este componente además admite `null` como «entra
//     nuevo», así que la pantalla pasa `esHistorico` y aquí se muestra el NIVEL
//     en su lugar. Un histórico no se reinicia: el delta mediría el ruido de la
//     última hora disfrazado de progreso del periodo.
//
//  2. Bajar no se pinta como una alerta. Quien baja un puesto casi nunca ha
//     hecho nada mal: otra persona escuchó más esa semana. Un rojo de peligro
//     ahí convierte un tablero de apoyo en una lista de fracasos, y en una app
//     donde la gente llega mal, eso importa más que la claridad del dato.
//
//  3. La flecha va `aria-hidden` y el significado viaja en texto. Un lector de
//     pantalla que anuncia «▲ 3» no dice nada; «sube 3 puestos» sí.
// ============================================================================

import { Insignia } from '../ui/index.ts'
import type { KarmaLevel } from '@/lib/karma'
import estilos from './ranking.module.css'

export interface InsigniaMovimientoProps {
  /** `prev_rank − posicion`. >0 subió, <0 bajó, `null` = entra nuevo. */
  movimiento: number | null
  /** En el histórico la insignia es el nivel, no el delta. */
  esHistorico?: boolean
  nivel: KarmaLevel
}

export function InsigniaMovimiento({ movimiento, esHistorico = false, nivel }: InsigniaMovimientoProps) {
  if (esHistorico) {
    return <Insignia nivel={nivel} />
  }

  if (movimiento === null) {
    return (
      <span className={`${estilos.movimiento} ${estilos.nuevo}`}>
        <span aria-hidden="true" className={estilos.flecha}>
          ✦
        </span>
        Nuevo
      </span>
    )
  }

  if (movimiento === 0) {
    return (
      <span className={estilos.movimiento}>
        <span aria-hidden="true" className={estilos.flecha}>
          ·
        </span>
        <span className="sr-only">Se mantiene en el mismo puesto</span>
        <span aria-hidden="true">Igual</span>
      </span>
    )
  }

  const subio = movimiento > 0
  const puestos = Math.abs(movimiento)
  const plural = puestos === 1 ? 'puesto' : 'puestos'

  return (
    <span className={`${estilos.movimiento} ${subio ? estilos.masAdelante : estilos.masAtras}`}>
      <span aria-hidden="true" className={estilos.flecha}>
        {subio ? '▲' : '▼'}
      </span>
      <span className="sr-only">{subio ? `Sube ${puestos} ${plural}` : `Baja ${puestos} ${plural}`}</span>
      <span aria-hidden="true">{puestos}</span>
    </span>
  )
}
