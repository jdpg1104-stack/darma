// ============================================================================
// La capa que habla con Postgres. SIEMPRE con el cliente RLS.
//
// El único sitio de todo B09 donde se usa `service_role` es la reposición del
// banco (`reponer.ts`), y está justificado allí. Aquí no: si una fila no
// aparece, es que RLS ha decidido que no debe aparecer, y eso es el sistema
// funcionando.
//
// ── PRESUPUESTO DE CONSULTAS ───────────────────────────────────────────────
// `siguienteEncuestaPara` resuelve en DOS consultas como máximo:
//   1. la fila de `poll_cadence` por clave primaria (`user_id`);
//   2. `encuesta_siguiente()`, que elige la encuesta Y registra la cadencia en
//      la misma llamada.
// Y en UNA cuando la cadencia dice que no toca, que es el caso mayoritario: si
// hoy ya se han visto dos, no hay ninguna razón para ir a buscar una tercera.
//
// ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
//  · Ningún `count(*)` sobre `poll_votes`. Los recuentos salen de
//    `poll_options.vote_count` y `polls.total_votes`, que mantiene el trigger
//    `poll_votes_sync()` en el camino de ESCRITURA — N veces menos frecuente
//    que el de lectura. Por eso pintar una encuesta con un millón de votos
//    cuesta lo mismo que con diez.
//  · Ninguna lectura de `poll_bank`. El banco no se expone por API jamás:
//    enseñar las preguntas futuras sesga las respuestas de las presentes.
//  · Ninguna consulta que devuelva el voto de otra persona. `mi_voto` sale de
//    `auth.uid()` dentro de la función, nunca de un parámetro.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'
import { decidirMostrar, senalesDesdeFila, type DecisionCadencia } from './cadencia.ts'
import { aEncuestaFeed, esFilaEncuesta } from './resultados.ts'
import type { EncuestaFeed, FilaCadencia } from './tipos.ts'

export interface OpcionesSiguiente {
  userId: string
  /** Posición de la tarjeta en la página del feed. */
  posicion: number
  /** 'es' | 'en'. Determina el pool de encuestas activas. */
  idioma: string
  /** Inyectable para que los tests de cadencia no dependan del reloj. */
  ahora?: Date
}

export interface ResultadoSiguiente {
  encuesta: EncuestaFeed | null
  /** Por qué se decidió lo que se decidió. Para logs, nunca para la UI. */
  decision: DecisionCadencia
}

/**
 * La encuesta que le toca a esta persona ahora, o `null`.
 *
 * Expuesta con este nombre porque es el punto de integración que B02 consumirá
 * desde el feed (ver HANDOFF/PEDIDOS.md).
 */
export async function siguienteEncuestaPara(
  supabase: SupabaseClient,
  opciones: OpcionesSiguiente,
): Promise<ResultadoSiguiente> {
  const ahora = opciones.ahora ?? new Date()

  // 1 · Señales. `maybeSingle()` y no `single()`: no tener fila es el estado
  // normal de quien nunca ha visto una encuesta, no un error.
  const { data, error } = await supabase
    .from('poll_cadence')
    .select('last_shown_at, shown_today, day')
    .eq('user_id', opciones.userId)
    .maybeSingle<FilaCadencia>()

  if (error) {
    throw new ErrorApi('error_interno', { causa: error })
  }

  // `yaVotoOMDescarto` es false a propósito: la consulta de `encuesta_siguiente()`
  // ya excluye por SQL todo lo votado y lo descartado (los dos `not exists`), así
  // que si devuelve algo, por definición no está respondido. La señal existe en
  // el contrato para quien llame a `decidirMostrar` con una encuesta CONCRETA
  // en la mano —la tarjeta ya montada del feed—, que sí puede saberlo.
  const senales = senalesDesdeFila(data, opciones.posicion, false, ahora)
  const decision = decidirMostrar(senales, ahora)

  if (!decision.mostrar) {
    return { encuesta: null, decision }
  }

  // 2 · Elegir y registrar, en una sola llamada y una sola transacción. Si
  // fueran dos, entre el `select` y el `update` cabría un segundo scroll y la
  // misma encuesta se contaría una vez o dos según la latencia.
  const { data: fila, error: errorRpc } = await supabase.rpc('encuesta_siguiente', {
    p_idioma: opciones.idioma,
  })

  if (errorRpc) {
    throw new ErrorApi('error_interno', { causa: errorRpc })
  }

  if (!esFilaEncuesta(fila)) {
    // Pool vacío para este idioma. No es un error: la reposición nocturna lo
    // arreglará, y mientras tanto el feed se sirve sin encuestas.
    return { encuesta: null, decision: { mostrar: false, motivo: 'sin_candidatas' } }
  }

  return { encuesta: aEncuestaFeed(fila), decision }
}

/**
 * Resultados de una encuesta. El umbral de revelación ya viene aplicado desde
 * Postgres; `aEncuestaFeed` lo vuelve a comprobar (ver `resultados.ts`).
 */
export async function resultadosDeEncuesta(
  supabase: SupabaseClient,
  pollId: string,
): Promise<EncuestaFeed> {
  const { data, error } = await supabase.rpc('encuesta_resultados', { p_poll: pollId })

  if (error) {
    throw new ErrorApi('error_interno', { causa: error })
  }

  if (!esFilaEncuesta(data)) {
    // Mismo 404 tanto si la encuesta no existe como si existe pero está
    // retirada: distinguirlos convertiría la ruta en un detector de encuestas
    // moderadas.
    throw new ErrorApi('no_encontrado')
  }

  return aEncuestaFeed(data)
}

export interface OpcionesVoto {
  pollId: string
  opcionId: string
  /** SIEMPRE de la sesión. Nunca del body (CONTRATOS §6). */
  userId: string
}

/**
 * Registra el voto. El motor decide; esta función solo traduce su veredicto.
 *
 * Las tres reglas las hace cumplir Postgres, no este código:
 *   · un voto por persona y encuesta → PK `(poll_id, user_id)`, error `23505`;
 *   · la opción pertenece a la encuesta → FK compuesta, error `23503`;
 *   · la encuesta admite votos y el `user_id` es el tuyo → política RLS,
 *     error `42501`.
 *
 * Comprobar cualquiera de las tres aquí antes de insertar sería una condición
 * de carrera con dos peticiones simultáneas, y además una consulta de más.
 */
export async function registrarVoto(
  supabase: SupabaseClient,
  opciones: OpcionesVoto,
): Promise<void> {
  const { error } = await supabase.from('poll_votes').insert({
    poll_id: opciones.pollId,
    option_id: opciones.opcionId,
    user_id: opciones.userId,
  })

  if (error) {
    throw errorDeVoto(error)
  }
}

/**
 * Traduce el error de Postgres al código público.
 *
 * Está separada y exportada para poder probar los tres caminos sin base de
 * datos: son justo los que no se ejercitan por accidente.
 */
export function errorDeVoto(causa: unknown): ErrorApi {
  const codigo = codigoSql(causa)

  // 23505 = unique_violation sobre la PK (poll_id, user_id). NO es un 500 ni un
  // 409: para quien lo recibe es «esto ya lo hiciste», y el voto es definitivo
  // porque 0002 revoca update y delete sobre poll_votes a propósito.
  if (codigo === '23505') {
    return new ErrorApi('sin_permiso', {
      mensaje: 'Ya has respondido a esta encuesta. Aquí el voto es definitivo.',
    })
  }

  // 23503 = foreign_key_violation: la opción no es de esta encuesta (o no
  // existe). El mensaje es el genérico de `entrada_invalida` a propósito: decir
  // «esa opción no existe» convertiría la ruta en un oráculo para enumerar ids.
  if (codigo === '23503') {
    return new ErrorApi('entrada_invalida', { causa })
  }

  // 42501 = la política RLS lo rechazó: encuesta cerrada, oculta, o alguien
  // intentando votar en nombre de otra persona.
  if (codigo === '42501') {
    return new ErrorApi('sin_permiso', {
      mensaje: 'Esta encuesta ya no admite respuestas.',
      causa,
    })
  }

  return new ErrorApi('error_interno', { causa })
}

/**
 * Descarta una encuesta. Idempotente por la PK `(poll_id, user_id)`.
 *
 * `ignoreDuplicates` genera `ON CONFLICT DO NOTHING`, que no necesita el
 * privilegio de UPDATE —revocado sobre esta tabla— y que hace que pulsar dos
 * veces «no me interesa» no devuelva un error por algo que ya está como se
 * quería.
 */
export async function registrarDescarte(
  supabase: SupabaseClient,
  opciones: { pollId: string; userId: string },
): Promise<void> {
  const { error } = await supabase
    .from('poll_dismissals')
    .upsert({ poll_id: opciones.pollId, user_id: opciones.userId }, { ignoreDuplicates: true })

  if (error) {
    const codigo = codigoSql(error)
    if (codigo === '23503') throw new ErrorApi('no_encontrado')
    if (codigo === '42501') throw new ErrorApi('sin_permiso', { causa: error })
    throw new ErrorApi('error_interno', { causa: error })
  }
}

function codigoSql(causa: unknown): string {
  if (typeof causa === 'object' && causa !== null && 'code' in causa) {
    return String((causa as { code?: unknown }).code ?? '')
  }
  return ''
}
