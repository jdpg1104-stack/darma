// ============================================================================
// B11 · Salida estructurada del clasificador
//
// Nada de parsear prosa. El modelo devuelve JSON conforme a un esquema que la
// API hace cumplir (`output_config.format` con `type: 'json_schema'`), y aquí
// se vuelve a validar con zod antes de creerse una sola palabra.
//
// ── POR QUÉ SE VALIDA DOS VECES ────────────────────────────────────────────
// Porque la salida estructurada garantiza la FORMA, no la disponibilidad: si
// el modelo declina (`stop_reason: 'refusal'`), si la respuesta se corta por
// `max_tokens`, o si algún día se cambia de proveedor, lo que llega aquí no
// tiene por qué cumplir nada. La validación local es la que convierte "llegó
// algo raro" en `indeterminado` en vez de en una excepción a mitad de una
// petición de alguien que estaba pidiendo ayuda.
//
// ── LÍMITES DEL ESQUEMA (requisitos de la API) ─────────────────────────────
//   · Todo objeto lleva `additionalProperties: false` y `required` COMPLETO.
//   · Nada de esquemas recursivos.
//   · Nada de `minLength` / `maximum` / `minimum`: no están soportados. Los
//     rangos se comprueban aquí, en zod, no en el esquema que viaja a la API.
// ============================================================================

import { z } from 'zod'

/** Espejo exacto de `public.risk_level`. Ordenado de menor a mayor gravedad. */
export type NivelRiesgo = 'none' | 'low' | 'high' | 'critical'

/**
 * Veredicto de calidad.
 *
 * `indeterminado` NO es un valor que el modelo pueda devolver: es nuestro, y
 * significa "no hay veredicto". Se usa para todo fallo de infraestructura. Que
 * viva fuera del enum del esquema es deliberado — así el modelo no puede
 * "elegir" no mojarse, y nosotros no podemos confundir una degradación con una
 * respuesta.
 */
export type VeredictoCalidad = 'valido' | 'relleno' | 'toxico' | 'indeterminado'

export interface ResultadoClasificacion {
  calidad: VeredictoCalidad
  /** 0–1. `null` cuando el veredicto es 'indeterminado'. */
  puntuacion: number | null
  riesgo: NivelRiesgo
  /** Frase breve en español. NUNCA cita el texto del usuario. */
  motivo: string
  /** true cuando el resultado viene de degradación, no de una respuesta real. */
  degradado: boolean
}

// ── Esquema que viaja a la API ──────────────────────────────────────────────

/**
 * JSON Schema literal. Escrito a mano y no derivado de zod a propósito: el
 * helper `zodOutputFormat` de `@anthropic-ai/sdk/helpers/zod` genera esquemas
 * con claves que la API rechaza si el zod lleva `.min()`/`.max()`, y aquí el
 * esquema es corto y estable. Cuando el SDK esté instalado (ver PEDIDOS.md) se
 * puede sustituir por `zodOutputFormat(EsquemaVeredicto)` + `messages.parse()`;
 * `interpretarVeredicto` seguiría siendo la última palabra igualmente.
 */
export const JSON_SCHEMA_VEREDICTO = Object.freeze({
  type: 'object',
  properties: {
    calidad: {
      type: 'string',
      enum: ['valido', 'relleno', 'toxico'],
      description:
        'valido = escucha real; relleno = frase hecha sin contenido propio; toxico = ataque, burla, desprecio o incitación.',
    },
    puntuacion: {
      type: 'number',
      description: 'Confianza de 0 a 1 en el veredicto de calidad.',
    },
    riesgo: {
      type: 'string',
      enum: ['none', 'low', 'high', 'critical'],
      description:
        'Riesgo de ideación suicida o autolesión EN QUIEN ESCRIBE. Ante la duda, sube.',
    },
    motivo: {
      type: 'string',
      description:
        'Una frase breve en español explicando el veredicto. Prohibido citar o parafrasear el texto.',
    },
  },
  required: ['calidad', 'puntuacion', 'riesgo', 'motivo'],
  additionalProperties: false,
} as const)

/** Bloque `output_config.format` completo, listo para la petición. */
export const FORMATO_SALIDA = Object.freeze({
  type: 'json_schema',
  name: 'veredicto_moderacion',
  schema: JSON_SCHEMA_VEREDICTO,
} as const)

// ── Validación local ────────────────────────────────────────────────────────

/**
 * `catchall(z.never())` es el equivalente en zod de `additionalProperties:
 * false`: una clave de más hace fallar el parseo en vez de colarse ignorada.
 * Un campo inesperado en una respuesta de moderación significa que el
 * proveedor cambió algo, y eso merece degradar, no seguir como si nada.
 */
export const EsquemaVeredicto = z
  .object({
    calidad: z.enum(['valido', 'relleno', 'toxico']),
    puntuacion: z.number().min(0).max(1),
    riesgo: z.enum(['none', 'low', 'high', 'critical']),
    motivo: z.string().min(1).max(300),
  })
  .strict()

export type VeredictoBruto = z.infer<typeof EsquemaVeredicto>

// ── Constructores del resultado ─────────────────────────────────────────────

/**
 * Resultado de degradación. NUNCA `valido`, NUNCA riesgo por debajo del suelo
 * que se le pase.
 *
 * `riesgoSuelo` es lo que dijeron las reglas de `lib/crisis.ts`. Que sea un
 * parámetro y no `'none'` fijo es el punto entero: cuando el proveedor falla,
 * el riesgo NO baja.
 */
export function indeterminado(motivo: string, riesgoSuelo: NivelRiesgo = 'none'): ResultadoClasificacion {
  return {
    calidad: 'indeterminado',
    puntuacion: null,
    riesgo: riesgoSuelo,
    motivo,
    degradado: true,
  }
}
