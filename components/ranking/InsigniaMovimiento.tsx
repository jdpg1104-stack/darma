'use client'

// ============================================================================
// B06 · Insignia de movimiento respecto al corte anterior.
//
// ⚠️ Lleva `'use client'` DESDE LA MIGRACIÓN A i18n. No cambia lo que pesa:
// `Tablero` —que sí es cliente— ya lo importaba, así que este componente ya
// viajaba al navegador dentro de ese bundle. La marca solo lo hace explícito y
// le permite leer el catálogo con `useTraductor()`; `MiPosicion`, que es Server
// Component, lo sigue renderizando sin cambios.
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

import { useTraductor } from '@/i18n/Proveedor'
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
  const t = useTraductor()

  if (esHistorico) {
    return <Insignia nivel={nivel} />
  }

  if (movimiento === null) {
    return (
      <span className={`${estilos.movimiento} ${estilos.nuevo}`}>
        <span aria-hidden="true" className={estilos.flecha}>
          ✦
        </span>
        {t('ranking.movimientoNuevo')}
      </span>
    )
  }

  if (movimiento === 0) {
    return (
      <span className={estilos.movimiento}>
        <span aria-hidden="true" className={estilos.flecha}>
          ·
        </span>
        <span className="sr-only">{t('ranking.movimientoIgualSr')}</span>
        <span aria-hidden="true">{t('ranking.movimientoIgual')}</span>
      </span>
    )
  }

  const subio = movimiento > 0
  const puestos = Math.abs(movimiento)

  return (
    <span className={`${estilos.movimiento} ${subio ? estilos.masAdelante : estilos.masAtras}`}>
      <span aria-hidden="true" className={estilos.flecha}>
        {subio ? '▲' : '▼'}
      </span>
      <span className="sr-only">
        {t(subio ? 'ranking.movimientoSube' : 'ranking.movimientoBaja', { n: puestos })}
      </span>
      <span aria-hidden="true">{puestos}</span>
    </span>
  )
}
