// ============================================================================
// B06 · Selector de periodo.
//
// ── DESVIACIÓN DE LA FICHA, y va a favor del presupuesto ───────────────────
// B06.md lo pedía con `'use client'`. No lo lleva: son tres `<Link>` y una
// comparación de strings, sin estado ni evento. Como Server Component cumple
// exactamente el requisito que la ficha pone detrás de esa marca —«cambia
// `?periodo=` con `<Link>`, no con `router.push`, así funciona sin JS»— y
// además no envía un solo byte de JS propio. Marcarlo cliente solo añadiría
// peso al presupuesto de 120 KB de la ruta a cambio de nada.
//
// El periodo activo se anuncia con `aria-current="page"`, no solo con el borde:
// el color como único portador de información deja fuera a quien no lo
// distingue y a quien navega con lector de pantalla.
// ============================================================================

import Link from 'next/link'

import { ETIQUETA_PERIODO, PERIODOS, type PeriodoRanking } from '@/lib/ranking/tipos'
import estilos from './ranking.module.css'

export interface SelectorPeriodoProps {
  activo: PeriodoRanking
}

export function SelectorPeriodo({ activo }: SelectorPeriodoProps) {
  return (
    <nav className={estilos.selector} aria-label="Periodo del ranking">
      {PERIODOS.map((periodo) => {
        const esActivo = periodo === activo
        return (
          <Link
            key={periodo}
            href={`/ranking?periodo=${periodo}`}
            className={`${estilos.opcion} ${esActivo ? estilos.activa : ''}`}
            aria-current={esActivo ? 'page' : undefined}
          >
            {ETIQUETA_PERIODO[periodo]}
          </Link>
        )
      })}
    </nav>
  )
}
