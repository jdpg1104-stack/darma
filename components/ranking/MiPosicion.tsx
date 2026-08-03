// ============================================================================
// B06 · Tu posición, aunque estés en el puesto 40 000. Server Component.
//
// Es la razón de que exista `GET /api/ranking/yo` y la lectura por PK que hay
// detrás: sin esto, «tu posición» solo existiría para quien ya está arriba, es
// decir, para la gente que menos necesita verla.
//
// EL COPY DEL CASO VACÍO ES LA MITAD DEL COMPONENTE. No estar en la foto es lo
// más normal del mundo —quien llega hoy no ha acompañado a nadie todavía— y el
// texto no puede leerse como un reproche ni como un error. Nada de «no estás en
// el ranking»: una invitación, y la salida hacia el feed, que es donde se
// escucha.
// ============================================================================

import { Boton, Tarjeta } from '../ui/index.ts'
import type { FilaRanking, PeriodoRanking } from '@/lib/ranking/tipos'
import { InsigniaMovimiento } from './InsigniaMovimiento.tsx'
import estilos from './ranking.module.css'
import Link from 'next/link'

export interface MiPosicionProps {
  fila: FilaRanking | null
  periodo: PeriodoRanking
}

export function MiPosicion({ fila, periodo }: MiPosicionProps) {
  if (!fila) {
    return (
      <Tarjeta como="section">
        <p>Todavía no apareces en esta tabla. Aparecerás en cuanto acompañes a alguien.</p>
        <Boton variante="secundario">
          <Link href="/feed">Ver quién necesita compañía</Link>
        </Boton>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta como="section" acento="logro">
      <p className={estilos.movimiento}>
        <strong>Tu puesto: {fila.posicion}</strong>
        {' · '}
        {fila.escuchas} {fila.escuchas === 1 ? 'persona acompañada' : 'personas acompañadas'}
        {' '}
        <InsigniaMovimiento
          movimiento={fila.movimiento}
          esHistorico={periodo === 'historico'}
          nivel={fila.perfil.nivel}
        />
      </p>
    </Tarjeta>
  )
}
