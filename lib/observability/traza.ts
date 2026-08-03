// ============================================================================
// conTraza — envuelve una operación, la mide y la deja registrada
//
// Es la única forma que hay en Darma de medir "cuánto tarda ESTO" sin repetir
// en veinte sitios el mismo `const t0 = ...; try { } finally { }`. Repetido a
// mano, la mitad de las copias acaba sin el `finally` y deja de medir justo el
// caso interesante: el que falla.
//
// Tres propiedades que hay que conservar si alguien toca este archivo:
//
//  1. NO SE TRAGA EL ERROR. La excepción se vuelve a lanzar tal cual. Un
//     envoltorio de observabilidad que convierta un fallo en `undefined` es una
//     forma sofisticada de romper la app para medirla mejor.
//  2. MIDE TAMBIÉN EL CAMINO DE FALLO. La latencia de los errores es la que más
//     dice: un timeout de 2 s aparece en el histograma como 2 s, no desaparece.
//  3. NO REGISTRA EL RESULTADO. Solo el nombre, la duración y si hubo error. El
//     valor devuelto puede ser una fila de `posts` — es decir, el desahogo de
//     alguien.
// ============================================================================

import { observarError, observarLatencia } from './metricas.ts'
import type { Logger } from './logger.ts'

/** Reloj monótono: `Date.now()` puede saltar hacia atrás con un ajuste de NTP y
 *  producir duraciones negativas en los percentiles. */
function ahora(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Ejecuta `fn` midiéndola. Devuelve lo que devuelva `fn`; si lanza, registra la
 * línea de error, cuenta la métrica y **vuelve a lanzar**.
 *
 * @param nombre Etiqueta de BAJA cardinalidad (`sql:feed`, `ia:clasificar`).
 *               Nunca un identificador: ver la nota de cardinalidad en
 *               metricas.ts.
 */
export async function conTraza<T>(
  nombre: string,
  fn: () => Promise<T>,
  log?: Logger,
): Promise<T> {
  const t0 = ahora()
  try {
    const valor = await fn()
    const ms = ahora() - t0
    observarLatencia(nombre, ms)
    // `ms` en los campos hace que el muestreo emita SIEMPRE lo que pase de 1 s
    // (ver decidirMuestreo): lo lento nunca se pierde en el 99 % descartado.
    log?.debug('traza', { traza: nombre, ms: Math.round(ms), ok: true })
    return valor
  } catch (causa) {
    const ms = ahora() - t0
    observarLatencia(nombre, ms)
    observarError(`traza_${nombre}`)
    log?.error('traza_error', {
      traza: nombre,
      ms: Math.round(ms),
      ok: false,
      // Solo el NOMBRE del error. El mensaje de un error de Postgres filtra
      // tablas, columnas y nombres de índice (ver lib/apiErrors.ts).
      error: causa instanceof Error ? causa.name : 'desconocido',
    })
    throw causa
  }
}

/**
 * Igual que `conTraza`, pero con un límite de tiempo.
 *
 * Existe porque una comprobación de salud que espera indefinidamente a Postgres
 * no es una comprobación de salud: es la misma caída, servida más despacio.
 * `/api/health` la usa con 2 s.
 *
 * La promesa original NO se cancela (no se puede, en general): se deja de
 * esperar. El temporizador se limpia siempre para que el proceso no quede
 * despierto por un `setTimeout` huérfano.
 */
export class TiempoAgotadoError extends Error {
  readonly nombre: string
  readonly limiteMs: number

  // Sin propiedades de parámetro (`constructor(public x)`): el modo
  // strip-only de `node --experimental-strip-types` no las soporta, y los tests
  // de este bloque se ejecutan justo con ese modo.
  constructor(nombre: string, limiteMs: number) {
    super(`tiempo agotado en ${nombre} tras ${limiteMs} ms`)
    this.name = 'TiempoAgotadoError'
    this.nombre = nombre
    this.limiteMs = limiteMs
  }
}

export async function conLimite<T>(nombre: string, limiteMs: number, fn: () => Promise<T>): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new TiempoAgotadoError(nombre, limiteMs)), limiteMs)
      }),
    ])
  } finally {
    if (temporizador) clearTimeout(temporizador)
  }
}
