// ============================================================================
// B07 · La regla de acreditación, en TypeScript.
//
// ⚠️ ESTE ARCHIVO ES EL ESPEJO EXACTO de `latido_contenido()` y de la
// comprobación de umbral de `completar_contenido()` en
// `supabase/migrations/0107_1_b07_reproduccion.sql`, más `duracion_util()` y
// los CHECK del fragmento en `0224_1_b07_clips.sql`. Si cambias una constante
// aquí, cámbiala allí — y al revés. Hay un test que compara los dos caminos
// sobre la misma secuencia de latidos.
//
// LA AUTORIDAD ES POSTGRES, siempre (ARCHITECTURE §0). Esto NO decide nada en
// producción: sirve para (a) que el cliente pinte la barra de progreso sin
// preguntar en cada fotograma, y (b) que la regla anti-farmeo se pueda probar
// exhaustivamente sin una base de datos. Que el cliente calcule lo mismo no le
// da ningún poder: el +1 lo concede la RPC con SU propio acumulado.
// ============================================================================

/**
 * Tope de segundos que puede acreditar UN latido.
 *
 * Es la pieza central del anti-farmeo. El cliente late cada 5 s; 7 da margen
 * para una pestaña que tarda en despertar sin regalar tiempo. Sin este tope, un
 * cliente que retiene los latidos y los descarga de golpe acreditaría el vídeo
 * entero en una ráfaga de milisegundos: el servidor vería N llamadas, y sin
 * tope cada una valdría lo que el cliente dijera.
 */
export const TOPE_POR_LATIDO_S = 7

/** Cada cuánto late el cliente mientras reproduce y la pestaña es visible. */
export const INTERVALO_LATIDO_MS = 5_000

/** Fracción de la duración que hay que ver para cobrar el +1. El 90 % deja
 *  fuera los créditos finales sin permitir saltarse el contenido. */
export const FRACCION_COMPLETADO = 0.9

/**
 * Duración supuesta cuando `duration_seconds` es NULL.
 *
 * Los vídeos que ingiere B08 por feed Atom llegan SIN duración (el feed no la
 * trae; anotado en PEDIDOS.md). Sin este valor el objetivo sería NULL y el
 * primer latido completaría el vídeo, que es justo el agujero que este bloque
 * cierra.
 */
export const DURACION_POR_DEFECTO_S = 60

/**
 * Longitud mínima y máxima de un fragmento curado, en segundos.
 *
 * ⚠️ ESPEJO de los CHECK `content_items_clip_rango` de la migración
 * `0224_1_b07_clips.sql`. Hay una prueba que compara los dos rangos.
 *
 *  · 15 s de mínimo — por debajo, el objetivo del +1 (el 90 %) baja de 14 s y
 *    el karma se vuelve regalable a golpe de scroll.
 *  · 180 s de máximo — es el techo de «fragmento». Sin él, nada impide curar
 *    un «fragmento» de 40 minutos y volver al punto de partida.
 */
export const CLIP_MIN_S = 15
export const CLIP_MAX_S = 180

/**
 * Los segundos que de verdad hay que ver.
 *
 * ⚠️ ESPEJO EXACTO de `duracion_util()` en la migración `0224_1_b07_clips.sql`.
 * Es la pieza que hace que un fragmento sea un fragmento de verdad y no solo
 * un embed recortado: si esto devolviera la duración del vídeo entero, la
 * barra de progreso pediría 78 minutos para un fragmento de 40 segundos y el
 * +1 no llegaría nunca.
 *
 * El orden de preferencia —fragmento, vídeo, 60— importa: un ítem con
 * fragmento pero sin `duration_seconds` (los del feed Atom no la traen) tiene
 * que contar por el fragmento, no caerse al respaldo.
 */
export function duracionUtil(
  duracionSegundos: number | null,
  clipInicioSegundos: number | null,
  clipFinSegundos: number | null,
): number {
  if (clipInicioSegundos !== null && clipFinSegundos !== null) {
    return clipFinSegundos - clipInicioSegundos
  }
  return duracionSegundos ?? DURACION_POR_DEFECTO_S
}

/** ¿Es un par de marcas de tiempo que el esquema aceptaría? */
export function clipValido(
  clipInicioSegundos: number | null,
  clipFinSegundos: number | null,
  duracionSegundos: number | null = null,
): boolean {
  // La pareja: uno sin el otro es un estado a medias que ningún consumidor
  // sabría leer. Lo impone también un CHECK, y por el mismo motivo.
  if (clipInicioSegundos === null && clipFinSegundos === null) return true
  if (clipInicioSegundos === null || clipFinSegundos === null) return false

  if (!Number.isInteger(clipInicioSegundos) || !Number.isInteger(clipFinSegundos)) return false
  if (clipInicioSegundos < 0) return false

  const largo = clipFinSegundos - clipInicioSegundos
  if (largo < CLIP_MIN_S || largo > CLIP_MAX_S) return false

  // El fragmento no puede terminar después del vídeo. Solo se comprueba cuando
  // la duración consta: rechazarlo por no constar impediría curar justo los
  // ítems que llegan sin duración.
  if (duracionSegundos !== null && clipFinSegundos > duracionSegundos) return false

  return true
}

/**
 * ¿Este ítem no se puede aprobar sin elegir un fragmento?
 *
 * Vive aquí y no en la ruta de curación porque lo consultan los dos lados: el
 * servidor para rechazar la aprobación, y la pantalla para pedir el recorte
 * ANTES de que alguien pulse. Dos copias de esta regla serían dos umbrales
 * distintos el día que se toque uno.
 *
 * Sí cuando la duración CONSTA y pasa del techo de fragmento. Los dos matices
 * importan:
 *
 *  · Si no consta (los ítems que llegan por feed Atom no la traen), no se
 *    exige: sería impedir curar justo lo que peor documentado llega. La
 *    acreditación los trata como 60 s, que es un objetivo alcanzable.
 *  · El umbral es el techo del fragmento y no un número aparte. Un vídeo que ya
 *    dura menos que un fragmento no necesita recorte: ya ES el fragmento.
 */
export function exigeFragmento(duracionSegundos: number | null): boolean {
  return duracionSegundos !== null && duracionSegundos > CLIP_MAX_S
}

/** Segundos que hay que acumular para que el +1 se conceda. */
export function objetivoCompletado(duracionSegundos: number | null): number {
  const duracion = duracionSegundos ?? DURACION_POR_DEFECTO_S
  return Math.ceil(FRACCION_COMPLETADO * duracion)
}

/**
 * Acumulado tras un latido. Dos topes, y los dos hacen falta:
 *
 *  · `min(delta, 7)`  — por llamada. Impide declarar 300 s de golpe.
 *  · `min(total, duracion)` — acumulado. Impide que una pestaña abierta toda la
 *    noche, o una sesión reabierta muchas veces, acredite más de lo que el
 *    vídeo dura.
 *
 * `delta` NUNCA lo envía el cliente: es `now() - last_beat_at` medido con el
 * reloj del servidor. El parámetro está aquí porque esta función es la copia
 * probable de la regla, no la que se ejecuta en producción.
 */
export function acreditarLatido(
  acumuladoSegundos: number,
  deltaSegundos: number,
  duracionSegundos: number | null,
): number {
  const duracion = duracionSegundos ?? DURACION_POR_DEFECTO_S
  const incremento = Math.max(0, Math.min(Math.trunc(deltaSegundos), TOPE_POR_LATIDO_S))
  return Math.min(acumuladoSegundos + incremento, duracion)
}

/** Segundos que faltan para el +1. Es la única cifra de la sesión que sale del
 *  servidor: el bruto acumulado le diría al farmeador cuánto le queda exacto. */
export function faltanSegundos(acumuladoSegundos: number, duracionSegundos: number | null): number {
  return Math.max(objetivoCompletado(duracionSegundos) - acumuladoSegundos, 0)
}

export function estaListo(acumuladoSegundos: number, duracionSegundos: number | null): boolean {
  return acumuladoSegundos >= objetivoCompletado(duracionSegundos)
}
