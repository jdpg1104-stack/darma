// ============================================================================
// GET /api/auth/alias-libre?alias= — ¿está cogido este seudónimo?
//
// ── EL RATE LIMIT NO ES OPCIONAL AQUÍ ──────────────────────────────────────
// Sin límite, esta ruta es un ENUMERADOR del padrón completo de alias de la
// red: un bucle sobre un diccionario devuelve la lista de quién existe. Y en
// Darma un alias no es un nombre de usuario cualquiera — es la única
// identidad de una persona que escribe sobre su salud mental, y una lista de
// alias es una lista de a quién vigilar.
//
// Por eso: 20 por minuto y por usuario, y exige sesión. La comprobación es
// para elegir alias en el onboarding, un puñado de veces; quien haga 21 en un
// minuto no está eligiendo alias.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { requireSesion } from '@/lib/auth/session'
import { validarAlias } from '@/lib/auth/validacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    const admin = createAdminClient()
    await limitar('aliasLibre', sesion.userId, { supabase: admin })

    const alias = validarAlias(new URL(request.url).searchParams.get('alias'))

    const supabase = await createClient()
    // `alias_disponible()` usa idx_profiles_alias_lower: index scan de una fila.
    // El trigram idx_profiles_alias_trgm es para búsqueda difusa (B06) y aquí
    // sería mucho más caro.
    const { data, error } = await supabase.rpc('alias_disponible', { p_alias: alias })

    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk({ libre: data === true })
  })
}
