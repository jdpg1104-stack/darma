// ============================================================================
// POST /api/billing/webhook/apple — App Store Server Notifications V2
//
// ── LA FIRMA SE VERIFICA ANTES DE LEER EL CUERPO ────────────────────────────
// Apple manda un JWS (`signedPayload`) firmado con una cadena de certificados
// que llega hasta **Apple Root CA - G3**. Se valida la cadena entera y la
// huella de la raíz antes de creerse un solo campo. Un webhook sin verificación
// de firma no es "un endpoint sin autenticación": es una API pública para
// regalarse cristales, porque el cuerpo dice a quién acreditar y cuánto.
//
// ── LLEGA SIN SESIÓN, Y `proxy.ts` LO BLOQUEA HOY ───────────────────────────
// `PUBLIC_ROUTES` de `proxy.ts` (dueño F4) no incluye `/api/billing/`, así que
// una petición sin cookie recibe un 401 JSON antes de llegar aquí — y Apple lo
// interpreta como fallo y reintenta durante días sin éxito. **No se edita
// `proxy.ts`**: está anotado en `HANDOFF/PEDIDOS.md` y mientras tanto el
// handler se prueba invocándolo directamente.
//
// ── SIEMPRE 200, SALVO FIRMA INVÁLIDA ───────────────────────────────────────
// Un 5xx por una excepción nuestra provoca días de reintentos. El trabajo es
// idempotente (`on conflict (external_id) do nothing`), así que reintentar no
// duplica nada — pero tampoco arregla nada, y llena los logs de Apple y los
// nuestros. Firma inválida sí devuelve 401: ahí no hay nada que reintentar.
//
// 🔴 Este handler acredita cristales. No llama a `award_karma()` ni escribe en
// ninguna columna de karma.
// ============================================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import {
  configApple,
  evaluarTransaccion,
  verificarJwsApple,
  type TransaccionApple,
} from '@/lib/billing/apple'
import { resolverPaquete } from '@/lib/billing/catalogo'
import { acreditarCompra } from '@/lib/billing/ledger'
import { reembolsoDeApple, revertirCompra } from '@/lib/billing/reembolsos'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Cuerpo del `signedPayload` de una notificación V2. */
interface NotificacionApple {
  notificationType?: string
  subtype?: string
  notificationUUID?: string
  data?: { signedTransactionInfo?: string }
}

const CABECERAS = { 'Cache-Control': 'private, no-store' } as const

export async function POST(request: NextRequest) {
  const config = configApple()
  if (!config) {
    // Fail-closed: sin raíz de confianza no se puede verificar nada, y no
    // verificar significa no acreditar.
    logger.exception('billing:webhook_apple_sin_configurar', new Error('APPLE_* ausentes'), {})
    return NextResponse.json({ ok: false as const, code: 'error_interno', message: 'No disponible.' }, { status: 503, headers: CABECERAS })
  }

  // Texto plano, no JSON: la firma se verifica sobre el JWS antes de parsear
  // nada. Parsear primero y verificar después es el orden que permite que un
  // cuerpo malicioso llegue a ejecutar código de parseo.
  let cuerpo: { signedPayload?: string }
  try {
    cuerpo = JSON.parse(await request.text()) as { signedPayload?: string }
  } catch {
    return NextResponse.json({ ok: false as const, code: 'entrada_invalida', message: 'No podemos procesar esto.' }, { status: 422, headers: CABECERAS })
  }

  if (!cuerpo.signedPayload) {
    return NextResponse.json({ ok: false as const, code: 'entrada_invalida', message: 'No podemos procesar esto.' }, { status: 422, headers: CABECERAS })
  }

  const sobre = verificarJwsApple(cuerpo.signedPayload, config) as unknown as {
    ok: boolean
    payload: NotificacionApple | null
    motivo: string | null
  }

  if (!sobre.ok || !sobre.payload) {
    logger.exception('billing:webhook_apple_firma', new Error(sobre.motivo ?? 'firma no verificada'), {})
    return NextResponse.json({ ok: false as const, code: 'sin_permiso', message: 'No puedes hacer esto.' }, { status: 401, headers: CABECERAS })
  }

  try {
    await procesar(sobre.payload, config)
  } catch (causa) {
    // Se traga a propósito: un 5xx aquí son días de reintentos de Apple por un
    // fallo que no van a arreglar reintentando. Queda entero en el log.
    logger.exception('billing:webhook_apple_proceso', causa, {
      notification_uuid: sobre.payload.notificationUUID ?? 'desconocido',
    })
  }

  return NextResponse.json({ ok: true as const, data: { recibido: true } }, { status: 200, headers: CABECERAS })
}

async function procesar(
  notificacion: NotificacionApple,
  config: ReturnType<typeof configApple> & object,
): Promise<void> {
  const firmada = notificacion.data?.signedTransactionInfo
  if (!firmada) return

  const transaccion = verificarJwsApple(firmada, config)
  if (!transaccion.ok || !transaccion.payload) {
    logger.exception('billing:webhook_apple_transaccion', new Error(transaccion.motivo ?? 'no verificada'), {})
    return
  }

  const datos = transaccion.payload as TransaccionApple

  // REFUND / REVOKE: la corrección de un movimiento se hace insertando el
  // CONTRARIO con `source = 'refund'`, nunca modificando la fila original
  // (`trg_crystal_ledger_immutable` lo impide incluso a service_role). La
  // política entera —suelo en 0, apunte SIEMPRE, pérdida auditada— vive en
  // `revertir_compra` (0216_1); aquí solo se decide QUÉ revertir, y eso lo
  // resuelve `reembolsoDeApple()` sobre la transacción YA verificada.
  if (notificacion.notificationType === 'REFUND' || notificacion.notificationType === 'REVOKE') {
    const orden = reembolsoDeApple(notificacion.notificationType, datos)
    if (!orden) {
      // Un reembolso sin transactionId no da orden: no se adivina contra qué
      // compra ejecutarlo. Queda en el log para soporte.
      logger.exception('billing:reembolso_sin_transaccion', new Error('REFUND sin transactionId'), {})
      return
    }

    const resultado = await revertirCompra(createAdminClient(), orden)

    if (resultado.estado === 'sin_compra') {
      // Reembolso de una compra que nunca se acreditó (webhook perdido o compra
      // que nadie restauró). No hay nada que revertir; ver 0216_1, «LOS DOS
      // BORDES»: si la acreditación llegara después, la detecta la
      // reconciliación pedida en PEDIDOS, no este handler.
      logger.exception('billing:reembolso_sin_compra', new Error('REFUND de una compra no acreditada'), {
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
      // 'revertida' limpia o 'reintento' (que NO es un error: la store reenvía
      // durante días y la idempotencia responde con las cifras del primero).
      logger.info('billing:reembolso_revertido', {
        external_id: orden.externalId,
        motivo: orden.motivo,
        estado: resultado.estado,
        revertido: resultado.revertido,
      })
    }
    return
  }

  const recibo = evaluarTransaccion(datos, config)
  if (!recibo.valido || !recibo.externalId) {
    logger.info('billing:webhook_apple_rechazado', { motivo: recibo.motivo ?? 'desconocido' })
    return
  }

  // El destinatario sale del recibo VERIFICADO, no de la petición: aquí no hay
  // sesión y no puede haberla.
  const userId = datos.appAccountToken
  if (!userId) {
    // Sin `appAccountToken` no sabemos a quién acreditar. No se adivina: la
    // persona lo recupera con `POST /api/billing/restore`, que sí tiene sesión.
    logger.exception('billing:webhook_apple_sin_destinatario', new Error('appAccountToken ausente'), {
      external_id: recibo.externalId,
    })
    return
  }

  const paquete = resolverPaquete(recibo.productId)
  if (!paquete) {
    logger.exception('billing:webhook_apple_producto', new Error(`productId sin paquete: ${String(recibo.productId)}`), {})
    return
  }

  await acreditarCompra(createAdminClient(), {
    userId,
    externalId: recibo.externalId,
    sku: paquete.sku,
    source: 'iap_apple',
    recibo: datos,
  })
}
