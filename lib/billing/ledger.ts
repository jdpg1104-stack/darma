// ============================================================================
// Acreditación idempotente en crystal_ledger
//
// ── EL FALLO CLÁSICO DE ESTE BLOQUE, Y CÓMO SE EVITA ────────────────────────
// Apple y Google **reintentan sus notificaciones durante días** ante un 5xx o
// un timeout. Si acreditar es "insertar apunte + sumar al saldo", el segundo
// intento suma otra vez y la economía se rompe en silencio.
//
// La solución entera cabe en una idea: el apunte lleva `external_id` con un
// índice único parcial (`uq_crystal_ledger_external`), y el insert es
//
//     on conflict (external_id) where external_id is not null do nothing
//     returning id
//
// Si el `returning` NO devuelve fila, era un reintento: se responde 200 y **no
// se toca `profiles.crystals`**. Actualizar el caché fuera de esa rama es,
// literalmente, cómo se duplican los cristales.
//
// Las tres líneas viven dentro de `public.acreditar_compra()`
// (`0121_1_b12_economia.sql`) y no aquí, por una razón que no es de estilo: el
// apunte y la suma al saldo tienen que ocurrir en la MISMA transacción. Dos
// llamadas separadas desde Node dejan una ventana en la que el proceso puede
// morir entre el insert y el update, y el usuario paga sin recibir nada.
//
// ── QUÉ NO ESTÁ EN ESTE ARCHIVO ─────────────────────────────────────────────
// 🔴 Ninguna llamada a `award_karma()`. Ninguna escritura en
// `karma_reputation` ni en `karma_spendable`. El dinero entra por `crystals`,
// que es otra columna y otra moneda, precisamente para que no haya un camino.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'
import { resolverPaquete, type SkuCristales } from './catalogo.ts'

/**
 * Valores exactos del `check` de `crystal_ledger.source`. Se declara como unión
 * para que un `'apple'` o un `'purchase'` no compile: escribirlo a mano en cada
 * sitio es cómo se descubre una violación de CHECK en producción y no en el
 * test (trampa conocida nº 2 de la ficha).
 */
export type OrigenCristales = 'iap_apple' | 'iap_google' | 'gift' | 'grant' | 'spend' | 'refund'

/** Origen de una COMPRA. Subconjunto: lo demás no entra por esta puerta. */
export type OrigenCompra = Extract<OrigenCristales, 'iap_apple' | 'iap_google'>

export interface ResultadoAcreditacion {
  /** `false` = era un reintento; ya estaba acreditado. **No es un error.** */
  acreditado: boolean
  saldo: number
}

/** Plataforma tal y como la nombra el cliente. */
export type Plataforma = 'apple' | 'google'

/** `iap_apple` | `iap_google` a partir de la plataforma. Sin cadenas sueltas. */
export function origenDePlataforma(plataforma: Plataforma): OrigenCompra {
  return plataforma === 'apple' ? 'iap_apple' : 'iap_google'
}

/**
 * Prefijo de plataforma en el `external_id` para que un `transactionId` de
 * Apple y un `orderId` de Google no puedan colisionar nunca en el índice único.
 */
export function externalId(plataforma: Plataforma, idTransaccion: string): string {
  return `${plataforma}:${idTransaccion}`
}

/**
 * Movimiento tal y como sale por la API.
 *
 * **No incluye `raw_receipt` ni `external_id`.** Un recibo crudo lleva
 * identificadores de la cuenta de la tienda, que es exactamente el tipo de dato
 * que CONTRATOS §2 declara inexistente en Darma. Tampoco sale el `id` como
 * campo: es un bigint interno y viaja dentro del cursor opaco (CONTRATOS §1).
 */
export interface MovimientoPublico {
  delta: number
  motivo: string
  origen: OrigenCristales
  fecha: string
}

interface FilaHistorial {
  id: number
  delta: number
  reason: string
  source: string
  created_at: string
}

/**
 * Acredita una compra ya verificada. Idempotente por `externalId`.
 *
 * `sku` es un SKU del catálogo, no una cantidad: la cantidad la resuelve el
 * servidor. Si el SKU no está en el catálogo no se acredita nada —fail-closed—
 * porque acreditar "lo que diga el cliente" es imprimir moneda.
 *
 * @param supabase cliente **admin**. `acreditar_compra` está concedida solo a
 *                 `service_role`; con el cliente RLS devuelve 42501.
 */
export async function acreditarCompra(
  supabase: SupabaseClient,
  args: {
    userId: string
    externalId: string
    sku: SkuCristales
    source: OrigenCompra
    recibo?: unknown
  },
): Promise<ResultadoAcreditacion> {
  const paquete = resolverPaquete(args.sku)
  if (!paquete) {
    throw new ErrorApi('entrada_invalida', { causa: new Error(`sku fuera de catálogo: ${args.sku}`) })
  }
  if (!args.externalId) {
    // Sin idempotencia no hay acreditación posible: un reintento la duplicaría.
    throw new ErrorApi('entrada_invalida', { causa: new Error('compra sin external_id') })
  }

  const { data, error } = await supabase.rpc('acreditar_compra', {
    p_user: args.userId,
    p_external_id: args.externalId,
    p_delta: paquete.crystals,
    p_reason: paquete.sku,
    p_source: args.source,
    p_receipt: args.recibo ?? null,
  })

  if (error) {
    // El mensaje de Postgres se queda en la causa; al cliente va un código.
    throw new ErrorApi('error_interno', { causa: error })
  }

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { acreditado: boolean; saldo: number }
    | undefined

  if (!fila) throw new ErrorApi('error_interno', { causa: new Error('acreditar_compra sin filas') })  return { acreditado: fila.acreditado === true, saldo: Number(fila.saldo ?? 0) }
}

/**
 * Historial de movimientos del propio usuario, paginado por keyset.
 *
 * Es la única tabla de Darma cuyo cursor es un bigint interno (el ledger no
 * tiene uuid), y por eso se codifica dentro del cursor opaco y **no se devuelve
 * como campo**. La consulta vive en `mi_historial_cristales()`, que filtra por
 * `auth.uid()` dentro y selecciona columnas explícitas.
 */
export async function historialCristales(
  supabase: SupabaseClient,
  args: { cursor: number | null; limite: number },
): Promise<{ items: MovimientoPublico[]; siguienteCursor: string | null }> {
  const { data, error } = await supabase.rpc('mi_historial_cristales', {
    p_cursor: args.cursor,
    p_limite: args.limite,
  })

  if (error) throw new ErrorApi('error_interno', { causa: error })

  const filas = (Array.isArray(data) ? data : []) as FilaHistorial[]

  return {
    items: filas.map((f) => ({
      delta: f.delta,
      motivo: f.reason,
      origen: f.source as OrigenCristales,
      fecha: f.created_at,
    })),
    siguienteCursor: filas.length > 0 ? codificarCursor(filas[filas.length - 1]!.id) : null,
  }
}

// ── Cursor opaco sobre el bigint del ledger ─────────────────────────────────
// base64url para que sea url-safe y para que nadie lo construya a mano. No va
// firmado: no protege nada —RLS ya filtra por auth.uid()— y firmarlo daría una
// falsa sensación de seguridad sobre datos que la base ya protege. Mismo
// razonamiento que el cursor del feed en lib/feedRanking.ts.

const PREFIJO_CURSOR = 'cl:'

export function codificarCursor(id: number): string {
  return Buffer.from(`${PREFIJO_CURSOR}${id}`, 'utf8').toString('base64url')
}

/**
 * Devuelve `null` ante cualquier entrada inválida en vez de lanzar: un cursor
 * corrupto es una url mal pegada, no un error del sistema, y la respuesta
 * correcta es servir la primera página, no un 500.
 */
export function decodificarCursor(token: string | null | undefined): number | null {
  if (!token) return null
  try {
    const crudo = Buffer.from(token, 'base64url').toString('utf8')
    if (!crudo.startsWith(PREFIJO_CURSOR)) return null
    const id = Number(crudo.slice(PREFIJO_CURSOR.length))
    if (!Number.isSafeInteger(id) || id <= 0) return null
    return id
  } catch {
    return null
  }
}
