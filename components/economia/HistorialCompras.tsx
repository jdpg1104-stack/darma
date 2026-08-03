// ============================================================================
// Historial de movimientos de cristales. Server Component puro.
//
// ── LO QUE NO SE PINTA ──────────────────────────────────────────────────────
// El `external_id` y el `raw_receipt` no llegan siquiera al componente: el tipo
// `MovimientoPublico` no los tiene. **El tipo ES la barrera** — lo que no se
// puede pasar no se puede filtrar. Es el mismo patrón que usa `components/ui`
// para el anonimato (CONTRATOS §2).
//
// Tampoco se pinta el `id` del apunte: es un bigint interno y viaja dentro del
// cursor opaco (CONTRATOS §1).
//
// ── EL TEXTO DE CADA MOVIMIENTO ─────────────────────────────────────────────
// `reason` viene de la base con la forma `crystals_550`, `boost`,
// `gift:abrazo`. Traducirlo aquí y no en SQL es deliberado: el histórico guarda
// lo que pasó, no cómo lo llamábamos ese mes.
// ============================================================================

import { EstadoVacio, Tarjeta } from '@/components/ui'
import type { MovimientoPublico } from '@/lib/billing/ledger'
import { CATALOGO_REGALOS, esTipoRegalo } from '@/lib/billing/regalos'

import { FraseLineaRoja } from './FraseLineaRoja'
import estilos from './economia.module.css'

export interface HistorialComprasProps {
  movimientos: readonly MovimientoPublico[]
}

export function HistorialCompras({ movimientos }: HistorialComprasProps) {
  if (movimientos.length === 0) {
    return (
      <Tarjeta className={estilos.tienda}>
        <h2>Tus movimientos</h2>
        <EstadoVacio titulo="Todavía no hay movimientos" descripcion="Aquí aparecerá lo que compres y lo que gastes." />
        <FraseLineaRoja />
      </Tarjeta>
    )
  }

  return (
    <Tarjeta className={estilos.tienda}>
      <h2>Tus movimientos</h2>
      <ul className={estilos.historial}>
        {movimientos.map((movimiento) => (
          // La clave combina fecha y motivo: no hay `id` en el tipo público, y
          // ponerlo solo para tener clave sería filtrar el bigint interno.
          <li key={`${movimiento.fecha}:${movimiento.motivo}`} className={estilos.movimiento}>
            <span>{describir(movimiento)}</span>
            <span>
              <span className={estilos.delta}>
                {movimiento.delta > 0 ? '+' : ''}
                {movimiento.delta}
              </span>{' '}
              <time className={estilos.fecha} dateTime={movimiento.fecha}>
                {formatearFecha(movimiento.fecha)}
              </time>
            </span>
          </li>
        ))}
      </ul>
      <FraseLineaRoja />
    </Tarjeta>
  )
}

function describir(movimiento: MovimientoPublico): string {
  const { motivo, origen } = movimiento

  if (origen === 'refund') return 'Reembolso'
  if (motivo === 'boost') return 'Impulso a un post'
  if (motivo.startsWith('gift:')) {
    const tipo = motivo.slice('gift:'.length)
    const etiqueta = esTipoRegalo(tipo) ? CATALOGO_REGALOS[tipo].etiqueta : 'Regalo'
    return movimiento.delta > 0 ? `${etiqueta} (recibido)` : `${etiqueta} (enviado)`
  }
  if (motivo.startsWith('crystals_')) return `Compra de ${motivo.slice('crystals_'.length)} cristales`
  return 'Movimiento'
}

/** Fecha corta en español. `Intl` está en el runtime; no añade JS al cliente. */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(fecha)
}
