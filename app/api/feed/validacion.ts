// ============================================================================
// Validación de la query string del feed
//
// Tres reglas, y las tres tienen una razón de seguridad, no de higiene:
//
//  1. `limite` es un entero de 1 a 50 y se RECHAZA fuera de rango, no se
//     recorta. Recortar en silencio enmascara un cliente roto: alguien pide 500,
//     recibe 20 y cree que solo hay 20 elementos en todo el feed. Un
//     `entrada_invalida` se arregla; un recorte silencioso se convive con él
//     durante meses.
//  2. `cursor` no pasa de 256 caracteres. Un cursor de 4 KB pegado cien veces es
//     el DoS más barato que tiene una ruta de lectura: cada uno se decodifica en
//     base64 antes de que nadie mire si tiene sentido.
//  3. `carril` es un enum CERRADO. Cada carril es un índice que alguien tuvo que
//     crear; aceptar un valor arbitrario del cliente sería aceptar un seq scan a
//     petición.
// ============================================================================

import { z } from 'zod'

import { ErrorApi } from '../../../lib/auth/errores.ts'
import { CARRILES, type Carril } from './tipos.ts'

/** Tamaño de página por defecto. Coincide con el esqueleto de `loading.tsx`. */
export const LIMITE_POR_DEFECTO = 20
export const LIMITE_MAXIMO = 50
export const CURSOR_MAX_CARACTERES = 256

const esquema = z.object({
  cursor: z.string().max(CURSOR_MAX_CARACTERES).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_POR_DEFECTO),
  carril: z.enum(['para_ti', 'nuevo']).default('para_ti'),
})

export interface ParametrosFeed {
  cursor: string | null
  limite: number
  carril: Carril
}

/**
 * Parsea y valida. Lanza `entrada_invalida` (422) con el mensaje genérico del
 * contrato: el detalle de zod se queda dentro, porque describe la forma exacta
 * de la validación y eso es información sobre el sistema.
 */
export function parsearParametros(params: URLSearchParams): ParametrosFeed {
  const resultado = esquema.safeParse({
    cursor: params.get('cursor') ?? undefined,
    limite: params.get('limite') ?? undefined,
    carril: params.get('carril') ?? undefined,
  })

  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }

  return {
    cursor: resultado.data.cursor ?? null,
    limite: resultado.data.limite,
    carril: resultado.data.carril,
  }
}

/** ¿Es un carril válido? Para los enlaces del selector, que no pasan por zod. */
export function esCarril(valor: string | null | undefined): valor is Carril {
  return valor != null && (CARRILES as readonly string[]).includes(valor)
}

/**
 * Idioma del contenido curado a partir de `Accept-Language`.
 *
 * Se recorta al idioma BASE ('es', 'en') porque `content_items.language` guarda
 * BCP-47 recortado: una variante regional partiría el catálogo en dos sin ganar
 * nada. Cualquier cosa que no reconozcamos cae en 'es', que es el idioma con
 * catálogo real; devolver 'fr' vaciaría el carril de contenido en silencio.
 *
 * ⚠️ Provisional: el idioma DEBE salir de la preferencia guardada de la persona
 * en cuanto exista (B17 / B01), no de una cabecera del navegador. Anotado en
 * HANDOFF/PEDIDOS.md.
 */
export function idiomaDeContenido(cabecera: string | null | undefined): 'es' | 'en' {
  if (!cabecera) return 'es'
  const primero = cabecera.split(',')[0]?.trim().slice(0, 2).toLowerCase()
  return primero === 'en' ? 'en' : 'es'
}
