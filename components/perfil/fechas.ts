// ============================================================================
// Formato de fecha del historial — determinista a propósito
//
// ── POR QUÉ NO `Intl.DateTimeFormat` NI `toLocaleDateString` ───────────────
// El historial se renderiza en el servidor (primera página) y se amplía en el
// cliente ("cargar más"). Con `toLocaleDateString`, el servidor formatea en la
// zona horaria de Vercel (UTC) y el navegador en la de la persona: la misma
// fila sale «3 ago» en el HTML y «2 ago» tras hidratar, y React avisa de un
// desajuste de hidratación en la consola de todo el mundo.
//
// Esta función parte la cadena ISO —que Postgres devuelve siempre en UTC— sin
// construir un `Date`, así que da el MISMO resultado en los dos lados. El coste
// es real y hay que decirlo: quien esté en Buenos Aires verá la fecha UTC, que a
// partir de las 21:00 locales es el día siguiente. Se acepta porque el
// historial de karma se lee por orden, no por fecha exacta, y el `datetime` del
// `<time>` lleva el instante completo para quien lo necesite de verdad.
// ============================================================================

const MESES: readonly string[] = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

/**
 * `2026-08-03T12:34:56Z` → `3 ago 2026`. Devuelve la cadena original si no
 * reconoce el formato: en una pantalla de transparencia del karma vale más una
 * fecha fea que una fila sin fecha.
 */
export function formatearFechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso

  const [, anio, mes, dia] = m
  const nombreMes = MESES[Number(mes) - 1]
  if (!nombreMes) return iso

  // `Number(dia)` quita el cero a la izquierda: «3 ago», no «03 ago».
  return `${Number(dia)} ${nombreMes} ${anio}`
}

/**
 * Delta con signo EXPLÍCITO en el texto: «+10», «−40».
 *
 * El signo va escrito, no solo en el color. Si el rojo y el dorado fueran lo
 * único que distingue una penalización de una recompensa, quien no distinga
 * esos dos colores —hay daltonismo entre el 8 % de los hombres— leería su
 * historial de karma al revés.
 *
 * Se usa el menos tipográfico (U+2212), no el guion del teclado: en la mayoría
 * de tipografías el guion es más corto y más alto que el signo `+`, y en una
 * columna de números alineados se lee como un guion de separación.
 */
export function formatearDelta(valor: number): string {
  if (valor === 0) return '0'
  return valor > 0 ? `+${valor}` : `−${Math.abs(valor)}`
}
