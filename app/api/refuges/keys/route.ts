// ============================================================================
// B10 · GET/POST /api/refuges/keys — el directorio de claves públicas
//
// ── POR QUÉ ESTO ES PÚBLICO Y NO PASA NADA ─────────────────────────────────
// Una clave pública de ECDH no descifra nada ni firma nada. Ocultarla no añade
// seguridad y sí rompe el intercambio: para escribirte, alguien tiene que poder
// derivar un secreto compartido contigo, y para eso necesita tu pública.
//
// ── LO QUE SÍ PROTEGE ESTA RUTA ────────────────────────────────────────────
// El GET pide ids EXPLÍCITOS (máximo 20) y no admite listar. Sin ese límite
// sería un enumerador del padrón de la red: quién tiene cuenta, quién ha
// estrenado dispositivo y cuándo. El POST está limitado a 3 al día porque rotar
// la clave de identidad tres veces en un día no es un uso legítimo, es una
// sonda contra el aviso de «esta persona ha cambiado de dispositivo».
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import type { ClavePublicaPerfil } from '@/lib/crypto/tipos'
import {
  codigoDesdeErrorDeRefugio,
  contexto,
  limitar,
  type FilaClavePublica,
} from '../_dominio/servidor'
import { esquemaBusquedaClaves, esquemaPublicarClave } from '../_dominio/validacion'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('refugio_leer', ctx)

    const crudo = new URL(request.url).searchParams.get('userIds') ?? ''
    const entrada = esquemaBusquedaClaves.safeParse({
      userIds: crudo.split(',').map((s) => s.trim()).filter(Boolean),
    })
    if (!entrada.success) throw new ErrorApi('entrada_invalida')

    const { data, error } = await ctx.supabase
      .from('user_keys')
      .select('user_id, public_jwk, fingerprint, key_version')
      .in('user_id', entrada.data.userIds)

    if (error) throw codigoDesdeErrorDeRefugio(error)

    const claves: ClavePublicaPerfil[] = ((data ?? []) as FilaClavePublica[]).map((f) => ({
      userId: f.user_id,
      publicJwk: f.public_jwk,
      fingerprint: f.fingerprint,
      keyVersion: f.key_version,
    }))

    // Quien no tenga clave publicada simplemente no aparece. No se devuelve un
    // hueco ni un `null` por id pedido: la ausencia no es información que haya
    // que confirmar id a id.
    return sobreOk(claves)
  })
}

/**
 * Publica (o rota) la clave pública de este dispositivo.
 *
 * `upsert` sobre la PK `user_id`: una persona tiene una sola clave vigente. Al
 * rotar, los sobres antiguos quedan ilegibles y eso es una PROPIEDAD, no un
 * fallo — es lo que hace que un dispositivo perdido deje de poder leer lo que
 * venga después.
 *
 * La huella la calcula el cliente y aquí NO se recalcula, porque el servidor no
 * es la autoridad de esa huella: si se recalculara y se guardara la nuestra,
 * un servidor comprometido podría servir una JWK falsa con una huella
 * coherente. Que la huella venga del cliente y se compare EN OTRO CLIENTE es lo
 * que hace que el número de seguridad detecte al servidor.
 */
export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('keys', ctx)

    const cuerpo = esquemaPublicarClave.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    const { publicJwk, fingerprint, keyVersion } = cuerpo.data

    // Deliberadamente NO se usa `upsert`. PostgREST lo traduce a
    // `on conflict do update set` con TODAS las columnas enviadas, incluida
    // `user_id`, y `user_id` no está entre las que 0110_1 concede en el UPDATE
    // (rescribirla sería adueñarse de la clave de otro). El upsert moriría con
    // un 42501 que además, traducido, se vería como un 404. Update primero,
    // insert si no había fila.
    const { data: actualizadas, error: errorUpdate } = await ctx.supabase
      .from('user_keys')
      .update({
        public_jwk: publicJwk,
        fingerprint,
        key_version: keyVersion,
        rotated_at: new Date().toISOString(),
      })
      .eq('user_id', ctx.sesion.userId)
      .select('user_id')

    if (errorUpdate) throw codigoDesdeErrorDeRefugio(errorUpdate)

    if ((actualizadas ?? []).length === 0) {
      // `rotated_at` NO va en el INSERT: no está entre las columnas concedidas,
      // y además un alta no es una rotación.
      const { error: errorInsert } = await ctx.supabase.from('user_keys').insert({
        user_id: ctx.sesion.userId,
        public_jwk: publicJwk,
        fingerprint,
        key_version: keyVersion,
      })
      if (errorInsert) throw codigoDesdeErrorDeRefugio(errorInsert)
    }

    return sobreOk({ fingerprint, keyVersion })
  })
}
