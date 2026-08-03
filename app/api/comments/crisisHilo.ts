// ============================================================================
// Crisis en un comentario — CONTRATOS §9 aplica a TODO texto escrito por una
// persona, no solo a los posts.
//
// Suena contraintuitivo evaluar el riesgo de quien viene a CONSOLAR a otro, y
// es justo por eso que está aquí: el sitio donde alguien se atreve a escribir
// «yo también quiero desaparecer» es, muchas veces, un comentario en el
// desahogo de otra persona. Es más fácil decirlo acompañando que pidiendo.
//
// ── EL ORDEN NO ES NEGOCIABLE ──────────────────────────────────────────────
// 1. `evaluar()` corre ANTES de persistir nada (CONTRATOS §9). Es pura: sin
//    red, sin reloj, sin base de datos.
// 2. `registrar()` corre justo después del INSERT, cuando ya existe el uuid al
//    que apuntar. La evaluación y el registro están separados a propósito: el
//    registro necesita una referencia y la evaluación no puede esperar a ella.
// 3. Los recursos viajan en LA MISMA respuesta. No en un correo, no en la
//    pantalla siguiente.
// 4. El comentario NO se bloquea ni se oculta. Se prioriza, no se censura: la
//    persona debe seguir siendo escuchada.
//
// Y un fallo al registrar el evento NUNCA impide mostrar los recursos: si hay
// que elegir entre la trazabilidad y enseñarle un teléfono a alguien que acaba
// de decir que no puede más, se enseña el teléfono.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { assessCrisisRisk, crisisMessage, helpResourcesFor } from '@/lib/crisis'
import type { TarjetaRecursosDatos } from './tipos.ts'

/** Resultado de evaluar un texto. `tarjeta` null ⇒ no hay nada que hacer. */
export interface EvaluacionHilo {
  tarjeta: TarjetaRecursosDatos | null
}

/**
 * Evalúa el texto y prepara la tarjeta. PURA — se llama antes del INSERT.
 *
 * @param pais ISO-3166-1 alfa-2 del borde, o null. Las líneas de ayuda son
 *             nacionales; `helpResourcesFor(null)` nunca devuelve una lista
 *             vacía, porque una pantalla de crisis sin ningún recurso es un
 *             callejón sin salida.
 */
export function evaluar(texto: string, pais: string | null): EvaluacionHilo {
  const evaluacion = assessCrisisRisk(texto)
  if (!evaluacion.requiresIntervention) return { tarjeta: null }

  // `requiresIntervention` solo es cierto para 'high' y 'critical'; el cast
  // fija ese invariante en el tipo en vez de dejarlo implícito.
  const nivel = evaluacion.risk_level as 'high' | 'critical'

  return {
    tarjeta: {
      mensaje: crisisMessage(nivel),
      recursos: helpResourcesFor(pais),
      nivel,
    },
  }
}

/**
 * Registra el evento en `crisis_events`.
 *
 * @param admin cliente ADMIN. Es una de las tres excepciones del bloque:
 *              `crisis_events` tiene RLS activa y CERO políticas (mismo patrón
 *              deliberado que `identity_vault`), así que no existe cliente RLS
 *              capaz de escribir ahí.
 *
 * La tabla guarda QUÉ se mostró y en qué país, no solo que se detectó: es lo
 * que permite responder algún día «¿qué hizo el sistema cuando esta persona
 * dijo eso?».
 */
export async function registrar(
  admin: SupabaseClient,
  evaluacion: EvaluacionHilo,
  userId: string,
  comentarioId: string,
  pais: string | null,
): Promise<void> {
  if (!evaluacion.tarjeta) return

  const { error } = await admin.from('crisis_events').insert({
    user_id: userId,
    ref_type: 'comment',
    ref_id: comentarioId,
    risk: evaluacion.tarjeta.nivel,
    resources_shown: evaluacion.tarjeta.recursos.map((r) => r.name),
    country_code: pais,
  })

  if (error) {
    // Se registra y se sigue. Ver la cabecera: la tarjeta no depende de esto.
    console.error('[darma][b04] no se pudo registrar crisis_events', {
      comentario: comentarioId,
      code: error.code,
    })
  }
}
