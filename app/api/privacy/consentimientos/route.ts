// ============================================================================
// GET  /api/privacy/consentimientos — qué has aceptado y qué te falta
// POST /api/privacy/consentimientos — registra una aceptación
//
// ── LO QUE EL CLIENTE NO PUEDE ENVIAR ──────────────────────────────────────
// El cuerpo del POST lleva el TIPO y nada más. Ni la versión, ni la huella del
// texto: las pone el servidor desde `lib/privacy/textos.ts`. Si el cliente
// pudiera elegirlas, podría declarar que aceptó la v1 mientras la app sirve la
// v2, y el registro dejaría de demostrar nada — que es justo lo que el art. 7.1
// del RGPD obliga a poder demostrar.
//
// Por eso `consents` tampoco tiene `grant insert` para `authenticated`
// (migración 0201): aunque esta ruta desapareciera, un PATCH directo a
// PostgREST seguiría sin poder escribir un consentimiento.
// ============================================================================

import { z } from 'zod'

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import {
  anotarConsentimiento,
  consentimientosPendientes,
  leerConsentimientos,
  versionVigente,
} from '@/lib/privacy/consentimientos'
import { createAdminClient } from '@/lib/supabase/admin'

import { limitarPrivacidad, registrarMovimiento } from '../_dominio/comun'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const EsquemaPost = z
  .object({
    tipo: z.enum(['terminos', 'privacidad', 'no_es_terapia', 'edad_minima', 'datos_agregados']),
  })
  .strict()

export async function GET() {
  return manejarRuta(async () => {
    // `requireSesion` y no `requirePerfil`: durante el onboarding hay sesión
    // pero todavía no hay alias, y es exactamente el momento en que la app
    // necesita saber qué consentimientos faltan.
    const sesion = await requireSesion()
    const admin = createAdminClient()

    const vigentes = await leerConsentimientos(admin, sesion.userId)

    return sobreOk({
      vigentes,
      pendientes: consentimientosPendientes(vigentes).map((tipo) => ({
        tipo,
        version: versionVigente(tipo),
      })),
    })
  })
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const admin = createAdminClient()

    await limitarPrivacidad('consentimientos', sesion.userId, admin)

    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      throw new ErrorApi('entrada_invalida')
    }

    const parseado = EsquemaPost.safeParse(cuerpo)
    if (!parseado.success) throw new ErrorApi('entrada_invalida')

    await anotarConsentimiento(admin, sesion.userId, parseado.data.tipo)

    registrarMovimiento('consentimiento_registrado', sesion.userId, {
      tipo: parseado.data.tipo,
      version: versionVigente(parseado.data.tipo),
    })

    return sobreOk({ tipo: parseado.data.tipo, version: versionVigente(parseado.data.tipo) })
  })
}
