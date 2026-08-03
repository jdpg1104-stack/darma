// ============================================================================
// POST /api/push/subscribe — registrar un dispositivo
//
// ── EL `userId` SALE DE LA SESIÓN, NUNCA DEL CUERPO ────────────────────────
// Es la regla más importante de esta ruta y la razón de que el esquema sea
// `.strict()`. Si se aceptara un `userId` del cliente, cualquiera podría
// suscribir su propio dispositivo a los avisos de otra persona — y en Darma eso
// es enterarse de cuándo alguien marca «necesito hablar». No es una fuga de
// datos: es una vía de vigilancia.
//
// ── POR QUÉ EL UPSERT VA CON EL CLIENTE ADMIN ─────────────────────────────
// `push_subscriptions` no tiene política de INSERT ni privilegio de INSERT para
// `authenticated` (migración 0131), a propósito: el único sitio donde se puede
// comprobar que el endpoint pertenece a un servicio de push conocido es el
// servidor. Si el cliente pudiera insertar directamente vía PostgREST, esa
// comprobación sería decorativa y la tabla se convertiría en una lista de URLs
// arbitrarias a las que nuestro servidor hace POST (SSRF).
//
// ── POR QUÉ EL CONFLICTO SE RESUELVE POR `endpoint` Y REASIGNA EL DUEÑO ───
// El endpoint es único globalmente. Si ya existe con otro `user_id`, es que ese
// navegador cambió de cuenta (dos personas en el mismo dispositivo, cosa
// habitual en una app de apoyo emocional). Reasignarlo es lo correcto: dejar la
// fila vieja haría que la persona anterior siguiera recibiendo los avisos de
// quien usa ahora el móvil.
// ============================================================================

import { createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { ErrorApi } from '@/lib/auth/errores'
import { requireSesion } from '@/lib/auth/session'
import { pushConfigurado } from '@/lib/push/vapid'

import { limitarPush } from '../limites.ts'
import { esquemaSuscribir, leerJson, validar } from '../validacion.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Hash con sal del user-agent. NUNCA el user-agent en claro: CONTRATOS §2 lo
 * declara inexistente en toda la app, y con razón — la cadena completa de un
 * navegador es casi un identificador único de dispositivo.
 *
 * Sin `PUSH_UA_SALT` en el entorno se devuelve `null` en lugar de hashear con
 * una sal vacía: un hash sin sal de un conjunto pequeño de user-agents es
 * reversible con un diccionario en minutos, así que «sin sal» tiene que
 * significar «sin dato», no «dato débil». La columna es nullable justamente
 * para esto. Variable anotada en HANDOFF/PEDIDOS.md.
 */
function huellaDispositivo(peticion: Request): string | null {
  const sal = process.env.PUSH_UA_SALT?.trim()
  const ua = peticion.headers.get('user-agent')
  if (!sal || !ua) return null
  return createHmac('sha256', sal).update(ua).digest('hex').slice(0, 32)
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    const sesion = await requireSesion()

    const admin = createAdminClient()
    await limitarPush('suscribir', sesion.userId, admin)

    const entrada = validar(esquemaSuscribir, await leerJson(request))

    // Sin llaves VAPID la suscripción del navegador no se puede haber creado
    // contra nuestra clave, así que guardarla no sirve de nada y solo dejaría
    // filas que fallarían con 403 en cada envío. Se responde `entrada_invalida`
    // y no un 500: la feature está apagada, no rota.
    if (!pushConfigurado()) {
      throw new ErrorApi('entrada_invalida', {
        mensaje: 'Los avisos no están disponibles ahora mismo.',
      })
    }

    const { error } = await admin.from('push_subscriptions').upsert(
      {
        // De la SESIÓN. El cuerpo ni siquiera admite esta clave (esquema
        // `.strict()`): una petición con `userId` dentro se rechaza entera.
        user_id: sesion.userId,
        endpoint: entrada.endpoint,
        p256dh: entrada.keys.p256dh,
        auth: entrada.keys.auth,
        user_agent_hash: huellaDispositivo(request),
        last_ok_at: null,
      },
      { onConflict: 'endpoint' },
    )

    // El código de Postgres no sale al cliente: incluiría el nombre de la
    // restricción y, con él, el de la tabla.
    if (error) throw new ErrorApi('error_interno', { causa: error })

    return sobreOk<{ suscrito: true }>({ suscrito: true }, 201)
  })
}
