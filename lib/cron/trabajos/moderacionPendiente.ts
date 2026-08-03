// ============================================================================
// B00 · integración · reproceso de lo que se publicó con el clasificador caído.
//
// Lo pidió B11 (HANDOFF/PEDIDOS.md, «De B11 → B08 / B14 / F4»). El agujero que
// tapa es concreto y silencioso:
//
// Cuando el clasificador no responde —sin clave, timeout, 429, presupuesto
// agotado—, `evaluarContenido()` degrada de forma segura: el texto SE PUBLICA
// (la voz falla abierta) pero NO se valida (la economía falla cerrada), y se
// abre un flag `ai_unavailable` en `moderation_flags`. Es la decisión correcta.
// Lo que faltaba era la segunda mitad: SIN ESTE TRABAJO, ese flag se queda
// `pending` para siempre. Quien acompañó a alguien durante la caída publicó su
// comentario, sí — pero nunca recuperó su karma ni su crédito de reciprocidad.
// Se le pidió que escuchara tres veces para poder hablar una, escuchó, y el
// sistema no se lo apuntó porque nuestra factura de IA tuvo un mal día.
//
// ── LA REGLA QUE HACE QUE ESTO NO SE CONVIERTA EN UN BUCLE ─────────────────
// Si el reproceso vuelve a salir DEGRADADO, el clasificador sigue caído: se
// deja el flag como estaba y se ABANDONA el trabajo entero de inmediato. Seguir
// iterando gastaría el presupuesto de la función (y el de IA) en fabricar flags
// `ai_unavailable` nuevos encima de los viejos. Se sale `parcial` y mañana se
// vuelve a intentar.
//
// ── IDEMPOTENCIA ──────────────────────────────────────────────────────────
// La cola es «flags `ai_unavailable` en `pending`», y un flag sale de ella al
// resolverse. Reintentar el trabajo tras un timeout reprocesa como mucho lo que
// no llegó a cerrarse. El `UPDATE … eq('is_validated', false)` con `returning`
// es lo que impide acreditar el mismo karma dos veces: si la columna ya estaba
// a `true`, no devuelve fila y no se cuenta.
// ============================================================================

import { evaluarContenido, type TipoContenido } from '../../ai/pipeline.ts'
import type { ContextoTrabajo, ResultadoTrabajo, Trabajo } from '../tipos.ts'

/** Flags por pasada. El presupuesto de reloj corta antes en la práctica. */
export const LOTE_FLAGS = 25

interface FilaFlagPendiente {
  id: number
  ref_type: string
  ref_id: string | null
}

interface Contenido {
  texto: string
  autorId: string
  tipo: TipoContenido
}

/**
 * Lee el texto original del contenido señalado.
 *
 * `refuge_message` NO se reprocesa nunca y es deliberado: su cuerpo está
 * cifrado de extremo a extremo (`ciphertext`, 0002) y el servidor no tiene la
 * clave. Se deja `pending` para la cola humana, que es quien puede verlo — en
 * el dispositivo de quien lo reportó, no aquí.
 */
async function leerContenido(
  ctx: ContextoTrabajo,
  fila: FilaFlagPendiente,
): Promise<Contenido | null> {
  if (fila.ref_id == null) return null

  if (fila.ref_type === 'comment') {
    const { data, error } = await ctx.admin
      .from('comments')
      .select('body, author_id, is_validated')
      .eq('id', fila.ref_id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    // Ya validado por otra vía: no hay nada que recuperar.
    if (data.is_validated === true) return null
    return { texto: data.body as string, autorId: data.author_id as string, tipo: 'comment' }
  }

  if (fila.ref_type === 'post') {
    const { data, error } = await ctx.admin
      .from('posts')
      .select('body, author_id')
      .eq('id', fila.ref_id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return { texto: data.body as string, autorId: data.author_id as string, tipo: 'post' }
  }

  return null
}

/** Cierra el flag viejo. `resolved`: la máquina ya dio su veredicto. */
async function resolverFlag(ctx: ContextoTrabajo, id: number): Promise<void> {
  const ahora = new Date().toISOString()
  // `reviewer_id` se queda null a propósito: no lo revisó una persona, y
  // atribuirle la decisión a un humano falsearía la auditoría de moderación.
  const { error } = await ctx.admin
    .from('moderation_flags')
    .update({ state: 'resolved', reviewed_at: ahora, resolved_at: ahora })
    .eq('id', id)
    .eq('state', 'pending')
  if (error) throw new Error(error.message)
}

export async function ejecutarModeracionPendiente(ctx: ContextoTrabajo): Promise<ResultadoTrabajo> {
  const { data, error } = await ctx.admin
    .from('moderation_flags')
    .select('id, ref_type, ref_id')
    .eq('signal', 'ai_unavailable')
    .eq('state', 'pending')
    // Lo más antiguo primero: quien lleva más tiempo sin su karma cobra antes.
    .order('created_at', { ascending: true })
    .limit(LOTE_FLAGS)

  if (error) throw new Error(error.message)

  const cola = (data ?? []) as FilaFlagPendiente[]

  let reprocesados = 0
  let validados = 0
  let sinContenido = 0
  let cifrados = 0
  let clasificadorCaido = false

  for (const fila of cola) {
    if (ctx.agotado()) break

    if (fila.ref_type === 'refuge_message') {
      cifrados += 1
      continue
    }

    const contenido = await leerContenido(ctx, fila)
    if (!contenido) {
      // El contenido se borró, se retiró o ya estaba validado. El flag ya no
      // señala nada: se cierra para que la cola humana no lo arrastre.
      sinContenido += 1
      await resolverFlag(ctx, fila.id)
      continue
    }

    const salida = await evaluarContenido(
      {
        texto: contenido.texto,
        tipo: contenido.tipo,
        // De la tabla, no de ninguna petición: aquí no hay sesión de la que
        // sacarlo y aceptar un autor de fuera sería regalar karma a quien pida.
        autorId: contenido.autorId,
        refId: fila.ref_id ?? undefined,
      },
      {
        admin: ctx.admin,
        // El límite por usuario existe para frenar a una persona escribiendo en
        // bucle. Aquí el que llama es el cron, sobre texto de hace horas: sin
        // esto, el reproceso de veinte comentarios de la misma persona se
        // autobloquearía. Es el mismo interruptor que B11 dejó previsto.
        omitirLimiteUsuario: true,
      },
    )

    reprocesados += 1

    if (salida.degradado) {
      // Sigue caído. Ni se resuelve el flag ni se sigue quemando presupuesto.
      clasificadorCaido = true
      break
    }

    if (salida.validado && contenido.tipo === 'comment') {
      // ⛔ Cliente admin obligatorio: desde 0004, `authenticated` no tiene
      // `grant update` sobre `is_validated`. El UPDATE con el cliente RLS
      // devolvería 200 SIN escribir la columna — el peor fallo, el silencioso.
      //
      // El trigger de 0001 (`after update of is_validated`) es lo que de verdad
      // acredita: +1 listen_credits, +1 listens_given, award_karma
      // ('comment_validated') y +1 posts.reply_count. Aquí no se toca ninguno
      // de esos contadores a mano.
      const { data: marcado, error: errorMarcar } = await ctx.admin
        .from('comments')
        .update({ is_validated: true })
        .eq('id', fila.ref_id)
        .eq('is_validated', false)
        .select('id')
        .maybeSingle()

      // 23505 sobre `uq_comments_one_listen_per_post`: esta persona ya había
      // acompañado a la del post. No es un error, es la regla antifarmeo
      // haciendo su trabajo — y el flag se cierra igual.
      if (errorMarcar && errorMarcar.code !== '23505') throw new Error(errorMarcar.message)
      if (marcado) validados += 1
    }

    await resolverFlag(ctx, fila.id)
  }

  return {
    estado: clasificadorCaido || cola.length === LOTE_FLAGS ? 'parcial' : 'ok',
    detalle: {
      en_cola: cola.length,
      reprocesados,
      karma_recuperado: validados,
      sin_contenido: sinContenido,
      cifrados_omitidos: cifrados,
      clasificador_caido: clasificadorCaido,
    },
  }
}

export const TRABAJO_MODERACION_PENDIENTE: Trabajo = {
  id: 'moderacion-pendiente',
  presupuestoMs: 8_000,
  minimoMs: 1_500,
  ejecutar: ejecutarModeracionPendiente,
}
