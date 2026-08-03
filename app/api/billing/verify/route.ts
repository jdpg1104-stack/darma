// ============================================================================
// POST /api/billing/verify  { plataforma, token } → ResultadoAcreditacion
//
// El camino normal de una compra: la app completa el pago con la tienda y manda
// aquí el identificador de la transacción. **Nunca la cantidad.**
//
// ── EL ORDEN, QUE ES LA SEGURIDAD ───────────────────────────────────────────
//  1. Sesión. El `userId` sale de la cookie, jamás del body: aceptar un
//     `userId` es acreditar la compra de uno en la cuenta de otro.
//  2. Rate limit `failClosed`. Es una ruta de dinero: si Postgres no responde,
//     no se pasa.
//  3. zod `.strict()`. Un `crystals: 999999` en el body no se ignora: se
//     rechaza con 422 y queda en el log.
//  4. **Verificación servidor-a-servidor** con Apple o Google. Si falla o es
//     ambigua → no se acredita nada y se responde `entrada_invalida` SIN el
//     motivo (el motivo describe nuestra validación; va al log).
//  5. El `productId` que devuelve LA TIENDA se resuelve contra el catálogo. El
//     que dijera la app no se mira.
//  6. Acreditación idempotente. Un reintento devuelve `acreditado: false` con
//     200: no es un error, es la respuesta correcta a un reintento.
//  7. Google: `acknowledge` DESPUÉS de acreditar. Sin él, Google revierte el
//     cobro a los 3 días y la persona se queda los cristales gratis.
//
// ── POR QUÉ EL CLIENTE ADMIN ────────────────────────────────────────────────
// `acreditar_compra()` está concedida solo a `service_role` (CONTRATOS §6 pide
// justificar el admin): con el cliente RLS devuelve 42501, y es a propósito —
// si `authenticated` pudiera llamarla, la ruta sobraría y cualquiera se
// acreditaría cristales con un `curl` a PostgREST.
//
// 🔴 Aquí no se llama a `award_karma()` ni se escribe en ninguna columna de
// karma. El dinero entra por `profiles.crystals` y no sale de ahí.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { verificarRecibo as verificarApple } from '@/lib/billing/apple'
import { resolverPaquete } from '@/lib/billing/catalogo'
import { confirmarCompra, verificarRecibo as verificarGoogle } from '@/lib/billing/google'
import { acreditarCompra, origenDePlataforma } from '@/lib/billing/ledger'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { esquemaVerificar, parsear } from '@/lib/billing/validacion'
import { logger } from '@/lib/logger'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const supabase = await createClient()

    const permitido = await rateLimit({
      key: `billing:verify:${sesion.userId}`,
      limit: LIMITES_PETICION.verify.limite,
      windowSeconds: LIMITES_PETICION.verify.ventanaSegundos,
      supabase,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const { plataforma, token } = parsear(esquemaVerificar, await leerCuerpo(request))

    const recibo =
      plataforma === 'apple' ? await verificarApple(token) : await verificarGoogle(token)

    if (!recibo.valido || !recibo.externalId) {
      // El motivo describe nuestra validación (bundleId ajeno, entorno de
      // sandbox, transacción reembolsada). Al cliente, nada de eso.
      logger.info('billing:recibo_rechazado', {
        plataforma,
        user_id: sesion.userId,
        motivo: recibo.motivo ?? 'desconocido',
      })
      throw new ErrorApi('entrada_invalida')
    }

    const paquete = resolverPaquete(recibo.productId)
    if (!paquete) {
      logger.exception(
        'billing:producto_fuera_de_catalogo',
        new Error(`productId sin paquete: ${String(recibo.productId)}`),
        { plataforma, user_id: sesion.userId },
      )
      throw new ErrorApi('entrada_invalida')
    }

    const admin = createAdminClient()
    const resultado = await acreditarCompra(admin, {
      userId: sesion.userId,
      externalId: recibo.externalId,
      sku: paquete.sku,
      source: origenDePlataforma(plataforma),
      recibo: { productId: recibo.productId, externalId: recibo.externalId },
    })

    // Google: acknowledge DESPUÉS de acreditar. Si falla, se registra y se
    // reintentará; nunca revierte una acreditación ya hecha (ver google.ts).
    if (plataforma === 'google' && resultado.acreditado) {
      const separador = token.indexOf('|')
      const ok = await confirmarCompra(token.slice(0, separador), token.slice(separador + 1))
      if (!ok) {
        logger.exception('billing:acknowledge_fallido', new Error('acknowledge de Google no confirmado'), {
          user_id: sesion.userId,
          external_id: recibo.externalId,
        })
      }
    }

    return sobreOk(resultado)
  })
}

/** `request.json()` lanza con un cuerpo vacío; eso es un 422, no un 500. */
async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
