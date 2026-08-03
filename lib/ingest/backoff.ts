// ============================================================================
// B08 · Backoff exponencial CON JITTER.
//
// POR QUÉ EL JITTER NO ES UN ADORNO:
// Ocho fuentes que fallan a la vez (una caída de red, un despliegue del
// proveedor, un corte de DNS) se recuperan a la vez. Sin jitter, las ocho
// calculan exactamente la misma espera, reintentan en el mismo instante,
// vuelven a fallar a la vez y repiten el mismo patrón para siempre: el
// «thundering herd» convierte un incidente de treinta segundos en una tormenta
// sincronizada que no se deshace sola. Multiplicar por (0,5 + aleatorio) rompe
// la sincronía en el primer reintento.
//
// POLÍTICA DE REINTENTO POR CÓDIGO — la decide `clasificarFalloHttp`:
//   · 429 y 5xx  → reintentar. Significan «ahora no», no «nunca».
//   · 4xx ≠ 429  → NO reintentar: deshabilitar la fuente y registrar el motivo.
//     Un feed que devuelve 404 no va a mejorar solo, y reintentarlo cada seis
//     horas durante meses es ruido en los logs que tapa los fallos reales.
//   · fallo de red (sin status) → reintentar: es indistinguible de un 5xx.
// ============================================================================

/** Espera mínima base: 60 s para `fallosConsecutivos = 0`. */
export const BASE_ESPERA_MS = 60_000

/** Techo duro: 6 horas. Más allá, la fuente ya está efectivamente parada. */
export const MAX_ESPERA_MS = 6 * 60 * 60 * 1000

/**
 * Cuánto esperar antes de volver a llamar a una fuente que ha fallado `n` veces
 * seguidas: `min(2^n * 60 s, 6 h) * (0,5 + aleatorio)`.
 *
 * PURA salvo por `Math.random()`, que es justamente lo que se está probando:
 * dos llamadas con el mismo `n` NO deben devolver el mismo valor.
 *
 * @param fallosConsecutivos valores negativos o no finitos se tratan como 0.
 * @param aleatorio inyectable para los tests; por defecto `Math.random()`.
 */
export function siguienteEspera(fallosConsecutivos: number, aleatorio: () => number = Math.random): number {
  const n = Number.isFinite(fallosConsecutivos) ? Math.max(0, Math.floor(fallosConsecutivos)) : 0

  // El exponente se acota ANTES de elevar: 2^1024 es Infinity, e Infinity * 0,5
  // sigue siendo Infinity. Con el tope aplicado después, un contador de fallos
  // corrupto produciría una espera infinita en vez de seis horas.
  const exponente = Math.min(n, 20)
  const base = Math.min(BASE_ESPERA_MS * 2 ** exponente, MAX_ESPERA_MS)

  // (0,5 + [0,1)) → entre el 50 % y el 150 % de la base. Nunca cero: una espera
  // de 0 ms sería un reintento inmediato, que es lo contrario de un backoff.
  return Math.round(base * (0.5 + aleatorio()))
}

/** Instante hasta el que NO se debe volver a llamar a la fuente. */
export function siguienteCooldown(
  fallosConsecutivos: number,
  ahora: Date = new Date(),
  aleatorio: () => number = Math.random,
): Date {
  return new Date(ahora.getTime() + siguienteEspera(fallosConsecutivos, aleatorio))
}

/** Qué hacer con una fuente que acaba de fallar. */
export type AccionFallo = 'reintentar' | 'deshabilitar'

/**
 * @param status código HTTP, o `null` si ni siquiera hubo respuesta (red caída,
 *               timeout, DNS). Sin respuesta se reintenta: es indistinguible de
 *               un 5xx y tratarlo como definitivo apagaría fuentes buenas.
 */
export function clasificarFalloHttp(status: number | null): AccionFallo {
  if (status == null) return 'reintentar'
  if (status === 429) return 'reintentar'
  if (status >= 500) return 'reintentar'
  if (status >= 400) return 'deshabilitar'
  // Un 2xx/3xx que llega hasta aquí es un fallo de parseo, no de transporte:
  // puede ser un hipo del proveedor sirviendo una página de error con 200.
  return 'reintentar'
}
