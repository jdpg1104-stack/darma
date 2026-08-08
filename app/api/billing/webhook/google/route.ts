// ============================================================================
// POST /api/billing/webhook/google — Real-time developer notifications (Pub/Sub)
//
// ── LA FIRMA SE VERIFICA ANTES DE LEER EL CUERPO ────────────────────────────
// Pub/Sub manda un token OIDC en `Authorization: Bearer`. Se verifica contra el
// JWKS de Google y se comprueban emisor, audiencia y que el `email` sea
// EXACTAMENTE la cuenta de servicio autorizada. Sin eso, cualquiera puede
// POSTear un sobre con la forma de Pub/Sub y regalarse cristales.
//
// ── `proxy.ts` LO BLOQUEA HOY ───────────────────────────────────────────────
// Igual que el de Apple: `/api/billing/` no está en `PUBLIC_ROUTES`. Anotado en
// `HANDOFF/PEDIDOS.md`; no se edita `proxy.ts` (es de F4).
//
// ── 200 RÁPIDO ──────────────────────────────────────────────────────────────
// Pub/Sub reintenta ante cualquier respuesta que no sea 2xx, con backoff, y
// puede acumular un backlog de horas. El trabajo es idempotente, así que un
// reintento no duplica; pero un 5xx por una excepción nuestra tampoco arregla
// nada. Firma inválida sí es 401.
//
// 🔴 Este handler acredita cristales. Nunca karma.
// ============================================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { resolverPaquete } from '@/lib/billing/catalogo'
import {
  configGoogle,
  confirmarCompra,
  extraerNotificacion,
  verificarRecibo,
  verificarTokenPubSub,
} from '@/lib/billing/google'
import { acreditarCompra } from '@/lib/billing/ledger'
import { reembolsoDeGoogle, revertirCompra } from '@/lib/billing/reembolsos'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CABECERAS = { 'Cache-Control': 'private, no-store' } as const

export async function POST(request: NextRequest) {
  const config = configGoogle()
  if (!config) {
    logger.exception('billing:webhook_google_sin_configurar', new Error('GOOGLE_* ausentes'), {})
    return NextResponse.json({ ok: false as const, code: 'error_interno', message: 'No disponible.' }, { status: 503, headers: CABECERAS })
  }

  // PRIMERO la firma. El cuerpo no se toca hasta que el token es válido.
  const firma = await verificarTokenPubSub(request.headers.get('authorization'), config)
  if (!firma.ok) {
    logger.exception('billing:webhook_google_firma', new Error(firma.motivo ?? 'no verificada'), {})
    return NextResponse.json({ ok: false as const, code: 'sin_permiso', message: 'No puedes hacer esto.' }, { status: 401, headers: CABECERAS })
  }

  try {
    const notificacion = extraerNotificacion(await request.json())
    if (notificacion) await procesar(notificacion)
  } catch (causa) {
    logger.exception('billing:webhook_google_proceso', causa, {})
  }

  return NextResponse.json({ ok: true as const, data: { recibido: true } }, { status: 200, headers: CABECERAS })
}

async function procesar(
  notificacion: NonNullable<ReturnType<typeof extraerNotificacion>>,
): Promise<void> {
  // Compra anulada o reembolsada: la corrección se hace con un apunte inverso
  // (`source = 'refund'`), nunca modificando la fila —el trigger de
  // inmutabilidad lo impide incluso a service_role—. La política entera
  // —suelo en 0, apunte SIEMPRE, pérdida auditada— vive en `revertir_compra`
  // (0216_1); `reembolsoDeGoogle()` solo decide QUÉ revertir. La firma del
  // sobre ya está verificada arriba (token OIDC de Pub/Sub).
  if (notificacion.voidedPurchaseNotification) {
    const orden = reembolsoDeGoogle(notificacion)
    if (!orden) {
      // Sin `orderId` no hay orden: la acreditación usó `google:<orderId>` como
      // clave y el purchaseToken no está en el ledger. Queda para soporte.
      logger.exception('billing:reembolso_sin_transaccion', new Error('voidedPurchase sin orderId'), {})
      return
    }

    const resultado = await revertirCompra(createAdminClient(), orden)

    if (resultado.estado === 'sin_compra') {
      // Anulación de una compra que nunca se acreditó (p. ej. sin acknowledge:
      // Google revirtió el cobro a los 3 días de una compra que no llegó a
      // entrar). No hay nada que revertir; ver 0216_1, «LOS DOS BORDES».
      logger.exception('billing:reembolso_sin_compra', new Error('voidedPurchase de una compra no acreditada'), {
        external_id: orden.externalId,
        motivo: orden.motivo,
      })
    } else if (resultado.perdido > 0) {
      // La pérdida se asume y se AUDITA: además del raw_receipt del apunte,
      // queda aquí para que soporte pueda contarla sin consultar la base.
      logger.warn('billing:reembolso_con_perdida', {
        external_id: orden.externalId,
        motivo: orden.motivo,
        estado: resultado.estado,
        revertido: resultado.revertido,
        perdido: resultado.perdido,
      })
    } else {
      // 'revertida' limpia o 'reintento' (que NO es un error: Pub/Sub reenvía
      // con backoff y la idempotencia responde con las cifras del primero).
      logger.info('billing:reembolso_revertido', {
        external_id: orden.externalId,
        motivo: orden.motivo,
        estado: resultado.estado,
        revertido: resultado.revertido,
      })
    }
    return
  }

  const aviso = notificacion.oneTimeProductNotification
  if (!aviso?.purchaseToken || !aviso.sku) return

  // `notificationType`: 1 = ONE_TIME_PRODUCT_PURCHASED, 2 = ...CANCELED.
  if (aviso.notificationType !== 1) return

  // Se vuelve a preguntar a Google por el estado real. La notificación dice que
  // ALGO pasó; la fuente de verdad es `purchases.products.get`.
  const recibo = await verificarRecibo(`${aviso.sku}|${aviso.purchaseToken}`)
  if (!recibo.valido || !recibo.externalId) {
    logger.info('billing:webhook_google_rechazado', { motivo: recibo.motivo ?? 'desconocido' })
    return
  }

  const paquete = resolverPaquete(recibo.productId)
  if (!paquete) {
    logger.exception('billing:webhook_google_producto', new Error(`productId sin paquete: ${String(recibo.productId)}`), {})
    return
  }

  // El destinatario sale de `obfuscatedExternalAccountId`, que la app fija al
  // `profiles.id` al lanzar la compra. Sin él no se adivina a quién acreditar:
  // la persona lo recupera con `POST /api/billing/restore`, que sí tiene sesión.
  //
  // Llega ya dentro del recibo. Aquí había una SEGUNDA llamada a
  // `purchases.products.get`, idéntica a la que acaba de hacer
  // `verificarRecibo()`, solo para releer este campo: existía porque el recibo
  // lo descartaba, y lo descartaba porque nadie más lo comprobaba. Cerrar la
  // titularidad en `verify` y `restore` se llevó por delante la llamada de más.
  const userId = recibo.cuentaApp
  if (!userId) {
    logger.exception('billing:webhook_google_sin_destinatario', new Error('obfuscatedExternalAccountId ausente'), {
      external_id: recibo.externalId,
    })
    return
  }

  const resultado = await acreditarCompra(createAdminClient(), {
    userId,
    externalId: recibo.externalId,
    sku: paquete.sku,
    source: 'iap_google',
    recibo: { productId: recibo.productId, externalId: recibo.externalId },
  })

  // Acknowledge SIEMPRE después de acreditar: sin él, Google revierte el cobro
  // a los 3 días y la persona se queda los cristales gratis.
  if (resultado.acreditado) {
    const ok = await confirmarCompra(aviso.sku, aviso.purchaseToken)
    if (!ok) {
      logger.exception('billing:acknowledge_fallido', new Error('acknowledge de Google no confirmado'), {
        external_id: recibo.externalId,
      })
    }
  }
}
