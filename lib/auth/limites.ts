// ============================================================================
// Rate limiting de las rutas de B01
//
// Se apoya en `lib/rateLimit.ts` (dueño F3), que ya implementa las dos capas:
// memoria por instancia (barata) y `check_rate_limit()` en Postgres (la real,
// compartida entre instancias serverless). Aquí solo se hacen tres cosas que
// aquel módulo no puede hacer:
//
//   1. CONVERTIR EL «NO» EN UN ErrorApi. Devolver un booleano deja la puerta
//      abierta a un `if` olvidado; lanzar no.
//   2. FIJAR LAS CLAVES Y LOS NÚMEROS de este bloque en un solo sitio, para que
//      se puedan leer juntos: un límite solo se entiende comparado con los otros.
//   3. FIJAR TAMBIÉN QUÉ HACER CUANDO EL BACKEND DE LÍMITES FALLA, y fijarlo en
//      el PRESET y no en la llamada. Ver abajo.
//
// ⚠️ `check_rate_limit()` está concedida SOLO a `service_role` (ver el final de
// 0002_comunidad.sql). Por eso `limitar()` recibe un cliente y quien llama debe
// pasarle el ADMIN, no el de RLS: con el de RLS la RPC falla, la capa 2 hace
// fail-open y el límite real desaparece sin que nada se queje.
//
// El cliente entra por parámetro y no se importa aquí a propósito: así este
// módulo no arrastra `lib/supabase/admin.ts` y se puede probar con `node --test`
// usando solo la capa de memoria.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL FALLO DEL BACKEND SE DECIDE EN EL PRESET, NO EN LA LLAMADA
//
// `failClosed` era un parámetro opcional de cada llamada. Eso significa que el
// comportamiento ante una caída lo decidía el archivo de ruta, y que OLVIDARLO
// era gratis y silencioso: `app/api/auth/anonimo/route.ts` no lo pasaba, así que
// el límite antimulticuenta de la red era fail-open sin que en ningún sitio
// estuviera escrito que esa fuera la intención.
//
// Ahora cada preset declara `anteFalloDelBackend`. La llamada ya no puede
// relajarlo; `opciones.failClosed` solo se conserva para ENDURECER (las rutas de
// 2FA lo pasan ya, y siguen valiendo). Un límite es una decisión de seguridad y
// tiene que vivir junto al número que lo define, no repartida por las rutas.
//
// ── 🔴 POR QUÉ EL ALTA ANÓNIMA ES `denegar` ────────────────────────────────
// Las dos opciones tienen un coste real y ninguna es gratis:
//
//   A favor de dejar pasar: si el backend de límites cae, NADIE puede crear una
//   cuenta. Darma es una app a la que alguien llega a las tres de la mañana en
//   mitad de una crisis; una puerta cerrada en ese momento es un daño concreto
//   y no hipotético.
//
//   A favor de denegar: sin denegar, tumbar (o simplemente romper) el limitador
//   abre la puerta a mil cuentas, y «una persona, una cuenta» es el cimiento
//   sobre el que se sostiene todo lo demás de esta red.
//
// Se elige DENEGAR, y el argumento que desempata es que el coste de arriba está
// en buena parte sobrevalorado en ESTA ruta concreta:
//
//   1. `check_rate_limit()` vive en el MISMO Postgres que `auth.users`, y el
//      alta consiste precisamente en escribir en `auth.users`
//      (`signInAnonymously()`). Si Postgres está caído, el alta ya falla de
//      todas formas con `error_interno`. En ese escenario —el que asusta—
//      denegar no cierra ninguna puerta que no estuviera cerrada: solo cambia
//      un 500 por un 429.
//   2. Lo que sí cambia denegar es la banda estrecha en la que la RPC falla
//      pero Auth funciona: la migración 0002 sin aplicar, la RPC llamada con el
//      cliente de RLS en vez del admin (el bug que avisa la cabecera de este
//      archivo), la caché de esquema de PostgREST rancia, el pool agotado solo
//      para el cliente admin. En TODOS esos casos el comportamiento anterior
//      era: la barrera antimulticuenta desaparece en absoluto silencio y nada
//      falla de forma visible. Ese es el peor modo de fallo posible para un
//      control de seguridad: el que nadie descubre.
//   3. Denegar convierte esa avería muda en una avería ruidosa. Un 429 masivo
//      en la puerta de entrada se detecta en minutos; un límite que se evaporó
//      no se detecta nunca.
//
// ── QUÉ SE PIERDE (escrito a propósito, no es letra pequeña) ───────────────
//   · Durante esa banda estrecha —RPC rota, Auth sana— NADIE puede crear una
//     cuenta. Alguien que llegue esa noche no podrá registrarse ni escribir.
//     Es un coste real y se paga a sabiendas.
//   · Lo que NO se pierde: `/ayuda` es pública y no exige sesión (ver
//     `proxy.ts`, donde está anotado que lo es «por razones que no son
//     técnicas»). Los teléfonos de crisis siguen a un clic sin cuenta. Lo que
//     se bloquea es registrarse y publicar, no pedir ayuda.
//   · El `retryAfter` que se devuelve es la ventana entera (3600 s). Ante una
//     caída del backend eso es una cifra falsa: le dice a la persona que vuelva
//     en una hora cuando el arreglo puede tardar dos minutos. No se puede
//     afinar desde aquí porque `lib/rateLimit.ts` devuelve exactamente la misma
//     forma para «has superado el límite» y para «el backend no responde»
//     (`{ ok: false, layer: 'postgres', retryAfter: ventana }`), así que esta
//     capa no puede distinguirlas ni para el mensaje ni para alertar. Corregirlo
//     exige tocar `lib/rateLimit.ts`, que es de otro dueño; queda anotado.
//
// ── POR QUÉ EL MAGIC LINK NO SIGUE LA MISMA REGLA ──────────────────────────
// `magicLinkContacto` y `magicLinkIp` se quedan en `dejar-pasar`. No es
// incoherencia: el techo del abuso es distinto. Saltarse el límite de altas
// produce CUENTAS —daño permanente en la estructura de la red—; saltarse el del
// magic link produce correos molestos a un buzón, que caducan solos. Y el magic
// link es además el camino de vuelta de quien YA tiene cuenta: cerrarlo ante
// una incidencia deja fuera a gente que no está creando nada.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '../rateLimit.ts'
import { ErrorApi } from './errores.ts'

/**
 * Qué hacer cuando la capa 2 (Postgres) no responde.
 *
 *  · `denegar`      — fail-closed. Para lo que, si se salta, deja daño que no
 *                     se deshace: cuentas y segundos factores.
 *  · `dejar-pasar`  — fail-open. Para lo que, si se salta, solo genera ruido
 *                     recuperable. Es la política por defecto de
 *                     `lib/rateLimit.ts` y la razón está en su cabecera.
 */
export type AnteFalloDelBackend = 'denegar' | 'dejar-pasar'

interface Preset {
  limite: number
  ventanaSegundos: number
  anteFalloDelBackend: AnteFalloDelBackend
}

/**
 * Límites de B01. Calibrados sobre el uso humano, no sobre lo que aguanta el
 * servidor.
 */
export const LIMITES_AUTH = {
  /** Alta anónima por IP. La otra barrera anti-multicuenta es el contact_hash
   *  de identity_vault; esta es la del lado de la app.
   *
   *  El SUJETO tiene que salir de `origenDePeticion()` (lib/auth/peticion.ts):
   *  con la IP que declara el cliente, este número es decorativo. `denegar`
   *  razonado en la cabecera. */
  altaAnonima: { limite: 5, ventanaSegundos: 3600, anteFalloDelBackend: 'denegar' },
  /** Magic link por contacto. Tres al día es de sobra para alguien que se
   *  equivoca; más es alguien usando Darma para bombardear un buzón ajeno. */
  magicLinkContacto: { limite: 3, ventanaSegundos: 3600, anteFalloDelBackend: 'dejar-pasar' },
  /** Magic link por IP: cubre el caso de muchas direcciones distintas desde el
   *  mismo origen, que el límite por contacto no ve. */
  magicLinkIp: { limite: 10, ventanaSegundos: 3600, anteFalloDelBackend: 'dejar-pasar' },
  /** Comprobar si un alias está libre. AGRESIVO a propósito: sin este límite la
   *  ruta es un enumerador del padrón completo de alias de la red, y un alias
   *  enumerado es un perfil que alguien puede vigilar. */
  aliasLibre: { limite: 20, ventanaSegundos: 60, anteFalloDelBackend: 'dejar-pasar' },
  /** Crear el perfil. Solo se hace una vez; el resto son reintentos por
   *  colisión de alias. */
  crearPerfil: { limite: 10, ventanaSegundos: 3600, anteFalloDelBackend: 'dejar-pasar' },
  /** Editar preferencias en /api/me. */
  actualizarPerfil: { limite: 30, ventanaSegundos: 3600, anteFalloDelBackend: 'dejar-pasar' },
  /** Alta y confirmación del segundo factor. Las rutas ya pasaban
   *  `failClosed: true`; aquí queda escrito para que no dependa de que se
   *  acuerden. */
  segundoFactor: { limite: 10, ventanaSegundos: 3600, anteFalloDelBackend: 'denegar' },
  /** Verificación de un código TOTP. Bajo: es un espacio de un millón y sin
   *  límite se recorre entero en minutos. */
  verificarSegundoFactor: { limite: 6, ventanaSegundos: 300, anteFalloDelBackend: 'denegar' },
} as const satisfies Record<string, Preset>

export type AccionLimitada = keyof typeof LIMITES_AUTH

export interface OpcionesLimite {
  /** Cliente ADMIN. Sin él solo actúa la capa de memoria (por instancia). */
  supabase?: SupabaseClient
  /**
   * Endurecer: denegar si Postgres falla.
   *
   * ⚠️ Solo ENDURECE. Un preset que ya es `denegar` no se puede relajar pasando
   * `false`: la política ante una caída pertenece al límite, no a la ruta.
   */
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
  const preset: Preset = LIMITES_AUTH[accion]

  // El preset manda; la llamada solo puede subir el listón.
  const denegarSiFallaElBackend = preset.anteFalloDelBackend === 'denegar' || opciones.failClosed === true

  const resultado = await rateLimit({
    key: `${accion}:${sujeto}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase: opciones.supabase,
    failClosed: denegarSiFallaElBackend,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      // `retryAfter` va en segundos, tanto en el cuerpo (CONTRATOS §4) como en
      // la cabecera Retry-After que pone `manejarRuta`.
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
