// ============================================================================
// Validación de entrada de las tres rutas de escritura de B04
//
// `.strict()` en las tres, sin excepción. La razón no es la pulcritud: es que
// `author_id` NUNCA puede venir del cuerpo (CONTRATOS §6 — «aceptar un authorId
// del cliente es la vulnerabilidad más común de este tipo de app»). Con
// `.strip()` —el modo por defecto de zod— una clave de más se descarta en
// silencio, y el día que alguien haga un `insert({ ...body })` la clave vuelve
// a estar ahí. Con `.strict()` la petición se rechaza y el error se ve en el
// primer intento.
//
// Los límites de longitud son los del `CHECK` de `comments.body` (40..4000) a
// propósito: dejarlos pasar aquí solo produciría un error de Postgres más
// adelante, con el nombre de la restricción dentro.
// ============================================================================

import { z } from 'zod'
import { ErrorApi } from '@/lib/auth/errores'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '@/lib/moderation'

/** Límite máximo de página. CONTRATOS §5. */
export const LIMITE_MAXIMO = 50
export const LIMITE_POR_DEFECTO = 20

export const esquemaCrearComentario = z
  .object({
    postId: z.string().uuid(),
    body: z.string().min(MIN_COMMENT_LENGTH).max(MAX_COMMENT_LENGTH),
  })
  .strict()

export const esquemaEditarComentario = z
  .object({
    body: z.string().min(MIN_COMMENT_LENGTH).max(MAX_COMMENT_LENGTH),
  })
  .strict()

export const esquemaUuid = z.string().uuid()

/**
 * Parámetros de `GET /api/comments`.
 *
 * El cursor NO se valida aquí: uno corrupto no es una entrada inválida, es una
 * primera página (ver `cursor.ts`). Por eso entra como `string` suelto y lo
 * interpreta `decodificarCursor`.
 */
export const esquemaListado = z
  .object({
    postId: z.string().uuid(),
    cursor: z.string().optional(),
    limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_POR_DEFECTO),
  })
  .strict()

/**
 * Aplica un esquema y convierte el fallo en `entrada_invalida`.
 *
 * El detalle de zod NO viaja al cliente: sus mensajes citan la ruta del campo y
 * a veces el valor recibido, y el valor recibido aquí es el texto que alguien
 * acaba de escribir sobre lo que le pasa.
 */
export function validar<E extends z.ZodTypeAny>(esquema: E, entrada: unknown): z.infer<E> {
  const resultado = esquema.safeParse(entrada)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/** Cuerpo JSON de una petición, o `entrada_invalida` si no es JSON. */
export async function leerJson(peticion: Request): Promise<unknown> {
  try {
    return await peticion.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}

/** Query string → objeto plano, para pasárselo a `esquemaListado`. */
export function parametros(peticion: Request): Record<string, string> {
  const url = new URL(peticion.url)
  const salida: Record<string, string> = {}
  for (const [clave, valor] of url.searchParams) salida[clave] = valor
  return salida
}
