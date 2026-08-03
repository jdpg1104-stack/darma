// ============================================================================
// POST /api/privacy/exportar  → crea la solicitud y prepara la descarga
// GET  /api/privacy/exportar  → estado de la última solicitud
//
// ── LA DECISIÓN QUE DEFINE ESTA RUTA: EL ARCHIVO NO SE GUARDA ──────────────
// Lo natural sería generar el JSON aquí y dejarlo en almacenamiento hasta que
// se descargue. Se descarta: eso deja el volcado completo de la vida emocional
// de una persona en reposo, en un bucket, durante 24 horas, esperando a que
// alguien se equivoque con los permisos. En su lugar, el POST solo crea la
// solicitud y el archivo se GENERA en el momento de la descarga
// (`[id]/route.ts`), que además es cuando se consume el uso único. Entre una
// petición y otra no existe ningún archivo que filtrar.
//
// El coste es generar la exportación una vez de más si alguien no llega a
// descargarla. Es el lado correcto del intercambio.
// ============================================================================

import { ErrorApi } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requirePerfil } from '@/lib/auth/session'
import { HORAS_CONFIRMACION } from '@/lib/privacy/borrado'
import { createAdminClient } from '@/lib/supabase/admin'

import { limitarPrivacidad, registrarMovimiento } from '../_dominio/comun'

// La respuesta depende de la sesión: cachearla sería servirle a alguien el
// estado de otro.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Horas que vive el enlace de descarga. */
const HORAS_DESCARGA = HORAS_CONFIRMACION

/** Lo que ve el cliente sobre su última solicitud de exportación. */
interface EstadoSolicitud {
  id: string
  estado: string
  solicitadaEn: string
  completadaEn: string | null
  caducaEn: string
  descargable: boolean
}

export async function POST() {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()

    // ADMIN y no el cliente RLS, con motivo: `check_rate_limit()`,
    // `crear_solicitud_privacidad()` y la propia exportación están concedidas
    // solo a `service_role`, y `authenticated` ni siquiera puede leer sus
    // propias columnas privadas de `profiles` (0001). Es una de las tres
    // excepciones que documenta lib/supabase/admin.ts.
    const admin = createAdminClient()

    await limitarPrivacidad('exportar', sesion.userId, admin)

    // El enlace ya nace confirmado: para una exportación no hay nada
    // irreversible que confirmar, y el segundo paso solo añadiría fricción a
    // un derecho que debe ser fácil de ejercer. Lo que sí lleva es caducidad,
    // uso único y comprobación de dueño.
    const { data, error } = await admin.rpc('crear_solicitud_privacidad', {
      p_user: sesion.userId,
      p_kind: 'export',
      // La huella de un token que no se usa en este flujo: la columna es `not
      // null` porque para el borrado sí es obligatoria. Se guarda una huella
      // aleatoria en vez de un valor fijo para que dos solicitudes no compartan
      // nunca el mismo valor en la tabla.
      p_token_sha256: (await import('node:crypto')).randomBytes(32).toString('hex'),
      p_ttl_segundos: HORAS_DESCARGA * 3600,
      p_confirmada: true,
    })
    if (error) throw new ErrorApi('error_interno', { causa: error })

    const solicitudId = String(data)
    registrarMovimiento('exportacion_solicitada', sesion.userId, { solicitud: solicitudId })

    return sobreOk({
      solicitudId,
      urlDescarga: `/api/privacy/exportar/${solicitudId}`,
      expiraEnHoras: HORAS_DESCARGA,
      usoUnico: true,
    })
  })
}

export async function GET() {
  return manejarRuta(async () => {
    const sesion = await requirePerfil()
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('privacy_requests')
      .select('id, state, requested_at, completed_at, expires_at')
      .eq('user_id', sesion.userId)
      .eq('kind', 'export')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new ErrorApi('error_interno', { causa: error })

    const fila = data as {
      id: string
      state: string
      requested_at: string
      completed_at: string | null
      expires_at: string
    } | null

    // `token_sha256` y `error` no salen de aquí ni aunque estén en la fila: el
    // primero es un secreto y el segundo es detalle interno (CONTRATOS §4).
    const solicitud: EstadoSolicitud | null = fila
      ? {
          id: fila.id,
          estado: fila.state,
          solicitadaEn: fila.requested_at,
          completadaEn: fila.completed_at,
          caducaEn: fila.expires_at,
          descargable: fila.state === 'confirmed' && new Date(fila.expires_at) > new Date(),
        }
      : null

    return sobreOk({ solicitud })
  })
}
