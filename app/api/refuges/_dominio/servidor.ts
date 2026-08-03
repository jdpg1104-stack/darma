// ============================================================================
// B10 · Lo que comparten todas las rutas de /api/refuges/*
//
// ── TRES REGLAS QUE NO SE NEGOCIAN EN ESTE ARCHIVO ─────────────────────────
//
// 1. NUNCA `createAdminClient()`. Ni una sola lectura de refugios, mensajes,
//    `kindred` o perfiles pasa por el cliente que salta RLS. El bloqueo y el
//    silencio ya viven en el USING de las políticas de 0002; rodearlos con el
//    admin sería deshacer la única barrera que un `curl` a PostgREST no puede
//    saltarse. Si algún día `grep -r "createAdminClient" app/api/refuges`
//    devuelve algo, es un bug de diseño, no una optimización.
//
// 2. UN REFUGIO AJENO ES 404, JAMÁS 403. `0002` está construido para que un
//    refugio sea *indistinguible de inexistente* para quien no es miembro:
//    devuelve cero filas, no un error. Un 403 desde esta API deshace ese
//    trabajo y le confirma a un acosador que su víctima sigue en la app y sigue
//    en esa sala. Por eso `exigirRefugio()` solo sabe devolver `no_encontrado`.
//
// 3. EL userId SALE DE LA SESIÓN. Nunca del cuerpo, nunca de la query. El id de
//    la sala va en la RUTA y se valida como uuid.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSesion, type Sesion } from '@/lib/auth/session'
import { ErrorApi } from '@/lib/auth/errores'
import { rateLimitMemory } from '@/lib/rateLimit'

/** Acciones limitadas. Los NÚMEROS viven en `b10_limitar()` (migración 0110_1),
 *  no aquí: si estuvieran en TypeScript, un despliegue con otra constante los
 *  cambiaría sin tocar la base, y la capa que de verdad cuenta es la de
 *  Postgres. Esta lista solo dice qué acciones existen. */
export type AccionLimitada =
  | 'refuge_msg'
  | 'refugio_crear'
  | 'kindred'
  | 'bloquear'
  | 'keys'
  | 'sobre'
  | 'leido'
  | 'refugio_leer'
  | 'crisis_refugio'

/** Espejo aproximado de los límites de `b10_limitar()`, SOLO para la capa de
 *  memoria (que es un amortiguador barato, no la barrera). Si los dos números
 *  divergen, manda Postgres. */
const VENTANA_MEMORIA: Readonly<Record<AccionLimitada, { limite: number; ventanaSegundos: number }>> = {
  refuge_msg: { limite: 30, ventanaSegundos: 60 },
  refugio_crear: { limite: 5, ventanaSegundos: 3600 },
  kindred: { limite: 20, ventanaSegundos: 60 },
  bloquear: { limite: 20, ventanaSegundos: 60 },
  keys: { limite: 3, ventanaSegundos: 86400 },
  sobre: { limite: 60, ventanaSegundos: 3600 },
  leido: { limite: 120, ventanaSegundos: 60 },
  refugio_leer: { limite: 120, ventanaSegundos: 60 },
  crisis_refugio: { limite: 20, ventanaSegundos: 3600 },
}

export interface Contexto {
  sesion: Sesion
  supabase: SupabaseClient
}

/** Sesión + cliente RLS. El punto de entrada de todas las rutas del bloque. */
export async function contexto(): Promise<Contexto> {
  const sesion = await requireSesion()
  const supabase = await createClient()
  return { sesion, supabase }
}

/**
 * Aplica el límite en las dos capas y LANZA si se pasa.
 *
 * `check_rate_limit()` está concedida solo a `service_role`, así que la capa 2
 * entra por `b10_limitar()`, una función `security definer` concedida a
 * `authenticated` que saca el sujeto de `auth.uid()` y tiene los límites
 * dentro. Sin ella, este bloque —que tiene prohibido el cliente admin— se
 * quedaría en la capa de memoria, que con N instancias en Vercel es N veces el
 * límite configurado.
 */
export async function limitar(accion: AccionLimitada, ctx: Contexto): Promise<void> {
  const preset = VENTANA_MEMORIA[accion]
  const memoria = rateLimitMemory(`b10:${accion}:${ctx.sesion.userId}`, preset.limite, preset.ventanaSegundos * 1000)
  if (!memoria.ok) {
    throw new ErrorApi('demasiadas_peticiones', { retryAfter: Math.max(1, memoria.retryAfter) })
  }

  const { data, error } = await ctx.supabase.rpc('b10_limitar', { p_accion: accion })
  if (error) {
    // FAIL-OPEN, como el resto de la app (lib/rateLimit.ts): que una incidencia
    // de base de datos impida escribir a alguien en un refugio es peor que el
    // spam que deja pasar. Las rutas de dinero no existen en este bloque.
    console.error('[darma][b10] rate limit degradado a la capa de memoria', error.message)
    return
  }
  if (data !== true) {
    throw new ErrorApi('demasiadas_peticiones', { retryAfter: preset.ventanaSegundos })
  }
}

/**
 * Comprueba que la sala existe Y que quien pregunta puede verla, con UNA
 * consulta y devolviendo siempre el mismo error en los dos casos.
 *
 * Que un uuid inexistente y un refugio ajeno den exactamente la misma respuesta
 * —mismo código, mismo mensaje, mismo status— es el punto entero de esta
 * función. Un 403 aquí sería una confirmación gratis para quien está buscando a
 * alguien.
 */
export async function exigirRefugio(ctx: Contexto, refugeId: string): Promise<FilaRefugio> {
  const { data, error } = await ctx.supabase
    .from('refuges')
    .select('id, kind, title, topic, member_count, message_count, last_message_at, created_by, archived_at')
    .eq('id', refugeId)
    .maybeSingle()

  if (error) throw new ErrorApi('no_encontrado', { causa: error })
  if (!data) throw new ErrorApi('no_encontrado')
  return data as FilaRefugio
}

/**
 * Fila de `refuges` tal cual la devuelve PostgREST.
 *
 * Se declara a mano porque `lib/supabase/database.types.ts` (dueño B15) todavía
 * no contiene las tablas de 0110_1. Anotado en HANDOFF/PEDIDOS.md; en cuanto se
 * regenere, esto se sustituye por
 * `Database['public']['Tables']['refuges']['Row']`.
 */
export interface FilaRefugio {
  id: string
  kind: 'duo' | 'circulo'
  title: string | null
  topic: string | null
  member_count: number
  message_count: number
  last_message_at: string | null
  created_by: string
  archived_at: string | null
}

export interface FilaMensaje {
  id: number
  refuge_id: string
  sender_id: string
  ciphertext: string
  nonce: string
  enc_version: number
  kind: 'text' | 'audio' | 'system'
  created_at: string
}

export interface FilaClavePublica {
  user_id: string
  public_jwk: { kty: string; crv: string; x: string; y: string }
  fingerprint: string
  key_version: number
}

export interface FilaSobre {
  refuge_id: string
  wrapped_key: string
  wrap_nonce: string
  sender_fingerprint: string
  key_version: number
}

/**
 * Traduce un error de Postgres a un código público.
 *
 * `42501` (violación de RLS o de privilegio) se traduce a **no_encontrado**, no
 * a `sin_permiso`. Es intencionado y es la regla 2 de la cabecera: en este
 * bloque «no puedes» y «no existe» tienen que ser la misma respuesta, también
 * cuando la que habla es la base de datos.
 */
export function codigoDesdeErrorDeRefugio(causa: unknown): ErrorApi {
  const codigo = typeof causa === 'object' && causa !== null && 'code' in causa
    ? String((causa as { code?: unknown }).code ?? '')
    : ''
  const mensaje = causa instanceof Error ? causa.message : String((causa as { message?: unknown })?.message ?? '')

  if (codigo === '42501' || mensaje.includes('violates row-level security') || mensaje.includes('permission denied')) {
    return new ErrorApi('no_encontrado', { causa })
  }
  if (codigo === '23505' || mensaje.includes('duplicate key value')) {
    return new ErrorApi('saldo_insuficiente', {
      mensaje: 'Esto ya estaba hecho.',
      causa,
    })
  }
  if (codigo === '23514' || mensaje.includes('check constraint') || mensaje.includes('refugio')) {
    return new ErrorApi('entrada_invalida', { mensaje: mensajeDeCheck(mensaje), causa })
  }
  return new ErrorApi('error_interno', { causa })
}

/**
 * Convierte los `raise exception` propios en frases para una persona.
 *
 * Solo se reconocen NUESTROS mensajes, escritos en `0110_1`. Cualquier otro cae
 * al genérico: un mensaje de Postgres sin filtrar cuenta el nombre de la tabla,
 * de la restricción y de la columna.
 */
function mensajeDeCheck(mensaje: string): string {
  if (mensaje.includes('un duo son exactamente dos personas')) {
    return 'Un refugio de dos es exactamente para dos personas.'
  }
  if (mensaje.includes('un refugio son entre 2 y 8 personas')) {
    return 'Un refugio es de 2 a 8 personas. A partir de ahí deja de ser un refugio.'
  }
  if (mensaje.includes('el refugio está completo')) {
    return 'Este refugio ya está completo.'
  }
  return 'Hay algo en lo que has enviado que no podemos procesar.'
}
