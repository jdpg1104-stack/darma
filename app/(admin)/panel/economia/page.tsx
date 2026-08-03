// ============================================================================
// /panel/economia — emisión, drenaje y cristales. SERVER COMPONENT.
// Rol mínimo: `operaciones`.
//
// ── DOS ADVERTENCIAS QUE VAN EN LA PROPIA PANTALLA ────────────────────────
//
// 1. `spend_karma()` de 0001_core.sql escribe los GASTOS en el ledger con
//    `kind = 'comment_validated'`. Agrupar emisión y drenaje por `kind` da
//    emisión inflada, así que aquí se agrupa por el SIGNO de los deltas. Es un
//    bug del esquema, no de esta página: anotado en PEDIDOS.md para F1/B12 y
//    no se toca la migración.
//
// 2. `crystal_ledger` no guarda el precio, solo el delta de cristales. El
//    ingreso sale del `raw_receipt` cuando existe y, si no, del mapa de precios
//    provisional de `_lib/precios.ts`. La pantalla lo dice en voz alta mientras
//    ese stub siga activo: un número de ingreso que no distingue lo medido de
//    lo supuesto acaba en una previsión.
//
// ── LÍNEA ROJA (CONTRATOS §8) ──────────────────────────────────────────────
// El dinero no compra karma, ni prioridad de escucha, ni salta la cola de
// crisis. Si mirando estos datos aparece un boost o un regalo que altera el
// orden de la cola de crisis, eso es un incidente de producto y va a
// PEDIDOS.md, no a una optimización.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import {
  DIAS_VENTANA_DETALLE,
  enmascarar,
  getEconomia,
  leerRollup,
  ventanaDias,
} from '../../_lib/dashboard.ts'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { entero, euros, porcentaje } from '../../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaEconomia() {
  await requireAdmin('operaciones', { accion: `${ACCIONES.panel}.economia` })

  const admin = createAdminClient()
  const filas = await leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE))
  const economia = getEconomia(filas)

  return (
    <section>
      <h1>Economía</h1>

      {economia.ingresoEstimado ? (
        <p>
          <strong>Ingreso parcialmente estimado.</strong> Las compras sin recibo se valoran con
          el mapa de precios provisional de este bloque. Pendiente de que B12 exponga el
          catálogo real desde <code>lib/billing/</code>.
        </p>
      ) : null}

      <dl>
        <div>
          <dt>Ingreso de la ventana</dt>
          <dd>{euros(economia.ingresoCentimos)}</dd>
        </div>
        <div>
          <dt>ARPPU</dt>
          <dd>{euros(economia.arppuCentimos)}</dd>
        </div>
        <div>
          <dt>Compradores únicos (cota superior)</dt>
          <dd>{enmascarar(economia.compradoresUnicos)}</dd>
        </div>
        <div>
          <dt>Cristales vendidos</dt>
          <dd>{entero(economia.cristalesVendidos)}</dd>
        </div>
        <div>
          <dt>Karma emitido</dt>
          <dd>{entero(economia.karmaEmitido)}</dd>
        </div>
        <div>
          <dt>Karma drenado</dt>
          <dd>{entero(economia.karmaDrenado)}</dd>
        </div>
        <div>
          <dt>Stock gastable agregado</dt>
          <dd>{entero(economia.stockGastable)}</dd>
        </div>
        <div>
          <dt>Personas que topan el límite diario</dt>
          <dd>{porcentaje(economia.pctUsuariosEnTope)}</dd>
        </div>
      </dl>

      <p>
        «Compradores únicos» suma los de cada día, así que sobrecuenta a quien compró en dos
        días distintos: es una cota superior consciente. El cálculo exacto exigiría un
        <code> count(distinct) </code> en vivo sobre <code>crystal_ledger</code>, que es
        justo lo que este panel no puede hacer.
      </p>

      <TablaSerie
        titulo={`Serie diaria de los últimos ${DIAS_VENTANA_DETALLE} días`}
        columnas={[
          { clave: 'dia', etiqueta: 'Día' },
          { clave: 'emitido', etiqueta: 'Karma emitido' },
          { clave: 'drenado', etiqueta: 'Karma drenado' },
          { clave: 'stock', etiqueta: 'Stock gastable' },
          { clave: 'compradores', etiqueta: 'Compradores' },
          { clave: 'cristales', etiqueta: 'Cristales' },
        ]}
        filas={filas.map((f) => ({
          dia: f.dia,
          emitido: entero(Number(f.metricas.karma_emitido ?? 0)),
          drenado: entero(Number(f.metricas.karma_drenado ?? 0)),
          stock: entero(Number(f.metricas.karma_stock_gastable ?? 0)),
          compradores: enmascarar(Number(f.metricas.compradores_unicos ?? 0)),
          cristales: entero(Number(f.metricas.cristales_vendidos ?? 0)),
        }))}
      />
    </section>
  )
}
