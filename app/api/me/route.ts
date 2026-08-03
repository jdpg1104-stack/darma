// ============================================================================
// GET / PATCH /api/me — la única superficie donde salen los campos privados
//
// `karmaSpendable`, `crystals`, `listenCredits` y `dailyKarmaEarned` no
// aparecen en ninguna otra respuesta de la app (CONTRATOS §2). Aquí sí, porque
// esta ruta está dirigida a su dueño y a nadie más.
//
// ── PRESUPUESTO: TRES CONSULTAS, NI UNA MÁS ────────────────────────────────
//  1. `mi_sesion()`        → la parte pública + el estado de sesión (PK).
//  2. `mi_perfil_privado()`→ los saldos (PK). Es OBLIGATORIO que sea una RPC:
//     0001 revocó el privilegio de COLUMNA sobre karma_spendable, crystals y
//     listen_credits, así que no hay `select` que los devuelva, ni siquiera
//     sobre la propia fila. Ya está anotado en HANDOFF/PEDIDOS.md.
//  3. `auth_totp`          → si el segundo factor está activo (PK, admin).
//
// Ni un `count(*)` sobre `karma_events` para el saldo: el saldo vive
// desnormalizado en `profiles` y el ledger es la fuente de verdad para
// auditar, no para leer en cada carga de pantalla.
//
// `Cache-Control: private, no-store` lo pone `manejarRuta` en todas las
// respuestas de auth. Sin él, un intermediario puede servirle a una persona la
// respuesta de otra, y aquí eso son los saldos y el estado de alguien.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { exigirPerfil, getContextoSesion, type FilaSesion } from '@/lib/auth/session'
import { perfilPublicoDesde, type PerfilPublico, type Yo } from '@/lib/auth/perfil'
import { tieneSegundoFactor } from '@/lib/auth/almacenTotp'
import { leerJson, validarParcheMe } from '@/lib/auth/validacion'
import { canPublish, reciprocityMessage, creditsNeeded } from '@/lib/reciprocity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FilaPrivada {
  karma_spendable: number
  crystals: number
  listen_credits: number
  listens_given: number
  posts_published: number
  daily_karma_earned: number
  banned_until: string | null
}

/** Contexto ya validado: sesión con perfil creado y su fila. */
async function contextoConPerfil(): Promise<{ userId: string; fila: FilaSesion }> {
  const contexto = await getContextoSesion()
  if (!contexto) throw new ErrorApi('no_autenticado')

  // Lanza 'sin_permiso' si falta el onboarding. Nunca se devuelve un `Yo` con
  // alias vacío: eso arrastraría un perfil fantasma a todas las pantallas.
  exigirPerfil(contexto.sesion)
  if (!contexto.fila) throw new ErrorApi('sin_permiso')

  return { userId: contexto.sesion.userId, fila: contexto.fila }
}

export async function GET() {
  return manejarRuta(async () => {
    const { userId, fila } = await contextoConPerfil()

    const supabase = await createClient()
    const { data: privadas, error } = await supabase.rpc('mi_perfil_privado')
    if (error) throw new ErrorApi('error_interno', { causa: error })

    const privado = ((Array.isArray(privadas) ? privadas[0] : privadas) ?? null) as FilaPrivada | null
    if (!privado) throw new ErrorApi('error_interno')

    // El segundo factor se consulta con el cliente ADMIN porque `auth_totp` no
    // tiene ninguna política RLS (ver lib/auth/almacenTotp.ts). Solo sale el
    // booleano: ni el secreto, ni los hashes de recuperación.
    const dosFactoresActivo = await tieneSegundoFactor(userId)

    // La reciprocidad se DERIVA de lib/reciprocity.ts, no se recalcula aquí:
    // duplicar la regla 3:1 en un tercer sitio es cómo acaban divergiendo la UI
    // y el trigger que decide de verdad.
    const estado = {
      listenCredits: privado.listen_credits,
      postsPublished: privado.posts_published,
      bannedUntil: privado.banned_until,
    }
    const publicar = canPublish(estado)

    return sobreOk<Yo>({
      perfil: perfilPublicoDesde(fila),
      karmaSpendable: privado.karma_spendable,
      crystals: privado.crystals,
      listenCredits: privado.listen_credits,
      dailyKarmaEarned: privado.daily_karma_earned,
      entryLevel: fila.entry_level,
      reciprocidad: {
        puedePublicar: publicar.allowed,
        faltanEscuchas: creditsNeeded(estado),
        esPrimerPost: publicar.isFirstPost,
        mensaje: reciprocityMessage(estado),
      },
      dosFactoresActivo,
    })
  })
}

/**
 * PATCH acepta EXACTAMENTE dos campos: `disponibilidad` y `entryLevel`.
 *
 * Editar alias, bio y avatar es de B05 y no se duplica aquí: dos rutas que
 * escriben el mismo campo divergen en validación en cuanto una de las dos
 * cambia. Cualquier otra clave del cuerpo se ignora en silencio — aceptar
 * `karmaSpendable` sería asignación masiva, y de todas formas el privilegio de
 * columna de 0001 lo impediría en Postgres.
 */
export async function PATCH(request: Request) {
  return manejarRuta(async () => {
    const { userId, fila } = await contextoConPerfil()

    const admin = createAdminClient()
    await limitar('actualizarPerfil', userId, { supabase: admin })

    const parche = validarParcheMe(await leerJson(request))

    const cambios: { availability?: string; entry_level?: string } = {}
    if (parche.disponibilidad) cambios.availability = parche.disponibilidad
    if (parche.entryLevel) cambios.entry_level = parche.entryLevel

    const supabase = await createClient()
    // Cliente RLS a propósito: `profiles_update_own` y el privilegio de columna
    // hacen el trabajo. El `eq('id', userId)` es redundante con la política —
    // y está ahí justamente por eso: si algún día la política cambiara, esto
    // sigue escribiendo solo la fila propia.
    const { error } = await supabase.from('profiles').update(cambios).eq('id', userId)
    if (error) throw new ErrorApi('error_interno', { causa: error })

    // Se devuelve el perfil recomponiéndolo en memoria en vez de releerlo: la
    // fila ya se leyó al principio y una segunda consulta rompería el
    // presupuesto de CONTRATOS §11 por un dato que ya tenemos.
    const actualizada: FilaSesion = {
      ...fila,
      availability: parche.disponibilidad ?? fila.availability,
      entry_level: parche.entryLevel ?? fila.entry_level,
    }

    return sobreOk<{ perfil: PerfilPublico }>({ perfil: perfilPublicoDesde(actualizada) })
  })
}
