// ============================================================================
// B07 · La regla de acreditación, en TypeScript.
//
// ⚠️ ESTE ARCHIVO ES EL ESPEJO EXACTO de `latido_contenido()` y de la
// comprobación de umbral de `completar_contenido()` en
// `supabase/migrations/0107_1_b07_reproduccion.sql`. Si cambias una constante
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
