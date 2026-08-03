// ============================================================================
// B10 · POST /api/refuges/crisis — el nivel de riesgo, NUNCA el texto
//
// ⚠️ ESTA RUTA ES LA MÁS FÁCIL DE ESTROPEAR DE TODO EL BLOQUE, Y EL DAÑO SERÍA
// SILENCIOSO. Léelo entero antes de tocarla.
//
// El servidor no puede leer un mensaje de refugio, así que `assessCrisisRisk()`
// (`lib/crisis.ts`) corre EN EL CLIENTE, sobre el texto en claro, ANTES de
// cifrar. Hasta aquí llega el nivel, la sala y qué recursos se mostraron. Nada
// más. El esquema zod es `.strict()`, así que un body con un campo `texto`, o
// `preview`, o `fragmento`, devuelve **422** en vez de aceptarlo y guardarlo.
// Hay una prueba obligatoria (nº 11 de la ficha) que lo comprueba, y existe
// precisamente para que dentro de seis meses nadie añada «solo un preview».
//
// ── LO QUE SÍ PASA, Y EN QUÉ ORDEN ─────────────────────────────────────────
// 1. El cliente evalúa el texto en claro y, si el nivel es high/critical,
//    muestra la tarjeta de recursos EN LA MISMA INTERACCIÓN (CONTRATOS §9.1).
// 2. Cifra y envía el mensaje IGUALMENTE. Se prioriza, no se censura
//    (CONTRATOS §9.2): la persona pidió ayuda de la única forma que pudo y no
//    se le va a borrar el mensaje por haberlo hecho.
// 3. Llama aquí para dejar constancia en `crisis_events`.
//
// ── POR QUÉ UNA RPC Y NO UN INSERT ─────────────────────────────────────────
// `crisis_events` no tiene ninguna política RLS ni ningún privilegio para
// `authenticated` (0002 §5) y así tiene que seguir: es la tabla que dice quién
// está en riesgo, y leerla sería leer un diagnóstico ajeno.
// `b10_registrar_crisis_refugio()` (0110_1) es la única puerta, solo escribe, y
// saca el `user_id` de `auth.uid()`: no se puede marcar en crisis a otra
// persona, que sería una forma de meterla en una cola de revisión humana desde
// fuera.
//
// ── LO QUE NO HACE ESTA RUTA Y NO DEBE HACER NUNCA ─────────────────────────
// Avisar a las almas afines. Suena humano y es exactamente lo que no se puede
// hacer: revela un dato de salud mental a terceros sin consentimiento y hace
// que la gente deje de escribir con sinceridad. La única señal que ven los
// contactos es `profiles.availability = 'necesito_hablar'`, puesta por la
// propia persona. Opt-in, siempre (HANDOFF/B10.md §10).
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { codigoDesdeErrorDeRefugio, contexto, limitar } from '../_dominio/servidor'
import { esquemaCrisis } from '../_dominio/validacion'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('crisis_refugio', ctx)

    const cuerpo = esquemaCrisis.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) {
      // Un 422 aquí incluye el caso «el body traía un campo de texto». Es el
      // único sitio del bloque donde un error de validación es una defensa y no
      // una molestia.
      throw new ErrorApi('entrada_invalida')
    }

    const { refugeId, risk, recursos, countryCode } = cuerpo.data

    const { error } = await ctx.supabase.rpc('b10_registrar_crisis_refugio', {
      p_refuge: refugeId,
      p_risk: risk,
      p_recursos: recursos,
      p_country_code: countryCode ?? null,
    })

    if (error) throw codigoDesdeErrorDeRefugio(error)

    // Se responde `ok` también con 'none' y 'low', que la función descarta sin
    // escribir: el cliente no tiene por qué saber dónde está el umbral, y
    // devolver un error distinto por nivel sería un oráculo del clasificador.
    return sobreOk({ ok: true })
  })
}
