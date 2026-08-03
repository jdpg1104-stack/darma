// ============================================================================
// B10 · GET/POST /api/refuges/kindred — las almas afines
//
// ── LA FORMA DE LA RESPUESTA ES EL CONTRATO ────────────────────────────────
// `AlmaAfin` es `PerfilPublico` + `note`. NI UN CAMPO MÁS. Hay una prueba
// (`kindred.test.ts`) que comprueba las claves exactas del JSON, porque el día
// que alguien añada «solo el karma gastable, para ordenar mejor» se estará
// filtrando un dato privado de otra persona a través de la libreta de
// contactos. `authenticated` ni siquiera tiene SELECT sobre esas columnas
// (0001 + 0006), así que la barrera real está en el motor; esto es la segunda.
//
// ── LA SEÑAL DE DISPONIBILIDAD ES LA ÚNICA SEÑAL ───────────────────────────
// Lo que se ve de otra persona aquí es `profiles.availability`, que ella misma
// pone: 'disponible' / 'necesito_hablar' / 'ausente'. `crisis_events` NO se
// filtra por ningún camino, ni agregado, ni derivado, ni «solo un icono». Ver
// HANDOFF/B10.md §10.
// ============================================================================

import type { NextRequest } from 'next/server'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import type { AlmaAfin } from '@/lib/crypto/tipos'
import { codigoDesdeErrorDeRefugio, contexto, limitar } from '../_dominio/servidor'
import { esquemaKindred } from '../_dominio/validacion'
import { aAlmaAfin, type FilaKindred } from '../_dominio/proyecciones'

export const dynamic = 'force-dynamic'

export async function GET() {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('refugio_leer', ctx)

    // Un solo viaje: `kindred` con el join por PK a `profiles`. La lista de una
    // persona son N filas y N sondas por clave primaria, sin count(*) y sin
    // N+1 desde la aplicación. La política `kindred_read_own` ya limita las
    // filas a las propias.
    const { data, error } = await ctx.supabase
      .from('kindred')
      .select('kindred_id, note, profiles!kindred_kindred_id_fkey(id, alias, avatar_seed, level, karma_reputation, availability)')
      .eq('owner_id', ctx.sesion.userId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw codigoDesdeErrorDeRefugio(error)

    const almas = ((data ?? []) as unknown as FilaKindred[])
      .map(aAlmaAfin)
      .filter((a): a is AlmaAfin => a !== null)

    return sobreOk(almas)
  })
}

export async function POST(request: NextRequest) {
  return manejarRuta(async () => {
    const ctx = await contexto()
    await limitar('kindred', ctx)

    const cuerpo = esquemaKindred.safeParse(await request.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorApi('entrada_invalida')

    if (cuerpo.data.kindredId === ctx.sesion.userId) {
      throw new ErrorApi('entrada_invalida', { mensaje: 'No hace falta que te guardes a ti.' })
    }

    // `kindred_insert_own` exige `not is_blocked_with(kindred_id)`: guardar a
    // quien te bloqueó (o a quien bloqueaste) falla en la base de datos, no
    // aquí. Si esto se comprobara en la app, un POST directo a PostgREST lo
    // saltaría.
    const { error } = await ctx.supabase.from('kindred').insert({
      owner_id: ctx.sesion.userId,
      kindred_id: cuerpo.data.kindredId,
      note: null,
    })

    if (error) throw codigoDesdeErrorDeRefugio(error)
    return sobreOk({ ok: true }, 201)
  })
}
