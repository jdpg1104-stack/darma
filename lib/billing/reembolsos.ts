// ============================================================================
// Reembolsos — el apunte inverso con suelo en cero
//
// Cierra el pendiente de B12: «REFUND/voidedPurchase se registran pero NO
// generan el apunte inverso». La decisión de producto, entera, está en la
// cabecera de `supabase/migrations/0219_1_b12_reembolsos.sql`; el resumen:
//
//   · Se resta del saldo lo reembolsado HASTA dejarlo en 0, nunca negativo
//     (un saldo negativo castigaría compras legítimas posteriores).
//   · El apunte inverso queda SIEMPRE en el ledger por el delta efectivamente
//     revertido, delta 0 incluido.
//   · Lo que ya se gastó se pierde y SE AUDITA: `raw_receipt` del apunte lleva
//     `reembolsado` / `revertido` / `perdido`.
//
// ── POR QUÉ LA RESTA VIVE EN POSTGRES Y NO AQUÍ ─────────────────────────────
// El mismo motivo que en `ledger.ts`: apunte y descuento tienen que ocurrir en
// la MISMA transacción, y la idempotencia frente a los reintentos de la store
// (días de reenvíos ante un 5xx) la da el índice único `uq_crystal_ledger_
// external` con el insert especulativo — no un `if` de Node que puede morir a
// mitad. Aquí vive la otra mitad: decidir QUÉ notificación es un reembolso y
// con qué `external_id`, que es política pura y se prueba sin red.
//
// ── QUÉ NO HAY AQUÍ ─────────────────────────────────────────────────────────
// 🔴 Nada de karma: un reembolso mueve `crystals` y el ledger, y nada más.
// Tampoco se verifica ninguna firma: eso ya lo hicieron las rutas de webhook
// ANTES de llegar a estas funciones (apple.ts / google.ts).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'
import type { TransaccionApple } from './apple.ts'
import type { NotificacionPlay } from './google.ts'
import { externalId } from './ledger.ts'

/**
 * Motivos admitidos. Son los nombres que usan las stores, tal cual, porque el
 * apunte del ledger es auditoría: quien lo lea dentro de un año tiene que poder
 * cruzarlo con la consola de Apple o de Google sin un diccionario nuestro.
 */
export type MotivoReembolso = 'REFUND' | 'REVOKE' | 'voidedPurchase'

/** Lo que la ruta le pide a la base: a qué compra darle la vuelta y por qué. */
export interface OrdenReversion {
  /** `external_id` de la compra ORIGINAL (`apple:...` | `google:...`). */
  externalId: string
  motivo: MotivoReembolso
}

/** Los tres desenlaces del contrato de `revertir_compra` (0216_1). */
export type EstadoReversion = 'revertida' | 'reintento' | 'sin_compra'

export interface ResultadoReversion {
  estado: EstadoReversion
  /** Lo que se restó del saldo (en positivo). */
  revertido: number
  /** Lo que la store reembolsó y ya no estaba: pérdida asumida y auditada. */
  perdido: number
  /** Saldo tras la operación. 0 cuando `sin_compra` (no hay a quién mirárselo). */
  saldo: number
}

const ESTADOS: readonly EstadoReversion[] = ['revertida', 'reintento', 'sin_compra']

function esEstadoReversion(valor: unknown): valor is EstadoReversion {
  return typeof valor === 'string' && (ESTADOS as readonly string[]).includes(valor)
}

/**
 * ¿Es esta notificación de Apple un reembolso, y de qué transacción?
 *
 * `REFUND` es el reembolso normal; `REVOKE` es la retirada de acceso (compras
 * compartidas en familia, o disputa ganada por la persona). Para el ledger son
 * lo mismo: el dinero volvió, los cristales se revierten.
 *
 * Pura y sin firma: la ruta ya verificó el JWS de la transacción ANTES de
 * llamar aquí, así que `transaccion` es material firmado por Apple, no entrada
 * del cliente. Sin `transactionId` no hay orden: no se adivina contra qué
 * compra ejecutar un reembolso.
 */
export function reembolsoDeApple(
  tipo: string | undefined,
  transaccion: TransaccionApple,
): OrdenReversion | null {
  if (tipo !== 'REFUND' && tipo !== 'REVOKE') return null

  const idTransaccion = (transaccion.transactionId ?? '').trim()
  if (idTransaccion === '') return null

  return { externalId: externalId('apple', idTransaccion), motivo: tipo }
}

/**
 * ¿Es esta notificación de Google una compra anulada, y de qué pedido?
 *
 * La acreditación de Google usa `google:<orderId>` como clave de idempotencia
 * (`evaluarCompra`), así que la reversión necesita el `orderId` — el
 * `purchaseToken` no sirve: no es lo que hay en el ledger. Un `voidedPurchase`
 * sin `orderId` no da orden y la ruta lo registra para soporte.
 *
 * No se filtra por `productType` ni `refundType` a propósito: la autoridad
 * sobre «¿hubo compra que revertir?» es el ledger (`revertir_compra` responde
 * `sin_compra` si no la hay), y filtrar aquí solo añadiría una forma de
 * descartar un reembolso legítimo por un campo opcional.
 */
export function reembolsoDeGoogle(notificacion: NotificacionPlay): OrdenReversion | null {
  const anulada = notificacion.voidedPurchaseNotification
  if (!anulada) return null

  const orderId = (anulada.orderId ?? '').trim()
  if (orderId === '') return null

  return { externalId: externalId('google', orderId), motivo: 'voidedPurchase' }
}

/**
 * Ejecuta la reversión. Idempotente por `'refund:' + externalId` (lo construye
 * la RPC): un reembolso reintentado devuelve `estado: 'reintento'` con las
 * cifras del PRIMER procesado y no toca el saldo. **No es un error.**
 *
 * @param supabase cliente **admin**. `revertir_compra` está concedida solo a
 *                 `service_role`; con el cliente RLS devuelve 42501.
 */
export async function revertirCompra(
  supabase: SupabaseClient,
  orden: OrdenReversion,
): Promise<ResultadoReversion> {
  if (!orden.externalId) {
    // Sin idempotencia no hay reversión posible: un reintento la duplicaría.
    throw new ErrorApi('entrada_invalida', { causa: new Error('reembolso sin external_id') })
  }

  const { data, error } = await supabase.rpc('revertir_compra', {
    p_external_id: orden.externalId,
    p_motivo: orden.motivo,
  })

  if (error) {
    // El mensaje de Postgres se queda en la causa; al log va un código.
    throw new ErrorApi('error_interno', { causa: error })
  }

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { estado?: unknown; revertido?: unknown; perdido?: unknown; saldo?: unknown }
    | undefined

  if (!fila || !esEstadoReversion(fila.estado)) {
    throw new ErrorApi('error_interno', { causa: new Error('revertir_compra sin filas o con estado desconocido') })
  }

  return {
    estado: fila.estado,
    revertido: Number(fila.revertido ?? 0),
    perdido: Number(fila.perdido ?? 0),
    saldo: Number(fila.saldo ?? 0),
  }
}
