// ============================================================================
// La pregunta de una encuesta es texto escrito por una persona.
//
// CONTRATOS §9 no hace excepciones por formato: todo texto humano pasa por la
// evaluación de crisis ANTES de persistirse. Una pregunta puede ser una llamada
// de auxilio con forma de sondeo —«¿alguien más ha pensado en no estar?»— y
// saltársela «porque es solo una encuesta» es exactamente la trampa nº 5 de la
// ficha B09.
//
// Se evalúa la pregunta Y las opciones juntas: el riesgo puede estar en una
// opción («ya lo he intentado») aunque la pregunta parezca inocua. Se unen con
// saltos de línea y no con espacios para que los patrones no crucen la frontera
// entre dos textos y produzcan una coincidencia que nadie escribió.
//
// ⚠️ NOMBRE: la ficha B09 llama a este helper `evaluarRiesgo()`. La función que
// existe de verdad en `lib/crisis.ts` (dueño F3) se llama `assessCrisisRisk()`.
// No se renombra nada de F3: se consume la real y se anota en PEDIDOS.md.
//
// ⚠️ ALCANCE: el contrato de B09 no incluye ninguna ruta de creación de
// encuestas (las cinco están en la ficha y ninguna es un POST /api/polls). Este
// módulo existe para que quien la cree —el composer de B03, o B09 cuando se le
// añada la ruta— no tenga que reinventar la regla. La defensa que SÍ está viva
// hoy es de esquema: `authenticated` no puede escribir `polls.origin`, así que
// toda encuesta creada por una persona nace con `origin = 'usuario'` y es
// distinguible en la cola de moderación.
// ============================================================================

import { assessCrisisRisk, crisisMessage, helpResourcesFor, type CrisisAssessment, type HelpResource } from '../crisis.ts'

export interface RiesgoEncuesta {
  evaluacion: CrisisAssessment
  /** ¿Hay que enseñar recursos de ayuda EN ESTA MISMA respuesta? */
  requiereIntervencion: boolean
  /** Vacío salvo que `requiereIntervencion` sea true. */
  recursos: readonly HelpResource[]
  /** Texto para la persona. Nunca «hemos detectado que…». */
  mensaje: string | null
}

/**
 * Evalúa el texto libre de una encuesta.
 *
 * PURA: sin red y sin reloj, igual que `assessCrisisRisk`. La encuesta NO se
 * borra ni se oculta por el resultado — se prioriza (CONTRATOS §9.2). Lo único
 * que cambia es que se escribe en `crisis_events` y que quien preguntó ve los
 * recursos antes de irse de la pantalla.
 */
export function evaluarRiesgoEncuesta(
  pregunta: string,
  opciones: readonly string[] = [],
  pais?: string | null,
): RiesgoEncuesta {
  const evaluacion = assessCrisisRisk([pregunta, ...opciones].join('\n'))
  const requiereIntervencion = evaluacion.requiresIntervention

  return {
    evaluacion,
    requiereIntervencion,
    recursos: requiereIntervencion ? helpResourcesFor(pais) : [],
    mensaje: requiereIntervencion ? crisisMessage(evaluacion.risk_level) : null,
  }
}
