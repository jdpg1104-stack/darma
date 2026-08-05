// ============================================================================
// POST /api/billing/boost  { postId, medioPreferido?, idempotencia? }
//   → ResultadoBoost
// GET  /api/billing/boost  → EstadoBoost (lo que la UI necesita para ofrecer
//                            karma ANTES que dinero)
//
// ── 🔴 LÍNEA ROJA ───────────────────────────────────────────────────────────
// Si no se manda `medioPreferido`, el servidor resuelve **gratis → karma →
// cristales**. El dinero es el último recurso, nunca el primero, y nunca es la
// barrera para ser escuchado: hay un cupo gratuito diario que financia el karma
// ya ganado escuchando.
//
// Si se manda `medioPreferido`, se RESPETA. Cuando alguien ha elegido pagar con
// karma no se le cobra dinero "porque no le llegaba": se le devuelve
// `saldo_insuficiente` y decide él.
//
// El post en riesgo alto o crítico, y el moderado, se rechazan ANTES de cobrar
// nada (DA004). Y esta ruta no toca `crisis_events` ni una vez.
//
// ── POR QUÉ EL CLIENTE ADMIN ────────────────────────────────────────────────
// `impulsar_post()` está concedida solo a `service_role`, y `boosts` no tiene
// política de INSERT: cobro y registro tienen que ocurrir en la misma
// transacción del servidor. Si esto se pudiera hacer desde el cliente RLS, se
// podría insertar el boost sin haber cobrado.
// ============================================================================

import type { NextRequest } from 'next/server'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { estadoBoost, impulsarPost, opcionesDePago } from '@/lib/billing/boosts'
import { LIMITES_PETICION } from '@/lib/billing/limites'
import { CLAVE_EXPLICACION_CUPO_GRATIS, CLAVE_LINEA_ROJA } from '@/lib/billing/textos'
import { esquemaBoost, parsear } from '@/lib/billing/validacion'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: NextRequest) {
  return manejarRuta(async () => {
    await requirePerfil()
    const supabase = await createClient()

    // `mi_cupo_boost()` es `security definer` y filtra por `auth.uid()` dentro,
    // así que va por el cliente RLS: el saldo gastable y los cristales son
    // privados y `authenticated` no tiene privilegio de columna sobre ellos.
    const estado = await estadoBoost(supabase)

    return sobreOk({
      ...estado,
      // Ya ordenadas: gratis, karma y solo al final el dinero. Cada opción trae
      // su CLAVE de catálogo y el coste aparte; la etiqueta la arma la vista.
      opciones: opcionesDePago(estado),
      // Claves, no texto: esta ruta no sabe en qué idioma lee quien pregunta.
      lineaRojaClave: CLAVE_LINEA_ROJA,
      explicacionCupoClave: CLAVE_EXPLICACION_CUPO_GRATIS,
    })
  })
}

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
      key: `billing:boost:${sesion.userId}`,
      limit: LIMITES_PETICION.boost.limite,
      windowSeconds: LIMITES_PETICION.boost.ventanaSegundos,
      supabase: admin,
      failClosed: true,
    })
    if (!permitido.ok) throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })

    const datos = parsear(esquemaBoost, await leerCuerpo(request))

    const resultado = await impulsarPost(admin, {
      // De la SESIÓN. Aceptar un userId del body sería gastar el karma de otra
      // persona en el post que uno quiera (CONTRATOS §6).
      userId: sesion.userId,
      postId: datos.postId,
      ...(datos.medioPreferido ? { medioPreferido: datos.medioPreferido } : {}),
      idempotencia: datos.idempotencia ?? null,
    })

    return sobreOk(resultado)
  })
}

async function leerCuerpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
