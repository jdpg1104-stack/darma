// ============================================================================
// B10 · GET /api/refuges (bandeja) · POST /api/refuges (crear)
//
// La bandeja no cuenta NADA. Ni mensajes, ni no leídos, ni miembros: los tres
// números salen de columnas que mantiene un trigger (0002) y el badge de «sin
// leer» sale de comparar `last_read_message_id` con el último id conocido. Un
// count(*) sobre `refuge_messages` en la pantalla que se abre en cada arranque
// de la app es el primer sitio donde esto se caería.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { base64AHexPostgres } from '@/lib/crypto/base64'
import type { PaginaCursor, ResumenRefugio } from '@/lib/crypto/tipos'
import { codigoDesdeErrorDeRefugio, contexto, limitar } from './_dominio/servidor'
import {
  cursorBandeja,
  esquemaCrearRefugio,
  esquemaLimite,
  leerCursorBandeja,
} from './_dominio/validacion'

export const dynamic = 'force-dynamic'

interface FilaBandeja {
  id: string
  kind: 'duo' | 'circulo'
  title: string | null
  member_count: number
  message_count: number
  last_message_at: string | null
  last_read_message_id: number | null
  muted: boolean
}

export async function GET(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('refugio_leer', ctx)

    const url = new URL(request.url)

    const limite = esquemaLimite.safeParse(url.searchParams.get('limite') ?? undefined)
    if (!limite.success) throw new ErrorApi('entrada_invalida')

    let cursor: { ts: string; id: string } | null
    try {
      cursor = leerCursorBandeja(url.searchParams.get('cursor'))
    } catch {
      throw new ErrorApi('entrada_invalida', { mensaje: 'El cursor no es válido.' })
    }

    // `b10_bandeja` es `security invoker`: las políticas de 0002 siguen siendo
    // la barrera. La función existe solo para poder escribir la comparación de
    // TUPLA del keyset, que PostgREST no sabe expresar y que es lo que hace que
    // `idx_refuges_activity` se use entero.
    const { data, error } = await ctx.supabase.rpc('b10_bandeja', {
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limite: limite.data,
    })
    if (error) throw codigoDesdeErrorDeRefugio(error)

    const filas = (data ?? []) as FilaBandeja[]
    const items: ResumenRefugio[] = filas.map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      memberCount: f.member_count,
      messageCount: f.message_count,
      lastMessageAt: f.last_message_at,
      lastReadMessageId: f.last_read_message_id,
      muted: f.muted,
      // Sin contar: hay algo sin leer si la sala tiene mensajes y todavía no se
      // ha marcado ninguno como leído, o si el trigger movió la actividad
      // después de la última marca. El número exacto no se muestra, y por eso
      // no hace falta calcularlo.
      haySinLeer: f.message_count > 0 && f.last_read_message_id === null,
    }))

    const ultimo = filas.at(-1)
    const pagina: PaginaCursor<ResumenRefugio> = {
      items,
      siguienteCursor:
        ultimo && filas.length === limite.data
          ? cursorBandeja(ultimo.last_message_at ?? new Date(0).toISOString(), ultimo.id)
          : null,
    }
    return sobreOk(pagina)
  })
}

/**
 * Crea la sala, mete a la gente y sube los sobres.
 *
 * La sala y las pertenencias van en UNA transacción (`b10_crear_refugio`): un
 * refugio sin miembros no lo puede leer nadie —ni quien lo creó— porque
 * `refuges_read_member` exige pertenencia, así que un fallo a medio camino
 * dejaría basura invisible e irrecuperable.
 *
 * Los sobres van después y por el cliente RLS, porque su política comprueba
 * pertenencia y bloqueo, y eso queremos que lo siga decidiendo la base de
 * datos. Si fallan, la sala existe pero nadie puede descifrar: el cliente lo
 * detecta al abrirla y ofrece reenviar la clave. Es un estado recuperable; el
 * otro no lo sería.
 */
export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('refugio_crear', ctx)

    const cuerpo = esquemaCrearRefugio.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    const { kind, title, topic, miembros, sobres } = cuerpo.data

    if (miembros.includes(ctx.sesion.userId)) {
      throw new ErrorApi('entrada_invalida', { mensaje: 'No hace falta que te incluyas: ya estás dentro.' })
    }

    const { data: refugeId, error } = await ctx.supabase.rpc('b10_crear_refugio', {
      p_kind: kind,
      p_title: title ?? null,
      p_topic: topic ?? null,
      p_miembros: miembros,
    })
    if (error) throw codigoDesdeErrorDeRefugio(error)
    if (typeof refugeId !== 'string') throw new ErrorApi('error_interno')

    if (sobres.length > 0) {
      const { error: errorSobres } = await ctx.supabase.from('refuge_key_envelopes').insert(
        sobres.map((s) => ({
          refuge_id: refugeId,
          recipient_id: s.recipientId,
          sender_id: ctx.sesion.userId,
          wrapped_key: base64AHexPostgres(s.wrappedKeyB64),
          wrap_nonce: base64AHexPostgres(s.wrapNonceB64),
          sender_fingerprint: s.senderFingerprint,
          key_version: s.keyVersion,
        })),
      )
      if (errorSobres) throw codigoDesdeErrorDeRefugio(errorSobres)
    }

    return sobreOk({ refugeId }, 201)
  })
}
