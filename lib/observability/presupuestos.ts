// ============================================================================
// Presupuestos de rendimiento y de seguridad · los umbrales viven en CÓDIGO
//
// POR QUÉ AQUÍ Y NO EN UN DASHBOARD. Un umbral configurado en la interfaz de
// Grafana no se revisa en un pull request, no se versiona, no se puede
// justificar en un comentario y sobrevive a la persona que lo puso. Aquí, subir
// un límite es un diff que alguien tiene que aprobar y explicar. Un presupuesto
// que se puede relajar sin dejar rastro no es un presupuesto.
//
// Los números salen de CONTRATOS.md §11 y de la ficha B14. Cambiar uno sin
// cambiar el contrato es duplicar la fuente de verdad.
// ============================================================================

export const PRESUPUESTOS = {
  feed_p95_ms: 300,          // ruta completa /api/feed
  feed_sql_p95_ms: 50,       // solo la consulta (CONTRATOS.md §11)
  composer_p95_ms: 800,      // incluye la clasificación de B11
  hilo_p95_ms: 400,
  ratio_5xx: 0.001,          // 0,1 %
  crisis_sin_atender_max: 5, // más de 5 en cola = alerta grave
  ia_gasto_diario_usd: 50,
} as const

export type ClavePresupuesto = keyof typeof PRESUPUESTOS

/**
 * Severidad de una violación.
 *
 * `crisis` NO es "grave dentro de la misma escala": es otra escala. Un p95 de
 * feed disparado degrada la experiencia y se mira por la mañana. Una cola de
 * crisis sin atender significa que hay personas que han escrito algo que el
 * clasificador marcó como riesgo alto y que **nadie ha leído todavía**. Se
 * escala por un canal distinto, despierta a alguien, y no se agrupa nunca con
 * el resto en el mismo panel — porque en un panel compartido la alerta que
 * importa acaba silenciada junto a las que no.
 */
export type Severidad = 'rendimiento' | 'fiabilidad' | 'crisis'

export interface Violacion {
  clave: ClavePresupuesto
  valor: number
  limite: number
  severidad: Severidad
}

const SEVERIDADES: Readonly<Record<ClavePresupuesto, Severidad>> = {
  feed_p95_ms: 'rendimiento',
  feed_sql_p95_ms: 'rendimiento',
  composer_p95_ms: 'rendimiento',
  hilo_p95_ms: 'rendimiento',
  ratio_5xx: 'fiabilidad',
  crisis_sin_atender_max: 'crisis',
  ia_gasto_diario_usd: 'fiabilidad',
}

/**
 * Nombres alternativos aceptados en la instantánea.
 *
 * La métrica se llama `crisis_sin_atender` (cuántas hay) y el presupuesto
 * `crisis_sin_atender_max` (cuántas se toleran). Obligar a que coincidan
 * llevaría a llamar `_max` a un contador, que es justo el tipo de nombre que
 * hace que alguien lea mal un panel a las tres de la mañana.
 */
const ALIAS: Readonly<Record<ClavePresupuesto, readonly string[]>> = {
  feed_p95_ms: ['feed_p95_ms'],
  feed_sql_p95_ms: ['feed_sql_p95_ms'],
  composer_p95_ms: ['composer_p95_ms'],
  hilo_p95_ms: ['hilo_p95_ms'],
  ratio_5xx: ['ratio_5xx'],
  crisis_sin_atender_max: ['crisis_sin_atender_max', 'crisis_sin_atender'],
  ia_gasto_diario_usd: ['ia_gasto_diario_usd', 'ia_gasto_diario'],
}

/**
 * Evalúa una instantánea contra los presupuestos.
 *
 * Una clave AUSENTE no es una violación: es un dato que no se ha medido. Tratar
 * "no medido" como "incumplido" produce alertas fantasma en cada arranque en
 * frío; tratarlo como "cumplido" es peor, porque hace desaparecer el problema.
 * Por eso simplemente no aparece — y quien quiera vigilar la ausencia del dato,
 * vigila `darma_latencia_ms_count`.
 */
export function evaluarPresupuestos(s: Record<string, number>): Violacion[] {
  const violaciones: Violacion[] = []

  for (const clave of Object.keys(PRESUPUESTOS) as ClavePresupuesto[]) {
    const limite = PRESUPUESTOS[clave]

    let valor: number | undefined
    for (const nombre of ALIAS[clave]) {
      const v = s[nombre]
      if (typeof v === 'number' && Number.isFinite(v)) {
        valor = v
        break
      }
    }
    if (valor === undefined) continue

    // Todos los presupuestos son techos: se incumple al SUPERARLOS. El valor
    // exactamente igual al límite cumple (mismo criterio que check_rate_limit,
    // donde la petición que hace justo el límite todavía pasa).
    if (valor > limite) {
      violaciones.push({ clave, valor, limite, severidad: SEVERIDADES[clave] })
    }
  }

  // Lo de crisis primero, siempre. Quien lea la lista por encima —o quien la
  // trunque a los 3 primeros elementos en una notificación— tiene que ver eso.
  return violaciones.sort((a, b) => Number(b.severidad === 'crisis') - Number(a.severidad === 'crisis'))
}

/** ¿Hay alguna violación que exija escalar por el canal de crisis? */
export function hayViolacionDeCrisis(violaciones: readonly Violacion[]): boolean {
  return violaciones.some((v) => v.severidad === 'crisis')
}
