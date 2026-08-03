// ============================================================================
// B13 · Helpers de validación de las rutas de push
//
// Los ESQUEMAS viven en `lib/push/esquemas.ts` y aquí solo se reexportan. No es
// un rodeo: `node --test` no resuelve el alias `@/`, así que un esquema
// declarado en este archivo sería imposible de probar sin arrancar Next — y los
// dos casos que más importan de todo el bloque (un endpoint interno, un
// `userId` colado en el cuerpo) son precisamente de esquema.
// ============================================================================

import type { z } from 'zod'
import { ErrorApi } from '@/lib/auth/errores'

export {
  esquemaSuscribir,
  esquemaDesuscribir,
  esquemaPrefs,
} from '@/lib/push/esquemas'
export type { EntradaSuscribir, EntradaPrefs } from '@/lib/push/esquemas'

/**
 * Aplica un esquema y convierte el fallo en `entrada_invalida`.
 *
 * El detalle de zod NO viaja al cliente: sus mensajes citan el valor recibido, y
 * aquí el valor recibido es un endpoint de push, que es una capability URL.
 */
export function validar<E extends z.ZodTypeAny>(esquema: E, entrada: unknown): z.infer<E> {
  const resultado = esquema.safeParse(entrada)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/** Cuerpo JSON, o `entrada_invalida` si no lo es. */
export async function leerJson(peticion: Request): Promise<unknown> {
  try {
    return await peticion.json()
  } catch (causa) {
    throw new ErrorApi('entrada_invalida', { causa })
  }
}
