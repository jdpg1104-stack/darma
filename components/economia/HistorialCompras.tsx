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
import { obtenerTraductor, resolverLocale, type Locale, type Traductor } from '@/i18n'
import type { MovimientoPublico } from '@/lib/billing/ledger'
import { CATALOGO_REGALOS, esTipoRegalo } from '@/lib/billing/regalos'

import { FraseLineaRoja } from './FraseLineaRoja'
import estilos from './economia.module.css'

export interface HistorialComprasProps {
  movimientos: readonly MovimientoPublico[]
}

export async function HistorialCompras({ movimientos }: HistorialComprasProps) {
  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)

  if (movimientos.length === 0) {
    return (
      <Tarjeta className={estilos.tienda}>
        <h2>{t('karma.economia.historial.titulo')}</h2>
        <EstadoVacio
          titulo={t('karma.economia.historial.vacioTitulo')}
          descripcion={t('karma.economia.historial.vacioDescripcion')}
        />
        <FraseLineaRoja />
      </Tarjeta>
    )
  }

  return (
    <Tarjeta className={estilos.tienda}>
      <h2>{t('karma.economia.historial.titulo')}</h2>
      <ul className={estilos.historial}>
        {movimientos.map((movimiento) => (
          // La clave combina fecha y motivo: no hay `id` en el tipo público, y
          // ponerlo solo para tener clave sería filtrar el bigint interno.
          <li key={`${movimiento.fecha}:${movimiento.motivo}`} className={estilos.movimiento}>
            <span>{describir(movimiento, t)}</span>
            <span>
              <span className={estilos.delta}>
                {movimiento.delta > 0 ? '+' : ''}
                {movimiento.delta}
              </span>{' '}
              <time className={estilos.fecha} dateTime={movimiento.fecha}>
                {formatearFecha(movimiento.fecha, locale)}
              </time>
            </span>
          </li>
        ))}
      </ul>
      <FraseLineaRoja />
    </Tarjeta>
  )
}

function describir(movimiento: MovimientoPublico, t: Traductor): string {
  const { motivo, origen } = movimiento

  if (origen === 'refund') return t('karma.economia.historial.reembolso')
  if (motivo === 'boost') return t('karma.economia.historial.impulso')
  if (motivo.startsWith('gift:')) {
    const tipo = motivo.slice('gift:'.length)
    // El catálogo de B12 (`lib/billing/regalos.ts`) guarda la CLAVE del nombre
    // del regalo, no el nombre: el dato es de B12 y la traducción es de la
    // vista. Un `gift:` de un tipo retirado del catálogo cae al genérico en vez
    // de pintar la clave cruda — el histórico guarda lo que pasó, y lo que pasó
    // puede ser un regalo que ya no existe.
    const etiqueta = esTipoRegalo(tipo)
      ? t(CATALOGO_REGALOS[tipo].claveEtiqueta)
      : t('karma.economia.historial.regalo')
    return t(
      movimiento.delta > 0
        ? 'karma.economia.historial.regaloRecibido'
        : 'karma.economia.historial.regaloEnviado',
      { etiqueta },
    )
  }
  if (motivo.startsWith('crystals_')) {
    return t('karma.economia.historial.compra', { n: motivo.slice('crystals_'.length) })
  }
  return t('karma.economia.historial.movimiento')
}

/** Fecha corta en el idioma activo. `Intl` está en el runtime; no añade JS al
 *  cliente. */
function formatearFecha(iso: string, locale: Locale): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(fecha)
}
