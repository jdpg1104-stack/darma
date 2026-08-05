// ============================================================================
// Piezas de servidor compartidas por las rutas de /api/posts
//
// Todo lo que toca red o secretos vive aquí; lo puro vive en `publicar.ts`. La
// frontera existe para que `publicar.test.ts` se pueda ejecutar con
// `node --test` sin arrastrar `lib/supabase/admin.ts`.
// ============================================================================

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { ErrorApi } from '@/lib/auth/errores'
import { rateLimit } from '@/lib/rateLimit'
import { logger } from '@/lib/logger'
import { claveDeIp } from './publicar.ts'
import { origenDePeticion } from '@/lib/auth/peticion'

/**
 * Límites de B03. Los números salen de la ficha del bloque, no de
 * `RATE_LIMITS` de `lib/rateLimit.ts` (dueño F3), que fija `createPost` en 10/h.
 *
 * La divergencia es consciente y está anotada en HANDOFF/PEDIDOS.md: la ficha
 * B03 exige 5/h y su prueba nº 7 comprueba que la sexta publicación de la hora
 * se rechaza. Se respeta la ficha porque es la especificación de este bloque, y
 * porque 5 es el número que acompaña al gate 3:1 — publicar 5 veces en una hora
 * exige haber acompañado a 12 personas, que ya es mucho más de lo que un humano
 * hace en una hora. El gate sigue siendo el límite real; esto es la red.
 */
export const LIMITES_B03 = {
  /** Publicar, por persona. */
  publicar: { limite: 5, ventanaSegundos: 3600 },
  /** Publicar, por IP. Frena el patrón «registro masivo + publicación», que el
   *  límite por usuario no ve porque cada cuenta estrena su contador. */
  publicarPorIp: { limite: 20, ventanaSegundos: 3600 },
  /** Editar. Más alto que publicar: corregir una falta no es abusar. */
  editar: { limite: 30, ventanaSegundos: 3600 },
  /** Votar: 60/min. Barato, pero es la vía más obvia de manipular el feed. */
  votar: { limite: 60, ventanaSegundos: 60 },
} as const

export type AccionB03 = keyof typeof LIMITES_B03

/**
 * Aplica un límite y LANZA si se ha superado.
 *
 * Lanza en vez de devolver un booleano por el mismo motivo que `requireSesion`:
 * un `if` olvidado en una de las cinco rutas de este bloque es un límite que no
 * existe, y no se notaría hasta que alguien lo explotara.
 *
 * El cliente que se le pasa DEBE ser el admin: `check_rate_limit()` está
 * concedida solo a `service_role` (final de 0002_comunidad.sql). Con el cliente
 * RLS la RPC falla, la capa 2 hace fail-open y el límite real desaparece sin que
 * nada se queje.
 */
export async function limitarB03(
  accion: AccionB03,
  sujeto: string,
  admin: SupabaseClient,
): Promise<void> {
  const preset = LIMITES_B03[accion]

  const resultado = await rateLimit({
    key: `${accion}:${sujeto}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: admin,
    // fail-open a propósito (ver cabecera de lib/rateLimit.ts): si Postgres se
    // cae, el daño de dejar pasar es spam; el de cerrar es una puerta cerrada a
    // alguien que quería contar que está mal. Aquí no hay dinero de por medio.
    failClosed: false,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}

/** Límite por IP, con la IP siempre hasheada antes de tocar la base. */
export async function limitarPorIp(
  accion: AccionB03,
  request: Request,
  admin: SupabaseClient,
): Promise<void> {
  // Una sola fuente para toda la app: `origenDePeticion()` elige la cabecera
  // que sella el borde, descarta la cadena que dicta el cliente y agrega IPv6
  // a /64. Antes esto tenía su propia lectura de cabeceras y su propio criterio.
  const ip = origenDePeticion(request).ip
  // Sin IP (llamada interna, entorno local) no hay nada que limitar por IP; el
  // límite por usuario sigue puesto. Fallar aquí bloquearía el desarrollo local
  // sin proteger nada.
  if (!ip) return

  const pimienta = process.env.IDENTITY_PEPPER
  if (!pimienta) {
    // Aviso y no excepción: sin pimienta el hash sigue siendo irreversible, pero
    // es enumerable (2^32 IPv4 se recorren en minutos). Es un problema de
    // configuración que hay que ver en los logs, no una razón para no publicar.
    logger.warn('b03_sin_identity_pepper', { accion })
  }

  const clave = claveDeIp(ip, pimienta, (v) => createHash('sha256').update(v).digest('hex'))
  await limitarB03(accion, `ip_${clave}`, admin)
}

/**
 * País de la persona, SOLO para elegir la línea de ayuda correcta.
 *
 * Vive en `identity_vault.country_code`, la tabla sin ninguna política RLS, así
 * que hace falta el cliente admin. Se lee ÚNICAMENTE cuando el riesgo ya exige
 * intervención: en el camino normal esta consulta no se hace, y así el dato más
 * sensible que guarda la app no se toca en cada publicación.
 *
 * No sale nunca en la respuesta (CONTRATOS §2 lo prohíbe explícitamente). Su
 * único destino son las líneas de la tarjeta y `crisis_events.country_code`, que
 * existe para poder demostrar que se mostró la línea correcta.
 */
export async function paisParaRecursos(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('identity_vault')
    .select('country_code')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    // Un fallo aquí NO puede impedir mostrar recursos: `helpResourcesFor(null)`
    // devuelve el directorio internacional, que es peor que la línea nacional
    // pero infinitamente mejor que una pantalla de crisis vacía.
    logger.warn('b03_pais_no_disponible', { user_id: userId })
    return null
  }

  return (data?.country_code as string | null) ?? null
}

/** Cliente admin con un mensaje útil si falta la clave. */
export function adminOFallar(): SupabaseClient {
  try {
    return createAdminClient()
  } catch (causa) {
    // El detalle (qué variable falta) se queda en el log; al cliente le llega el
    // 500 genérico de `error_interno`.
    throw new ErrorApi('error_interno', { causa })
  }
}
