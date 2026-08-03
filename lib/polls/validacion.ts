// ============================================================================
// Validación de entrada de las rutas de encuestas.
//
// Todos los límites se IMPORTAN de `limites.ts`; ninguno se teclea aquí. Un
// número repetido entre el CHECK de Postgres, el zod del servidor y el contador
// de la tarjeta es un número que se actualizará en dos de los tres sitios.
//
// Tres decisiones que son de seguridad y no de higiene:
//
//  1. Los ids son `uuid` estrictos. Sin eso, un `poll_id` arbitrario viaja hasta
//     Postgres y vuelve como `22P02 invalid input syntax for type uuid` — un
//     error del motor que hay que redactar en el camino de vuelta. Es más barato
//     y más honesto pararlo aquí con un 422.
//  2. `posicion` se RECHAZA fuera de rango, no se recorta. Recortar en silencio
//     enmascara un cliente roto durante meses.
//  3. El detalle de zod NUNCA sale al cliente: describe la forma exacta de la
//     validación, y eso es información sobre el sistema. Se queda en la `causa`,
//     que solo va al log.
// ============================================================================

import { z } from 'zod'

import { ErrorApi } from '../auth/errores.ts'
import {
  OPCIONES_MAX,
  OPCIONES_MIN,
  OPCION_MAX,
  OPCION_MIN,
  POSICION_MAX,
  PREGUNTA_MAX,
  PREGUNTA_MIN,
} from './limites.ts'

const uuid = z.string().uuid()

// `z.coerce.number()` NO sirve aquí: convierte la cadena vacía en 0 y `'1.5'`
// en 1.5 sin quejarse, así que `?posicion=` pasaría la validación. Se exige la
// forma antes de convertir.
const esquemaSiguiente = z.object({
  posicion: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(POSICION_MAX)),
})

const esquemaVoto = z.object({
  opcionId: uuid,
})

/**
 * Forma de una encuesta creada por una persona.
 *
 * B09 no expone hoy ninguna ruta de creación (las cinco del contrato no la
 * incluyen), pero el esquema vive aquí para que quien la añada —o el composer
 * de B03— no vuelva a teclear los límites. Es el mismo motivo por el que existe
 * `riesgo.ts`.
 */
export const esquemaEncuestaNueva = z.object({
  pregunta: z.string().trim().min(PREGUNTA_MIN).max(PREGUNTA_MAX),
  opciones: z
    .array(z.string().trim().min(OPCION_MIN).max(OPCION_MAX))
    .min(OPCIONES_MIN)
    .max(OPCIONES_MAX),
})

export interface ParametrosSiguiente {
  posicion: number
}

export function parsearSiguiente(params: URLSearchParams): ParametrosSiguiente {
  const crudo = params.get('posicion')
  // `?posicion=` (presente y vacío) NO es lo mismo que ausente: `z.coerce`
  // convierte la cadena vacía en 0 y lo daría por bueno. Un parámetro vacío es
  // un cliente que está construyendo mal la URL, y enterarse en el 422 es
  // barato; enterarse dentro de seis meses porque las encuestas «salen raro»,
  // no.
  const resultado = esquemaSiguiente.safeParse({ posicion: crudo === null ? '0' : crudo })
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/** Valida el `id` de la ruta dinámica. Lo mismo vale para las tres rutas `[id]`. */
export function parsearIdEncuesta(valor: string | undefined): string {
  const resultado = uuid.safeParse(valor)
  if (!resultado.success) {
    // 422 y no 404: un id con forma inválida es una petición mal formada, y
    // devolver 404 haría creer que la encuesta existió alguna vez.
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/**
 * Valida el cuerpo del voto.
 *
 * El body llega como `unknown` desde `request.json()`, que además puede lanzar
 * con un cuerpo vacío o no-JSON: por eso quien llama pasa el valor ya parseado
 * dentro de un try, y aquí solo se comprueba la forma.
 */
export function parsearVoto(cuerpo: unknown): { opcionId: string } {
  const resultado = esquemaVoto.safeParse(cuerpo)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/**
 * Idioma del pool de encuestas a partir de `Accept-Language`.
 *
 * Se recorta al idioma BASE porque `polls.language` guarda dos letras
 * (`check (language ~ '^[a-z]{2}$')`); una variante regional partiría el pool en
 * dos sin ganar nada. Lo desconocido cae en 'es', que es el idioma con banco
 * real: devolver 'fr' vaciaría el carril en silencio.
 *
 * ⚠️ Provisional, igual que en B02: el idioma DEBE salir de la preferencia
 * guardada de la persona en cuanto exista (B17 / B01). Anotado en PEDIDOS.md.
 */
export function idiomaDeEncuestas(cabecera: string | null | undefined): 'es' | 'en' {
  if (!cabecera) return 'es'
  const primero = cabecera.split(',')[0]?.trim().slice(0, 2).toLowerCase()
  return primero === 'en' ? 'en' : 'es'
}
