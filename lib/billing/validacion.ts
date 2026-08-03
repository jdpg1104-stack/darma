// ============================================================================
// Validación de entrada de /api/billing/*
//
// ── LA REGLA DE SEGURIDAD DE ESTE ARCHIVO ───────────────────────────────────
// **Ningún esquema acepta una cantidad.** Ni `amount`, ni `crystals`, ni
// `price`, ni `delta`. El cliente manda un identificador de producto o un tipo
// de regalo; la cantidad la resuelve el servidor contra `catalogo.ts` y
// `regalos.ts`. Todos los esquemas son `.strict()`, así que un `crystals:
// 999999` colado en el body no se ignora en silencio: se rechaza con 422.
// Ignorarlo también sería correcto, pero rechazarlo convierte el intento en una
// señal visible en el log en vez de en un no-evento.
//
// El detalle de zod NUNCA sale al cliente: describe la forma exacta de la
// validación, y eso es información sobre el sistema. Se queda en la `causa`.
// ============================================================================

import { z } from 'zod'

import { ErrorApi } from '../auth/errores.ts'
import { esSkuCristales } from './catalogo.ts'
import { MEDIOS_PAGO } from './boosts.ts'
import { TIPOS_REGALO } from './regalos.ts'
import { IDEMPOTENCIA_MAX, LIMITE_PAGINA_MAX, LIMITE_PAGINA_POR_DEFECTO, MENSAJE_REGALO_MAX } from './limites.ts'

const uuid = z.string().uuid()

const idempotencia = z.string().min(1).max(IDEMPOTENCIA_MAX).optional()

/**
 * `POST /api/billing/verify`.
 *
 * `token` es el `transactionId` de Apple o `productId|purchaseToken` de Google.
 * No se valida su forma interna aquí más allá de la longitud: quien decide si
 * vale es la tienda, y adelantarnos con una expresión regular solo consigue
 * rechazar formatos nuevos el día que cambien.
 */
export const esquemaVerificar = z
  .object({
    plataforma: z.enum(['apple', 'google']),
    token: z.string().min(1).max(4096),
  })
  .strict()

export const esquemaRestaurar = z
  .object({
    plataforma: z.enum(['apple', 'google']),
    /** Apple: `originalTransactionId`. Google: lista de `productId|purchaseToken`. */
    referencia: z.string().min(1).max(4096),
  })
  .strict()

export const esquemaBoost = z
  .object({
    postId: uuid,
    // `z.enum` sobre la tupla de `boosts.ts`: el tipo y la validación salen del
    // mismo sitio, así que no pueden separarse.
    medioPreferido: z.enum(MEDIOS_PAGO).optional(),
    idempotencia,
  })
  .strict()

export const esquemaRegalo = z
  .object({
    recipientId: uuid,
    giftKind: z.enum(TIPOS_REGALO),
    refType: z.enum(['post', 'comment', 'refuge']).optional(),
    refId: uuid.optional(),
    mensaje: z.string().trim().min(1).max(MENSAJE_REGALO_MAX).optional(),
    idempotencia,
  })
  .strict()
  // `refId` sin `refType` deja una referencia colgando que nadie sabe resolver,
  // y `refType` sin `refId` es un contexto vacío. O las dos o ninguna.
  .refine((v) => (v.refId == null) === (v.refType == null), { message: 'ref incompleta' })

export const esquemaPagina = z
  .object({
    cursor: z.string().max(256).optional(),
    limite: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(LIMITE_PAGINA_MAX))
      .optional(),
  })
  .strict()

/**
 * Parseo con traducción a `ErrorApi`. Un cuerpo inválido es un 422, no un 500,
 * y el `issues` de zod se queda en la causa.
 */
export function parsear<T extends z.ZodTypeAny>(esquema: T, valor: unknown): z.infer<T> {
  const resultado = esquema.safeParse(valor)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}

/** `?cursor&limite` de una URL, ya validados. */
export function parsearPagina(url: URL): { cursor: string | null; limite: number } {
  const crudo: Record<string, string> = {}
  const cursor = url.searchParams.get('cursor')
  const limite = url.searchParams.get('limite')
  if (cursor !== null) crudo.cursor = cursor
  if (limite !== null) crudo.limite = limite

  const datos = parsear(esquemaPagina, crudo)
  return { cursor: datos.cursor ?? null, limite: datos.limite ?? LIMITE_PAGINA_POR_DEFECTO }
}

/** Guarda para el SKU en las respuestas de la tienda. Reexportada por comodidad. */
export { esSkuCristales }
