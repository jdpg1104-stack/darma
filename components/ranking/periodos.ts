// ============================================================================
// B06 · Puente entre el periodo del ranking y su clave de catálogo.
//
// `ETIQUETA_PERIODO` de `lib/ranking/tipos.ts` sigue existiendo y no se toca:
// es de otro dueño y su propio comentario ya anota la deuda de traducción. Lo
// que cambia es que la UI ya no lo lee — pinta `t(CLAVE_PERIODO[periodo])`.
//
// El mapa NO es la identidad: el catálogo llama `siempre` a lo que el tipo del
// dominio llama `historico`. Ese desfase de nombres existía antes de esta
// migración y se resuelve aquí, en una tabla de tres líneas que se ve entera,
// en vez de duplicando la cadena en `messages/`.
// ============================================================================

import type { PeriodoRanking } from '@/lib/ranking/tipos'

export const CLAVE_PERIODO: Readonly<Record<PeriodoRanking, string>> = Object.freeze({
  semana: 'ranking.periodo.semana',
  mes: 'ranking.periodo.mes',
  historico: 'ranking.periodo.siempre',
})
