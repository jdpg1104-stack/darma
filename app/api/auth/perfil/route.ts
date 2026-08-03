// ============================================================================
// POST /api/auth/perfil — el paso 3 del onboarding: crear la fila de profiles
//
// ── POR QUÉ UNA RPC Y NO UN INSERT ─────────────────────────────────────────
// `profiles` NO tiene política de INSERT en 0001_core.sql. Con el cliente RLS,
// un insert devuelve "new row violates row-level security policy" — y la
// tentación es añadir la política a 0001. No: esa migración ya está aplicada.
// La salida correcta es `crear_perfil()`, security definer, en la migración
// propia de este bloque (0101_b01_auth.sql).
//
// El `userId` sale de `auth.uid()` DENTRO de la función, no del cuerpo de la
// petición. Aceptar un id de usuario del cliente es la vulnerabilidad más común
// de este tipo de app; aquí ni siquiera existe el parámetro.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi, codigoDesdePostgres } from '@/lib/auth/errores'
import { limitar } from '@/lib/auth/limites'
import { requireSesion, type FilaSesion } from '@/lib/auth/session'
import { perfilPublicoDesde, type PerfilPublico } from '@/lib/auth/perfil'
import { leerJson, validarAlias, validarNivelEntrada, validarSemillaAvatar } from '@/lib/auth/validacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    if (sesion.perfilCompleto) {
      // No es un error técnico: es alguien que volvió atrás en el navegador.
      throw new ErrorApi('sin_permiso', { mensaje: 'Ya tienes tu identidad creada.' })
    }

    const admin = createAdminClient()
    await limitar('crearPerfil', sesion.userId, { supabase: admin })

    const cuerpo = (await leerJson(request)) as Record<string, unknown> | null
    const alias = validarAlias(cuerpo?.alias)
    const avatarSeed = validarSemillaAvatar(cuerpo?.avatarSeed)
    const entryLevel = validarNivelEntrada(cuerpo?.entryLevel)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('crear_perfil', {
      p_alias: alias,
      p_avatar_seed: avatarSeed,
      p_entry_level: entryLevel,
    })

    if (error) {
      const codigo = codigoDesdePostgres(error)
      throw new ErrorApi(codigo, {
        // El mensaje es NUESTRO. El de Postgres llevaría dentro el nombre del
        // índice único, que le cuenta el esquema a quien pruebe el formulario.
        mensaje:
          codigo === 'entrada_invalida'
            ? 'Ese alias ya está en uso. Prueba con otro: el botón «otro» te propone uno libre.'
            : undefined,
        causa: error,
      })
    }

    // `crear_perfil` devuelve la fila entera de `profiles` (incluidos campos
    // privados como karma_spendable). Aquí solo se proyecta la cara pública:
    // que la función devuelva más no autoriza a que la API lo enseñe.
    const fila = (Array.isArray(data) ? data[0] : data) as FilaSesion | null
    if (!fila) throw new ErrorApi('error_interno')

    return sobreOk<{ perfil: PerfilPublico }>({ perfil: perfilPublicoDesde(fila) }, 201)
  })
}
