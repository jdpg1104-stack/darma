// ============================================================================
// requireSesion() — el helper más consumido del repositorio
//
// Todos los bloques de la ola 2 y de la ola 3 empiezan sus rutas con una
// llamada a este archivo. Por eso las firmas se cierran aquí (CONTRATOS §6) y
// no se tocan después: cambiar una obliga a tocar veinte bloques a la vez.
//
// ── LAS DOS REGLAS DE ESTE ARCHIVO ─────────────────────────────────────────
//
// 1. `getUser()`, NUNCA `getSession()`. `getSession()` devuelve lo que diga la
//    cookie sin verificarla contra el servidor de auth, y la cookie la controla
//    el cliente: cualquiera que fabrique una es cualquiera. La diferencia entre
//    los dos métodos es, literalmente, la diferencia entre autenticar y
//    creerse lo que te cuentan. Ni siquiera "para el caso rápido".
//
// 2. UNA consulta. Todas las pantallas de la app llaman aquí; si esto hiciera
//    dos consultas, el presupuesto de rendimiento de CONTRATOS §11 se rompería
//    en todas a la vez. Es un index scan por clave primaria y nada más.
//
// ── POR QUÉ UNA RPC Y NO UN `select` SOBRE `profiles` ──────────────────────
// La ficha B01 pedía
//   `select id, alias, level, shadow_banned, banned_until, entry_level ...`
// pero `0001_core.sql` REVOCA el select sobre `profiles` y lo vuelve a conceder
// solo sobre las columnas públicas: `shadow_banned` y `banned_until` no están
// entre ellas (y `shadow_banned` está fuera a propósito — si el troll puede
// consultarlo, sabe que está silenciado y se crea otra cuenta). Ese select
// devolvería `permission denied for column`, no un 500 misterioso pero
// tampoco una sesión.
//
// La salida es `mi_sesion()`, en `0101_b01_auth.sql`: `security definer`,
// filtrada por `auth.uid()`, que devuelve exactamente esas columnas y ninguna
// más. Mismo patrón que `mi_perfil_privado()` de 0001. Sigue siendo UNA
// consulta y un index scan por PK.
// ============================================================================

import { cache } from 'react'
import type { KarmaLevel } from '../karma.ts'
import { ErrorApi } from './errores.ts'

/** Lo que sabe la app de quien está usándola ahora mismo. CONTRATOS §6. */
export interface Sesion {
  /** uuid de auth.users == profiles.id */
  userId: string
  /** true si entró por signInAnonymously */
  esAnonimo: boolean
  /** null mientras no haya terminado el onboarding */
  alias: string | null
  nivel: KarmaLevel
  shadowBanned: boolean
  /** ISO-8601 */
  bannedUntil: string | null
  /** existe fila en profiles */
  perfilCompleto: boolean
}

/**
 * Fila que devuelve `mi_sesion()`.
 *
 * Se declara a mano y no se deriva de `Database` (CONTRATOS §3) porque
 * `lib/supabase/database.types.ts` todavía no existe: lo genera B15 en CI. En
 * cuanto exista, este tipo se sustituye por
 * `Database['public']['Functions']['mi_sesion']['Returns'][number]`.
 * Anotado en HANDOFF/PEDIDOS.md.
 */
export interface FilaSesion {
  id: string
  alias: string
  avatar_seed: string
  bio: string | null
  level: KarmaLevel
  entry_level: NivelEntrada
  availability: Disponibilidad
  karma_reputation: number
  shadow_banned: boolean
  banned_until: string | null
}

export type NivelEntrada = 'animo' | 'escucha' | 'apoyo'
export type Disponibilidad = 'disponible' | 'necesito_hablar' | 'ausente'

/** Sesión + la fila cruda, para que `/api/me` no tenga que volver a leerla. */
export interface ContextoSesion {
  sesion: Sesion
  /** `null` cuando la persona está autenticada pero aún no ha hecho onboarding. */
  fila: FilaSesion | null
}

function sesionDesde(
  usuario: { id: string; es_anonimo: boolean },
  fila: FilaSesion | null,
): Sesion {
  return {
    userId: usuario.id,
    esAnonimo: usuario.es_anonimo,
    alias: fila?.alias ?? null,
    // Sin perfil todavía no hay karma, así que el nivel de partida es 'semilla'.
    // No es una suposición: `profiles.level` es una columna generada a partir de
    // karma_reputation, que nace a 0.
    nivel: fila?.level ?? 'semilla',
    shadowBanned: fila?.shadow_banned ?? false,
    bannedUntil: fila?.banned_until ?? null,
    perfilCompleto: fila !== null,
  }
}

/**
 * Lee la sesión de verdad. Sin memoizar.
 *
 * El `try/catch` cubre SOLO la obtención del usuario, y devuelve `null` (= no
 * hay sesión) en vez de propagar. Es deliberado: fuera del runtime de Next
 * —tests, scripts— `cookies()` no existe, y "no hay contexto de petición" es,
 * a todos los efectos, "no hay sesión". El error de la consulta de perfil SÍ se
 * propaga: ahí ya sabemos quién es la persona, y tragarse un fallo de base de
 * datos convirtiéndolo en un 401 le diría "no estás autenticado" a alguien que
 * sí lo está.
 */
async function leerContexto(): Promise<ContextoSesion | null> {
  let supabase
  let usuario

  try {
    // Importación diferida: `lib/supabase/server.ts` importa `next/headers`, que
    // no se puede cargar fuera del runtime de Next. Con el import arriba, este
    // módulo sería imposible de probar con `node --test`.
    const { createClient } = await import('../supabase/server.ts')
    supabase = await createClient()

    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    usuario = data.user
  } catch {
    return null
  }

  const { data, error } = await supabase.rpc('mi_sesion')
  if (error) {
    throw new ErrorApi('error_interno', { causa: error })
  }

  // `returns table(...)` llega como array; cero filas = autenticado sin perfil.
  const filas = (Array.isArray(data) ? data : data ? [data] : []) as FilaSesion[]
  const fila = filas[0] ?? null

  return {
    sesion: sesionDesde(
      { id: usuario.id, es_anonimo: usuario.is_anonymous === true },
      fila,
    ),
    fila,
  }
}

/**
 * Versión memoizada por petición.
 *
 * `cache()` de React deduplica dentro de un mismo render de Server Components:
 * un layout, una página y tres componentes que llamen a `getSesion()` hacen UNA
 * consulta, no cinco. Fuera de un render (Route Handlers, tests) `cache()`
 * degrada a llamada directa, así que es seguro usarlo en los dos caminos y no
 * hace falta que quien llama sepa en cuál está.
 */
const leerContextoMemo = cache(leerContexto)

/** Contexto completo. Uso interno de B01 (`/api/me`); los demás bloques usan
 *  `getSesion()` / `requireSesion()`. */
export async function getContextoSesion(): Promise<ContextoSesion | null> {
  return leerContextoMemo()
}

/** Sesión o `null`. Para páginas semi-públicas. */
export async function getSesion(): Promise<Sesion | null> {
  const contexto = await leerContextoMemo()
  return contexto?.sesion ?? null
}

/** Lanza `ErrorApi('no_autenticado')` si no hay sesión válida. */
export async function requireSesion(): Promise<Sesion> {
  const sesion = await getSesion()
  if (!sesion) throw new ErrorApi('no_autenticado')
  return sesion
}

/**
 * Comprobación pura de "esta sesión ya pasó el onboarding".
 *
 * Está separada de `requirePerfil()` para poder probar el camino de fallo sin
 * una base de datos, que es justo el camino que importa: devolver una sesión
 * con `alias: null` disfrazada de perfil completo arrastraría un alias vacío a
 * todas las pantallas de la app.
 */
export function exigirPerfil(sesion: Sesion): Sesion & { alias: string } {
  if (!sesion.perfilCompleto || !sesion.alias) {
    throw new ErrorApi('sin_permiso', {
      mensaje: 'Antes de esto, elige tu alias. Solo lleva un minuto.',
    })
  }
  return { ...sesion, alias: sesion.alias }
}

/** `requireSesion` + exige perfil creado. Lanza `sin_permiso` si falta onboarding. */
export async function requirePerfil(): Promise<Sesion & { alias: string }> {
  return exigirPerfil(await requireSesion())
}
