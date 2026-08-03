// ============================================================================
// B19 · Formateo de las cifras del panel
//
// Puro y sin JSX para que se pueda probar y para que no arrastre React donde no
// hace falta. Todo en español directo (deuda de traducción anotada en
// PEDIDOS.md para B17).
//
// Regla que atraviesa el archivo: NUNCA se pinta `NaN`, `Infinity` ni
// `undefined`. Un panel con «NaN%» en la tarjeta del KPI es un panel que la
// gente deja de creerse, y a partir de ahí da igual lo bien que estén los
// demás números.
// ============================================================================

/** Entero con separador de millares. */
export function entero(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.trunc(n).toLocaleString('es-ES')
}

/** Un ratio con dos decimales: «3,24». */
export function decimal(n: number, decimales = 2): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

/** Fracción 0..1 como porcentaje: «84,2 %». */
export function porcentaje(fraccion: number, decimales = 1): string {
  if (!Number.isFinite(fraccion)) return '—'
  return `${(fraccion * 100).toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} %`
}

/**
 * Duración legible. El panel habla de tiempos de respuesta, y «4 min» se
 * entiende de un vistazo mientras que «247 s» hay que dividirlo mentalmente
 * justo cuando alguien está mirando si hay una crisis sin atender.
 */
export function duracion(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos)) return '—'
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${(s / 3600).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
  return `${(s / 86400).toLocaleString('es-ES', { maximumFractionDigits: 1 })} d`
}

/** Céntimos enteros → «19,99 €». Nunca se opera en coma flotante con dinero
 *  (CONTRATOS §1): se divide solo aquí, al pintar. */
export function euros(centimos: number): string {
  if (!Number.isFinite(centimos)) return '—'
  return `${(Math.trunc(centimos) / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

/** Fecha fija e independiente del navegador: dos personas hablando del mismo
 *  número tienen que ver la misma hora. */
export function fecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`
}
