// ============================================================================
// B10 · GET/POST /api/refuges/[id]/sobre — la clave del refugio, envuelta
//
// GET devuelve TU sobre y solo el tuyo (`envelopes_read_recipient`). No hay
// forma de listar los sobres de una sala: poder hacerlo sería poder enumerar
// quién está en qué conversación, que es un dato tan sensible como el contenido.
//
// POST es la vía de reenviar la clave a alguien —porque estrenó dispositivo, o
// porque acaba de entrar—. La política exige que quien envía siga siendo
// miembro y que no haya bloqueo vivo con quien recibe, así que un sobre no
// puede ser el camino para alcanzar a quien te bloqueó.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { base64AHexPostgres, hexPostgresABase64 } from '@/lib/crypto/base64'
import type { SobreCifrado } from '@/lib/crypto/tipos'
import {
  codigoDesdeErrorDeRefugio,
  contexto,
  exigirRefugio,
  limitar,
  type FilaSobre,
} from '../../_dominio/servidor'
import { esquemaSobre } from '../../_dominio/validacion'

export const dynamic = 'force-dynamic'

const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = (await params).id
    if (!uuidValido.test(refugeId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('refugio_leer', ctx)
    await exigirRefugio(ctx, refugeId)

    const { data, error } = await ctx.supabase
      .from('refuge_key_envelopes')
      .select('refuge_id, wrapped_key, wrap_nonce, sender_fingerprint, key_version')
      .eq('refuge_id', refugeId)
      .eq('recipient_id', ctx.sesion.userId)
      .maybeSingle()

    if (error) throw codigoDesdeErrorDeRefugio(error)

    // `null` es una respuesta legítima y frecuente: la sala existe, eres
    // miembro, pero nadie te ha enviado todavía la clave (o rotaste y el sobre
    // viejo dejó de servir). La UI lo distingue de un error y ofrece pedirla.
    if (!data) return sobreOk<SobreCifrado | null>(null)

    const fila = data as FilaSobre
    return sobreOk<SobreCifrado | null>({
      refugeId: fila.refuge_id,
      wrappedKeyB64: hexPostgresABase64(fila.wrapped_key),
      wrapNonceB64: hexPostgresABase64(fila.wrap_nonce),
      senderFingerprint: fila.sender_fingerprint,
      keyVersion: fila.key_version,
    })
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = (await params).id
    if (!uuidValido.test(refugeId)) throw new ErrorApi('no_encontrado')

    const ctx = await contexto()
    await limitar('sobre', ctx)

    const cuerpo = esquemaSobre.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    await exigirRefugio(ctx, refugeId)

    const { recipientId, wrappedKeyB64, wrapNonceB64, senderFingerprint, keyVersion } = cuerpo.data

    const { error } = await ctx.supabase.from('refuge_key_envelopes').insert({
      refuge_id: refugeId,
      recipient_id: recipientId,
      sender_id: ctx.sesion.userId,
      wrapped_key: base64AHexPostgres(wrappedKeyB64),
      wrap_nonce: base64AHexPostgres(wrapNonceB64),
      sender_fingerprint: senderFingerprint,
      key_version: keyVersion,
    })

    if (error) throw codigoDesdeErrorDeRefugio(error)
    return sobreOk({ ok: true }, 201)
  })
}
