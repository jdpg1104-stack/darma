// ============================================================================
// B10 · GET/POST /api/refuges/[id]/mensajes
//
// Aquí el servidor hace lo MENOS posible a propósito: no puede validar el
// contenido porque recibe un blob cifrado, así que valida tamaños, formato y
// pertenencia, y no toca nada más. `sender_id` sale de la sesión; el id de la
// sala, de la ruta.
//
// El keyset va sobre el `bigint id`, que ES el orden cronológico y el cursor a
// la vez (0002). Ordenar por `created_at` daría un cursor ambiguo con dos
// mensajes en el mismo milisegundo — y en una conversación de verdad eso pasa.
// ============================================================================

import type { NextRequest } from 'next/server'
import { avisar } from '@/lib/push'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { base64AHexPostgres, hexPostgresABase64 } from '@/lib/crypto/base64'
import type { MensajeCifrado, PaginaCursor } from '@/lib/crypto/tipos'
import {
  codigoDesdeErrorDeRefugio,
  contexto,
  exigirRefugio,
  limitar,
  type FilaMensaje,
} from '../../_dominio/servidor'
import {
  CIPHERTEXT_MAX_BYTES,
  NONCE_MAX_BYTES,
  NONCE_MIN_BYTES,
  bytesDeBase64,
  cursorHilo,
  esquemaEnviarMensaje,
  esquemaLimite,
  leerCursorHilo,
} from '../../_dominio/validacion'

export const dynamic = 'force-dynamic'

const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id de ruta mal formado se trata como «no existe», igual que uno ajeno: si
 *  respondiera distinto, la forma del error ya diría algo. */
function exigirUuid(id: string): string {
  if (!uuidValido.test(id)) throw new ErrorApi('no_encontrado')
  return id
}

function aMensaje(f: FilaMensaje): MensajeCifrado {
  return {
    id: Number(f.id),
    refugeId: f.refuge_id,
    senderId: f.sender_id,
    // `bytea` viaja en el formato `\x...` de Postgres. La frontera entre ese
    // formato y el base64 de la API está aquí y en el POST, en ningún otro sitio.
    ciphertextB64: hexPostgresABase64(f.ciphertext),
    nonceB64: hexPostgresABase64(f.nonce),
    encVersion: f.enc_version,
    kind: f.kind,
    createdAt: f.created_at,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = exigirUuid((await params).id)
    const ctx = await contexto()
    await limitar('refugio_leer', ctx)

    // Primero la sala: si no eres miembro (o hay un bloqueo vivo) esto lanza
    // `no_encontrado`, indistinguible de un uuid que no existe.
    await exigirRefugio(ctx, refugeId)

    const url = new URL(request.url)
    const limite = esquemaLimite.safeParse(url.searchParams.get('limite') ?? undefined)
    if (!limite.success) throw new ErrorApi('entrada_invalida')

    let cursor: number | null
    try {
      cursor = leerCursorHilo(url.searchParams.get('cursor'))
    } catch {
      throw new ErrorApi('entrada_invalida', { mensaje: 'El cursor no es válido.' })
    }

    let consulta = ctx.supabase
      .from('refuge_messages')
      .select('id, refuge_id, sender_id, ciphertext, nonce, enc_version, kind, created_at')
      .eq('refuge_id', refugeId)
      .eq('state', 'active')
      .order('id', { ascending: false })
      .limit(limite.data)

    if (cursor !== null) consulta = consulta.lt('id', cursor)

    const { data, error } = await consulta
    if (error) throw codigoDesdeErrorDeRefugio(error)

    const filas = (data ?? []) as FilaMensaje[]
    const pagina: PaginaCursor<MensajeCifrado> = {
      items: filas.map(aMensaje),
      siguienteCursor: filas.length === limite.data ? cursorHilo(Number(filas[filas.length - 1].id)) : null,
    }
    return sobreOk(pagina)
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return manejarRuta(async () => {
    const refugeId = exigirUuid((await params).id)
    const ctx = await contexto()
    await limitar('refuge_msg', ctx)

    const cuerpo = esquemaEnviarMensaje.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    const { ciphertextB64, nonceB64, encVersion, kind, byteSize } = cuerpo.data

    const bytesCifrado = bytesDeBase64(ciphertextB64)
    const bytesNonce = bytesDeBase64(nonceB64)
    if (bytesCifrado < 1 || bytesCifrado > CIPHERTEXT_MAX_BYTES) {
      throw new ErrorApi('entrada_invalida', { mensaje: 'Ese mensaje es demasiado largo.' })
    }
    if (bytesNonce < NONCE_MIN_BYTES || bytesNonce > NONCE_MAX_BYTES) {
      throw new ErrorApi('entrada_invalida')
    }

    // La comprobación de pertenencia la hace ya la política de INSERT de 0002.
    // Se repite aquí SOLO para poder devolver un error humano —y el mismo 404
    // que todo lo demás— en vez de un error de RLS traducido a ciegas.
    await exigirRefugio(ctx, refugeId)

    const { data, error } = await ctx.supabase
      .from('refuge_messages')
      .insert({
        refuge_id: refugeId,
        // De la SESIÓN. Aceptar un sender_id del cuerpo es la vulnerabilidad
        // más común de este tipo de app.
        sender_id: ctx.sesion.userId,
        ciphertext: base64AHexPostgres(ciphertextB64),
        nonce: base64AHexPostgres(nonceB64),
        enc_version: encVersion,
        kind,
        byte_size: byteSize,
      })
      .select('id, refuge_id, sender_id, ciphertext, nonce, enc_version, kind, created_at')
      .single()

    if (error) throw codigoDesdeErrorDeRefugio(error)

    // ── Aviso «mensaje_refugio» (B13) a los DEMÁS miembros de la sala ──────
    // SOLO con el INSERT ya confirmado. A `avisar()` van exclusivamente ids y
    // la ruta interna: NI el contenido (el servidor recibe un blob AES-256-GCM
    // y no tiene la clave — pedido B10 → B13), NI un alias, NI el título del
    // refugio. La plantilla de `mensaje_refugio` en `lib/push/plantillas.ts`
    // tampoco los acepta: la firma de `construirCarga` es la barrera.
    //
    // La lista de miembros sale del MISMO cliente RLS (regla 1 de
    // `_dominio/servidor.ts`: aquí jamás entra el admin) y trae `muted`, así
    // que quien silenció la sala se descarta ya en la ruta, sin una consulta
    // por destinatario; `avisar()` vuelve a comprobarlo por dentro
    // (`silenciadoEnRefugio`, con el `refugeId` que se le pasa) como segunda
    // capa. El `try` envuelve el bloque entero: un fallo del push jamás rompe
    // un mensaje que ya está guardado.
    try {
      const { data: miembros } = await ctx.supabase
        .from('refuge_members')
        .select('user_id, muted')
        .eq('refuge_id', refugeId)
        .is('left_at', null)

      for (const miembro of (miembros ?? []) as { user_id: string; muted: boolean | null }[]) {
        if (miembro.user_id === ctx.sesion.userId) continue
        if (miembro.muted === true) continue
        await avisar({
          destinatarioId: miembro.user_id,
          tipo: 'mensaje_refugio',
          emisorId: ctx.sesion.userId,
          refugeId,
          url: `/refugios/${refugeId}`,
        })
      }
    } catch {
      // Sin uuids ni contenido: el aviso es anónimo también en los logs.
      console.warn('[darma][b13] aviso mensaje_refugio no enviado')
    }

    return sobreOk({ mensaje: aMensaje(data as FilaMensaje) }, 201)
  })
}
