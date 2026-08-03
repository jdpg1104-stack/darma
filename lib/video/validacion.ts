// ============================================================================
// B07 · Validación de entrada de las cuatro rutas de /api/content/*.
//
// Todo lo que llega del cliente pasa por aquí antes de tocar la base: el `id`
// de la ruta, el cursor, el límite, el idioma y el `sesionId` del cuerpo. Un
// uuid mal formado que llegase a Postgres devolvería `invalid input syntax for
// type uuid`, y ese mensaje —si se escapara— cuenta el tipo de la columna.
//
// Las funciones LANZAN `ErrorApi('entrada_invalida')` (422) en vez de devolver
// un resultado: un `if` olvidado en una de las cuatro rutas es una ruta sin
// validar, y aquí no hay ninguna razón para seguir adelante con una entrada
// inválida.
// ============================================================================

import { z } from 'zod'
import { ErrorApi } from '../auth/errores.ts'
import { decodificarCursor, type Cursor } from './cursor.ts'

const uuid = z.string().uuid()

/** Idioma base BCP-47 recortado, espejo del CHECK de `content_items.language`. */
const idioma = z.string().regex(/^[a-z]{2}$/)

/**
 * Página de 10, no de 20: cada tarjeta puede llegar a montar un iframe, y el
 * presupuesto de CONTRATOS §11 son 120 KB por ruta. El máximo de 20 es el techo
 * duro que también aplica la función SQL.
 */
export const LIMITE_FEED_DEFECTO = 10
export const LIMITE_FEED_MAXIMO = 20

const esquemaFeed = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_FEED_MAXIMO).optional(),
  idioma: idioma.optional(),
})

const esquemaCuerpoSesion = z.object({
  sesionId: uuid,
})

export interface ParametrosFeed {
  cursor: Cursor | null
  limite: number
  idioma: string
}

/** Valida `?cursor=&limite=&idioma=`. */
export function validarParametrosFeed(url: URL): ParametrosFeed {
  const bruto = esquemaFeed.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limite: url.searchParams.get('limite') ?? undefined,
    idioma: url.searchParams.get('idioma') ?? undefined,
  })

  if (!bruto.success) throw new ErrorApi('entrada_invalida')

  let cursor: Cursor | null = null
  if (bruto.data.cursor) {
    cursor = decodificarCursor(bruto.data.cursor)
    // Cursor corrupto → 422, NUNCA "vuelve a la primera página": ese silencio
    // convierte un scroll roto en un bucle infinito de la misma página.
    if (!cursor) throw new ErrorApi('entrada_invalida')
  }

  return {
    cursor,
    limite: bruto.data.limite ?? LIMITE_FEED_DEFECTO,
    // Idioma por defecto 'es' hasta que B01/B17 expongan el de la persona
    // (anotado en PEDIDOS.md).
    idioma: bruto.data.idioma ?? 'es',
  }
}

/** Valida el `[id]` del segmento dinámico. */
export function validarIdContenido(valor: string): string {
  const salida = uuid.safeParse(valor)
  if (!salida.success) throw new ErrorApi('entrada_invalida')
  return salida.data
}

/**
 * Lee y valida el cuerpo JSON.
 *
 * Un cuerpo ausente o mal formado es 422, no 500: `request.json()` lanza un
 * `SyntaxError` cuyo mensaje trae un fragmento de lo enviado.
 */
export async function leerCuerpo(peticion: Request): Promise<unknown> {
  try {
    return await peticion.json()
  } catch {
    throw new ErrorApi('entrada_invalida')
  }
}

/** Valida `{ sesionId }`. */
export function validarSesionId(cuerpo: unknown): string {
  const salida = esquemaCuerpoSesion.safeParse(cuerpo)
  if (!salida.success) throw new ErrorApi('entrada_invalida')
  return salida.data.sesionId
}
