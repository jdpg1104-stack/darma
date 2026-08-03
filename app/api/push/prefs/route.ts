// ============================================================================
// GET / PATCH /api/push/prefs — preferencias de aviso
//
// ── SE SANEA AL LEER, NO SOLO AL ESCRIBIR ─────────────────────────────────
// `notification_prefs.prefs` tiene `grant update (prefs)` para `authenticated`
// (migración 0131): el cliente lo escribe DIRECTAMENTE vía PostgREST sin pasar
// por esta ruta. Por tanto, validar solo en el PATCH no protege nada. Lo que
// protege es que TODA lectura pase por `sanitizarPrefs()`, aquí y en el
// despacho. Si algún día se quitara el grant, este saneo seguiría siendo
// correcto; al revés no.
//
// ── ESTAS DOS RUTAS USAN EL CLIENTE RLS, NO EL ADMIN ──────────────────────
// Y es lo correcto: la fila es de la persona, la política ya la acota a
// `auth.uid()` y los privilegios de columna ya impiden tocar `updated_at`. Que
// la base haga el trabajo (CONTRATOS §6). El admin aparece solo para el
// contador de rate limit, que está concedido únicamente a `service_role`.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requireSesion } from '@/lib/auth/session'
import {
  sanitizarPrefs,
  TIPOS_NOTIFICACION,
  type Preferencias,
} from '@/lib/push/preferencias'
import {
  SILENCIO_DESDE_POR_DEFECTO,
  SILENCIO_HASTA_POR_DEFECTO,
} from '@/lib/push/horario'

import { limitarPush } from '../limites.ts'
import { esquemaPrefs, leerJson, validar } from '../validacion.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface RespuestaPrefs {
  prefs: Preferencias
  quietFrom: number
  quietTo: number
  tzOffset: number
}

/** Fila de `notification_prefs`. Declarada a mano porque
 *  `lib/supabase/database.types.ts` (dueño B15) todavía no contiene la tabla:
 *  hay que regenerarlo tras aplicar `0131_b13_push.sql`. Anotado en PEDIDOS. */
interface FilaPrefs {
  prefs: unknown
  quiet_from: number | null
  quiet_to: number | null
  tz_offset: number | null
}

function aRespuesta(fila: FilaPrefs | null): RespuestaPrefs {
  return {
    // Sin fila, defaults. Que alguien no haya tocado nunca sus ajustes no puede
    // ser un 404: significa exactamente «los de fábrica».
    prefs: sanitizarPrefs(fila?.prefs ?? {}),
    quietFrom: fila?.quiet_from ?? SILENCIO_DESDE_POR_DEFECTO,
    quietTo: fila?.quiet_to ?? SILENCIO_HASTA_POR_DEFECTO,
    tzOffset: fila?.tz_offset ?? 0,
  }
}

export async function GET() {
  return manejarRuta(async () => {
    const sesion = await requireSesion()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('notification_prefs')
      .select('prefs, quiet_from, quiet_to, tz_offset')
      .eq('user_id', sesion.userId)
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk<RespuestaPrefs>(aRespuesta(data as FilaPrefs | null))
  })
}

export async function PATCH(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    await limitarPush('prefs', sesion.userId, createAdminClient())

    const entrada = validar(esquemaPrefs, await leerJson(request))
    const supabase = await createClient()

    const { data: actual, error: errorLectura } = await supabase
      .from('notification_prefs')
      .select('prefs, quiet_from, quiet_to, tz_offset')
      .eq('user_id', sesion.userId)
      .maybeSingle()

    if (errorLectura) throw new ErrorApi('error_interno', { causa: errorLectura })

    // Fusión sobre lo YA SANEADO: si en la base había basura escrita por
    // PostgREST, el PATCH la limpia de paso en vez de conservarla.
    const fusionadas: Preferencias = sanitizarPrefs((actual as FilaPrefs | null)?.prefs ?? {})
    // `esquemaPrefs` construye las claves de tipo con `Object.fromEntries`, así
    // que `z.infer` no las conserva nominalmente. La vista de abajo recupera el
    // acceso indexado sin `any` y sin duplicar la lista de tipos: la única
    // fuente sigue siendo `TIPOS_NOTIFICACION`.
    const porTipo = entrada as Record<string, boolean | undefined>
    for (const tipo of TIPOS_NOTIFICACION) {
      if (porTipo[tipo] !== undefined) fusionadas[tipo] = porTipo[tipo]
    }
    if (entrada.revelar_alias !== undefined) fusionadas.revelar_alias = entrada.revelar_alias

    const previo = aRespuesta(actual as FilaPrefs | null)

    const { data, error } = await supabase
      .from('notification_prefs')
      .upsert(
        {
          // De la sesión. El esquema `.strict()` ni siquiera admite `user_id`
          // en el cuerpo, y la política `prefs_upsert_own` lo ataría igualmente.
          user_id: sesion.userId,
          prefs: fusionadas,
          quiet_from: entrada.quietFrom === undefined ? previo.quietFrom : entrada.quietFrom,
          quiet_to: entrada.quietTo === undefined ? previo.quietTo : entrada.quietTo,
          tz_offset: entrada.tzOffset ?? previo.tzOffset,
        },
        { onConflict: 'user_id' },
      )
      .select('prefs, quiet_from, quiet_to, tz_offset')
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk<RespuestaPrefs>(aRespuesta(data as FilaPrefs | null))
  })
}
