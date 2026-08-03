// ============================================================================
// B07 · Las llamadas a Postgres. SOLO SERVIDOR.
//
// ⚠️ Este archivo importa `lib/supabase/admin.ts`. Jamás lo importes desde un
// componente cliente ni desde `lib/video/index.ts` (el barril que consumen B05
// y B13): la service_role key en un bundle de navegador es acceso total a la
// base de datos.
//
// ── POR QUÉ AQUÍ SÍ SE USA EL CLIENTE ADMIN ────────────────────────────────
// CONTRATOS §6 pide el cliente RLS y exige justificar la excepción. Esta es la
// justificación: `abrir_sesion_contenido()`, `latido_contenido()` y
// `completar_contenido()` son `security definer` concedidas ÚNICAMENTE a
// `service_role`. Y lo son porque hacen exactamente lo que el cliente no puede
// hacer por diseño —escribir `content_views.completed`, que es lo que dispara
// el karma—. Si `authenticated` pudiera invocarlas, el bloque entero sería
// decorativo: bastaría llamar a la RPC con un `p_user` cualquiera.
//
// El feed es la excepción a la excepción: `feed_animo()` es `security invoker`
// y se llama con el cliente RLS, para que las políticas de lectura sigan
// haciendo su trabajo.
//
// ── EL userId NUNCA VIENE DEL CUERPO ───────────────────────────────────────
// Todas estas funciones reciben `userId` como primer parámetro y todas las
// rutas se lo pasan desde `requireSesion()`. Aceptar un id del cliente en una
// llamada que salta RLS sería la vulnerabilidad más grave posible de este
// bloque.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { ErrorApi } from '../auth/errores.ts'
import type { EstadoLatido, FilaFeed, MotivoRpc, ResultadoCompletado } from './tipos.ts'
import { CURSOR_INICIAL, type Cursor } from './cursor.ts'

/** `returns table(...)` llega como array; `returns uuid` como escalar. */
function primeraFila<T>(datos: unknown): T | null {
  if (Array.isArray(datos)) return (datos[0] ?? null) as T | null
  return (datos ?? null) as T | null
}

/**
 * Abre (o recupera) la sesión de reproducción.
 *
 * `null` de la RPC significa "ese contenido no existe o no está aprobado". Se
 * traduce a 404 y no a 403: no revela nada que la política de lectura de
 * `content_items` no revele ya.
 */
export async function abrirSesion(
  admin: SupabaseClient,
  userId: string,
  contentId: string,
): Promise<string> {
  const { data, error } = await admin.rpc('abrir_sesion_contenido', {
    p_user: userId,
    p_content: contentId,
  })

  if (error) throw new ErrorApi('error_interno', { causa: error })

  const sesionId = primeraFila<string>(data)
  if (!sesionId) throw new ErrorApi('no_encontrado')

  return sesionId
}

/**
 * Un latido. El servidor acredita `min(now() - last_beat_at, 7 s)` topado por
 * la duración; el cliente no envía ni instantes ni segundos.
 *
 * Una sesión inválida (inexistente, cerrada, o de OTRA persona) NO se
 * distingue de una sesión sin progreso: devuelve `acreditados: 0`. Es
 * deliberado —un 403 aquí le confirmaría al atacante que la sesión existe— y
 * es inocuo, porque sin progreso acumulado el `/completado` no concede nada.
 */
export async function latir(
  admin: SupabaseClient,
  userId: string,
  contentId: string,
  sesionId: string,
): Promise<EstadoLatido> {
  const { data, error } = await admin.rpc('latido_contenido', {
    p_user: userId,
    p_content: contentId,
    p_session: sesionId,
  })

  if (error) throw new ErrorApi('error_interno', { causa: error })

  const fila = primeraFila<{ acreditados: number; faltan: number; listo: boolean }>(data)
  if (!fila) throw new ErrorApi('error_interno')

  return { acreditados: fila.acreditados, faltan: fila.faltan, listo: fila.listo }
}

/**
 * Cierra el vídeo y, si el tiempo acumulado en el SERVIDOR llega al 90 % de la
 * duración, marca `completed` — que es lo que dispara `content_views_sync()` y
 * con él el +1 de `award_karma()`.
 *
 * Traducción de motivos a la respuesta pública:
 *  · `sesion_invalida` → 403 `sin_permiso`. La RPC ya no distingue "no existe"
 *    de "es de otra persona", así que el 403 no filtra nada.
 *  · `no_disponible`   → 404 `no_encontrado`.
 *  · el resto          → 200 con `acreditado: false` y el motivo. Un 4xx aquí
 *    haría que la UI enseñara un error a alguien que simplemente ya había visto
 *    el vídeo o ya había llegado al tope diario.
 */
export async function completar(
  admin: SupabaseClient,
  userId: string,
  contentId: string,
  sesionId: string,
): Promise<ResultadoCompletado> {
  const { data, error } = await admin.rpc('completar_contenido', {
    p_user: userId,
    p_content: contentId,
    p_session: sesionId,
  })

  if (error) throw new ErrorApi('error_interno', { causa: error })

  const fila = primeraFila<{ acreditado: boolean; karma: number; motivo: MotivoRpc | null }>(data)
  if (!fila) throw new ErrorApi('error_interno')

  if (fila.motivo === 'sesion_invalida') throw new ErrorApi('sin_permiso')
  if (fila.motivo === 'no_disponible') throw new ErrorApi('no_encontrado')

  const salida: ResultadoCompletado = {
    acreditado: fila.acreditado,
    karma: fila.karma > 0 ? 1 : 0,
  }
  if (fila.motivo) salida.motivo = fila.motivo

  return salida
}

/**
 * Cierra las sesiones abandonadas (más de 6 h sin latir), 200 por llamada.
 *
 * Se dispara desde la ruta del latido y solo un 2 % de las veces: es
 * mantenimiento, no parte de la respuesta. Hacerlo en cada latido añadiría un
 * viaje a la base de datos a la ruta más llamada de todo el bloque para
 * limpiar, casi siempre, cero filas.
 *
 * Nunca propaga: si el barrido falla, el latido de la persona no debe fallar
 * con él.
 */
export async function barrerSesiones(
  admin: SupabaseClient,
  probabilidad = 0.02,
): Promise<void> {
  if (Math.random() >= probabilidad) return
  try {
    await admin.rpc('barrer_sesiones_contenido', { p_max: 200 })
  } catch {
    // Mantenimiento oportunista. Se reintentará en el siguiente latido.
  }
}

/**
 * Una página del feed. Cliente RLS a propósito (ver cabecera).
 *
 * `feed_animo()` aplica el keyset sobre `idx_content_feed` y excluye lo ya
 * completado con una sonda por la PK de `content_views`. Cero OFFSET, cero
 * `count(*)`, una sola consulta.
 */
export async function paginaFeed(
  supabase: SupabaseClient,
  idioma: string,
  cursor: Cursor | null,
  limite: number,
): Promise<FilaFeed[]> {
  const desde = cursor ?? CURSOR_INICIAL

  const { data, error } = await supabase.rpc('feed_animo', {
    p_idioma: idioma,
    // `Infinity` no es JSON válido; el sentinel viaja como el literal que
    // Postgres entiende para `double precision`.
    p_cursor_score: Number.isFinite(desde.score) ? desde.score : 'Infinity',
    p_cursor_id: desde.id,
    p_limite: limite,
  })

  if (error) throw new ErrorApi('error_interno', { causa: error })

  return (Array.isArray(data) ? data : []) as FilaFeed[]
}
