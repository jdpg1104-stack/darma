// ============================================================================
// POST /api/billing/restore  { plataforma, referencia }
//   → { acreditados: number; saldo: number }
//
// Sin esto, quien reinstala la app pierde lo que pagó y pide un reembolso con
// toda la razón. La restauración re-verifica el historial de transacciones
// contra la tienda y acredita **lo que falte**, apoyándose en el mismo
// `on conflict (external_id) do nothing`: lo que ya estaba no se duplica, y por
// eso la ruta se puede llamar mil veces sin consecuencia.
//
// ── EL RATE LIMIT MÁS BAJO DEL BLOQUE, Y NO ES UNA ERRATA ───────────────────
// Una sola petición aquí dispara N verificaciones contra la App Store Server
// API. Sin freno nos convertimos en un cliente abusivo y Apple limita a
// NOSOTROS: dejaría de funcionar la verificación de todas las compras
// legítimas, no solo la restauración.
//
// ── RESTAURAR ES ATRIBUIR, Y ESO HAY QUE COMPROBARLO ────────────────────────
// Esta ruta acreditaba a `sesion.userId` CUALQUIER recibo que Apple diera por
// bueno. La firma responde «esta compra existió»; no responde «es tuya». Y el
// `originalTransactionId` que se manda en `referencia` NO es un secreto: sale en
// capturas de pantalla, en hilos de soporte y en los correos de reembolso. Quien
// consiguiera uno ajeno reclamaba esa compra en su cuenta.
//
// El `unique(external_id)` del ledger no tapaba nada de esto. Impide cobrar dos
// veces; no impide atribuir mal. Y en cuanto el atacante gana la carrera, esa
// misma idempotencia se vuelve contra el dueño real: su compra «ya existe», así
// que no puede restaurarla nunca más. El daño no es un cobro duplicado, es una
// compra perdida y una persona con razón para pedir el reembolso.
//
// Ahora, antes de tocar el ledger, el historial pasa entero por
// `clasificarRestauracion()` (lib/billing/apple.ts, donde vive la política y
// donde se prueba sin red):
//
//   · titular = sesión  → se acredita.
//   · titular ≠ sesión  → 403 `sin_permiso` y NO se acredita nada, ni siquiera
//                         los recibos del mismo historial que sí coincidieran.
//                         Un `originalTransactionId` es de una sola cuenta de
//                         Apple: si uno es ajeno, la restauración entera lo es.
//   · sin titular       → no se acredita, pero tampoco se acusa: 200 con
//                         `acreditados: 0`. El porqué de esta tercera vía, y
//                         qué se pierde con ella, está escrito entero en
//                         `comprobarTitular()`.
//
// El intento ajeno se registra con huellas, no con identificadores: el
// `appAccountToken` de un recibo ajeno es el `profiles.id` de OTRA persona, y
// atarlo en un log a la sesión de quien lo está probando es el cruce de
// identidades que CONTRATOS §2 declara inexistente. Con la huella se detecta el
// patrón —una cuenta probando titulares distintos— sin guardar de quién es cada
// uno, y sin volcar el recibo.
//
// ⚠️ La comprobación es de Apple. El camino de Google no la tiene: su
// equivalente es `obfuscatedExternalAccountId` y vive en `lib/billing/google.ts`
// (queda anotado). El riesgo no es el mismo — para restaurar por Google hay que
// presentar el `purchaseToken` entero, que es un secreto largo y no algo que la
// gente pegue en un foro— pero la puerta sigue sin cerrar.
//
// 🔴 Restaurar acredita cristales. Nunca karma.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import {
  clasificarRestauracion,
  historialTransacciones,
  huellaTitular,
  type ReciboVerificado,
} from '@/lib/billing/apple'
import { resolverPaquete } from '@/lib/billing/catalogo'
import { verificarRecibo as verificarGoogle } from '@/lib/billing/google'
import { acreditarCompra, origenDePlataforma, type Plataforma } from '@/lib/billing/ledger'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { esquemaRestaurar, parsear } from '@/lib/billing/validacion'
import { logger } from '@/lib/logger'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Tope de compras a restaurar en una petición. Acota el coste del peor caso. */
const MAX_RESTAURAR = 50

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const admin = createAdminClient()

    // ⛔ EL CLIENTE ADMIN, NO EL RLS. `check_rate_limit()` está REVOCADA a
    // `authenticated` y concedida solo a `service_role` (0002_comunidad.sql).
    // Con el cliente RLS, Postgres devuelve 42501, `rateLimit` lanza, y como
    // aquí `failClosed: true` el resultado era un 429 SIEMPRE, para todo el
    // mundo: ninguna compra se podía acreditar. Y el 429 lo disfrazaba de «vas
    // muy rápido», así que el síntoma no llevaba a la causa.
    //
    // `failClosed` sigue en true y es correcto: si el limitador cae de verdad,
    // una ruta de dinero debe cerrarse, no abrirse.
    const permitido = await rateLimit({
      key: `billing:restore:${sesion.userId}`,
      limit: LIMITES_PETICION.restore.limite,
      windowSeconds: LIMITES_PETICION.restore.ventanaSegundos,
      supabase: admin,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const { plataforma, referencia } = parsear(esquemaRestaurar, await leerCuerpo(request))

    const recibos = await recibosARestaurar(plataforma, referencia, sesion.userId)

    let acreditados = 0
    let saldo = 0

    for (const recibo of recibos.slice(0, MAX_RESTAURAR)) {
      const paquete = resolverPaquete(recibo.productId)
      if (!paquete || !recibo.externalId) {
        // Una compra de un producto retirado del catálogo no se acredita a
        // ojo: se registra para revisarla a mano. Inventar una cantidad sería
        // exactamente lo que este bloque no puede hacer.
        logger.info('billing:restore_producto_desconocido', {
          user_id: sesion.userId,
          product_id: recibo.productId ?? 'null',
        })
        continue
      }

      const resultado = await acreditarCompra(admin, {
        userId: sesion.userId,
        externalId: recibo.externalId,
        sku: paquete.sku,
        source: origenDePlataforma(plataforma),
        recibo: { productId: recibo.productId, externalId: recibo.externalId, restaurada: true },
      })

      if (resultado.acreditado) acreditados += 1
      saldo = resultado.saldo
    }

    return sobreOk({ acreditados, saldo })
  })
}

/**
 * Apple da el historial completo a partir del `originalTransactionId`. Google
 * no tiene equivalente para consumibles: la app manda los pares
 * `productId|purchaseToken` que conserva localmente, separados por comas, y
 * cada uno se verifica por separado.
 *
 * Devuelve SOLO lo acreditable por esta sesión. Lo que sale de aquí ya no se
 * vuelve a preguntar de quién es: la comprobación de titularidad no puede
 * quedar suelta en el bucle de acreditación, donde un `continue` mal puesto la
 * saltaría sin que nadie lo notara.
 */
async function recibosARestaurar(
  plataforma: Plataforma,
  referencia: string,
  userId: string,
): Promise<ReciboVerificado[]> {
  if (plataforma === 'apple') return recibosDeApple(referencia, userId)

  const tokens = referencia.split(',').map((t) => t.trim()).filter(Boolean).slice(0, MAX_RESTAURAR)
  const verificados = await Promise.all(tokens.map((t) => verificarGoogle(t)))
  return verificados.filter((r) => r.valido)
}

/**
 * Historial de Apple, ya filtrado por titular. Lanza `sin_permiso` si el hilo
 * de transacciones pertenece a otra cuenta.
 */
async function recibosDeApple(referencia: string, userId: string): Promise<ReciboVerificado[]> {
  const historial = await historialTransacciones(referencia)
  const seleccion = clasificarRestauracion(historial, userId)

  if (seleccion.ajenas.length > 0) {
    // Nivel `warn`: es una señal de seguridad, no una anécdota. Lo que se
    // registra permite contar y correlacionar intentos —cuántos titulares
    // distintos ha probado esta sesión, si la misma referencia la prueban varias
    // cuentas— sin que en el log quede ni el recibo ni el id de nadie.
    logger.warn('billing:restore_titular_ajeno', {
      user_id: userId,
      huella_referencia: huellaTitular(referencia),
      huellas_titular: seleccion.ajenas,
      recibos_en_historial: historial.length,
    })
    throw new ErrorApi('sin_permiso')
  }

  if (seleccion.sinTitular > 0) {
    // NO es un ataque: lo más probable es una compra anterior a que la app
    // enviara el `appAccountToken`. Se registra para poder medir a cuánta gente
    // le estamos bloqueando una restauración legítima y atenderla a mano.
    logger.warn('billing:restore_sin_titular', {
      user_id: userId,
      huella_referencia: huellaTitular(referencia),
      recibos_sin_titular: seleccion.sinTitular,
    })
  }

  return seleccion.restaurables
}

async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
