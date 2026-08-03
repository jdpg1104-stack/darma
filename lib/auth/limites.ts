// ============================================================================
// Rate limiting de las rutas de B01
//
// Se apoya en `lib/rateLimit.ts` (dueño F3), que ya implementa las dos capas:
// memoria por instancia (barata) y `check_rate_limit()` en Postgres (la real,
// compartida entre instancias serverless). Aquí solo se hacen dos cosas que
// aquel módulo no puede hacer:
//
//   1. CONVERTIR EL «NO» EN UN ErrorApi. Devolver un booleano deja la puerta
//      abierta a un `if` olvidado; lanzar no.
//   2. FIJAR LAS CLAVES Y LOS NÚMEROS de este bloque en un solo sitio, para que
//      se puedan leer juntos: un límite solo se entiende comparado con los otros.
//
// ⚠️ `check_rate_limit()` está concedida SOLO a `service_role` (ver el final de
// 0002_comunidad.sql). Por eso `limitar()` recibe un cliente y quien llama debe
// pasarle el ADMIN, no el de RLS: con el de RLS la RPC falla, la capa 2 hace
// fail-open y el límite real desaparece sin que nada se queje.
//
// El cliente entra por parámetro y no se importa aquí a propósito: así este
// módulo no arrastra `lib/supabase/admin.ts` y se puede probar con `node --test`
// usando solo la capa de memoria.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '../rateLimit.ts'
import { ErrorApi } from './errores.ts'

/**
 * Límites de B01. Calibrados sobre el uso humano, no sobre lo que aguanta el
 * servidor.
 */
export const LIMITES_AUTH = {
  /** Alta anónima por IP. La otra barrera anti-multicuenta es el contact_hash
   *  de identity_vault; esta es la del lado de la app. */
  altaAnonima: { limite: 5, ventanaSegundos: 3600 },
  /** Magic link por contacto. Tres al día es de sobra para alguien que se
   *  equivoca; más es alguien usando Darma para bombardear un buzón ajeno. */
  magicLinkContacto: { limite: 3, ventanaSegundos: 3600 },
  /** Magic link por IP: cubre el caso de muchas direcciones distintas desde el
   *  mismo origen, que el límite por contacto no ve. */
  magicLinkIp: { limite: 10, ventanaSegundos: 3600 },
  /** Comprobar si un alias está libre. AGRESIVO a propósito: sin este límite la
   *  ruta es un enumerador del padrón completo de alias de la red, y un alias
   *  enumerado es un perfil que alguien puede vigilar. */
  aliasLibre: { limite: 20, ventanaSegundos: 60 },
  /** Crear el perfil. Solo se hace una vez; el resto son reintentos por
   *  colisión de alias. */
  crearPerfil: { limite: 10, ventanaSegundos: 3600 },
  /** Editar preferencias en /api/me. */
  actualizarPerfil: { limite: 30, ventanaSegundos: 3600 },
  /** Alta y confirmación del segundo factor. */
  segundoFactor: { limite: 10, ventanaSegundos: 3600 },
  /** Verificación de un código TOTP. Bajo: es un espacio de un millón y sin
   *  límite se recorre entero en minutos. */
  verificarSegundoFactor: { limite: 6, ventanaSegundos: 300 },
} as const

export type AccionLimitada = keyof typeof LIMITES_AUTH

export interface OpcionesLimite {
  /** Cliente ADMIN. Sin él solo actúa la capa de memoria (por instancia). */
  supabase?: SupabaseClient
  /** Denegar si Postgres falla. `true` en lo que protege una cuenta. */
  failClosed?: boolean
}

/**
 * Aplica un límite y lanza `demasiadas_peticiones` si se ha superado.
 *
 * @param accion  preset de LIMITES_AUTH.
 * @param sujeto  a quién se le cuenta: userId, hash de IP o hash de contacto.
 *                NUNCA una IP ni un email en claro: la clave se persiste en la
 *                tabla `rate_limits` y ahí no puede haber datos personales.
 */
export async function limitar(
  accion: AccionLimitada,
  sujeto: string,
  opciones: OpcionesLimite = {},
): Promise<void> {
  const preset = LIMITES_AUTH[accion]

  const resultado = await rateLimit({
    key: `${accion}:${sujeto}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: opciones.supabase,
    failClosed: opciones.failClosed,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      // `retryAfter` va en segundos, tanto en el cuerpo (CONTRATOS §4) como en
      // la cabecera Retry-After que pone `manejarRuta`.
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
