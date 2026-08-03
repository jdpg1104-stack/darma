// ============================================================================
// B11 · Riesgo — la SEGUNDA opinión sobre lib/crisis.ts
//
// ── POR QUÉ ESTE ARCHIVO NO HACE OTRA LLAMADA ──────────────────────────────
// Porque el riesgo ya viene en la misma respuesta que la calidad (un esquema,
// dos campos). Pedirlo aparte duplicaría coste y latencia sin ganar precisión.
// Lo que este módulo aporta es la PARTE PURA: cómo se combina la opinión del
// modelo con el suelo de las reglas, y qué se hace cuando no hay opinión.
//
// ── LA REGLA DE ORO, OTRA VEZ ──────────────────────────────────────────────
// El clasificador solo puede SUBIR el riesgo. Nunca bajarlo. `lib/crisis.ts`
// lo dice en su cabecera y aquí se hace cumplir: la única operación permitida
// sobre un `risk_level` es `escalate()`, que es un máximo. No existe —ni debe
// escribirse— una función que baje un riesgo sin intervención humana.
// ============================================================================

import { escalate, requiresIntervention, type RiskLevel } from '../crisis.ts'
import { EsquemaVeredicto, type NivelRiesgo } from './esquemas.ts'
import {
  clasificarDetallado,
  escalarPorIncertidumbre,
  type ClasificacionDetallada,
  type DepsClasificador,
} from './clasificarComentario.ts'

export interface VeredictoRiesgo {
  riesgo: NivelRiesgo
  /** true cuando hay que enseñar la tarjeta y mandar a la cola humana. */
  exigeIntervencion: boolean
  /** true cuando el nivel sale de una degradación, no de una opinión real. */
  degradado: boolean
}

/**
 * Combina un veredicto crudo con el suelo de las reglas. PURA.
 *
 * Si el crudo no es interpretable, el riesgo NO se queda en el suelo: sube
 * (ver `escalarPorIncertidumbre`). No saber es peor que saber que no hay nada.
 */
export function interpretarRiesgo(bruto: unknown, riesgoSuelo: NivelRiesgo = 'none'): VeredictoRiesgo {
  let candidato: unknown = bruto
  if (typeof candidato === 'string') {
    try {
      candidato = JSON.parse(candidato)
    } catch {
      candidato = undefined
    }
  }

  const analisis = EsquemaVeredicto.safeParse(candidato)
  if (!analisis.success) {
    const riesgo = escalarPorIncertidumbre(riesgoSuelo)
    return { riesgo, exigeIntervencion: requiresIntervention(riesgo as RiskLevel), degradado: true }
  }

  const riesgo = escalate(riesgoSuelo as RiskLevel, analisis.data.riesgo as RiskLevel) as NivelRiesgo
  return { riesgo, exigeIntervencion: requiresIntervention(riesgo as RiskLevel), degradado: false }
}

/**
 * Riesgo final de un texto. NUNCA lanza.
 *
 * Existe para los bloques que solo necesitan el riesgo (B10, refugios) y no el
 * veredicto de calidad. Internamente es la misma llamada: si ya tienes una
 * `ClasificacionDetallada`, no llames a esto — usa su `resultado.riesgo`.
 */
export async function clasificarRiesgo(
  texto: string,
  deps: DepsClasificador = {},
): Promise<VeredictoRiesgo> {
  const detalle: ClasificacionDetallada = await clasificarDetallado(texto, deps)
  const riesgo = detalle.resultado.riesgo
  return {
    riesgo,
    exigeIntervencion: requiresIntervention(riesgo as RiskLevel),
    degradado: detalle.resultado.degradado,
  }
}
