// ============================================================================
// B13 · Esquemas de entrada de las rutas de push
//
// Viven en `lib/push` y no junto a las rutas por una razón práctica: las
// pruebas se ejecutan con `node --test`, que NO resuelve el alias `@/` del
// tsconfig. Un esquema que solo se pueda probar arrancando Next no se prueba, y
// estos son justo los que no pueden fallar. `app/api/push/validacion.ts` los
// reexporta y añade los helpers que sí dependen de `ErrorApi`.
//
// ── `.strict()` EN LOS TRES, Y NO ES PULCRITUD ────────────────────────────
// Si `subscribe` aceptara un `userId` en el cuerpo, cualquiera podría suscribir
// SU dispositivo a los avisos de OTRA persona — que en Darma es enterarse de
// cuándo alguien marca «necesito hablar». Con `.strip()` (el modo por defecto
// de zod) la clave se descartaría en silencio y volvería a estar viva el día
// que alguien escribiera `insert({ ...body })`. Con `.strict()` la petición se
// rechaza entera y el fallo se ve en el primer intento.
// ============================================================================

import { z } from 'zod'
import { endpointValido, LONGITUD_MAXIMA_ENDPOINT } from './endpoint.ts'
import { TIPOS_NOTIFICACION } from './preferencias.ts'

/**
 * Endpoint de un servicio de push conocido.
 *
 * No se usa `z.string().url()`: eso acepta `http://169.254.169.254/` y
 * `https://interno.local/`, que son exactamente los dos casos que convierten
 * esta ruta en un proxy de peticiones salientes. Ver `endpoint.ts`.
 */
const esquemaEndpoint = z
  .string()
  .max(LONGITUD_MAXIMA_ENDPOINT)
  .refine(endpointValido, { message: 'endpoint no admitido' })

/**
 * Claves del navegador, en base64url.
 *
 * No se intenta validarlas criptográficamente: se comprueba el alfabeto y una
 * longitud plausible, que es lo que impide que la tabla guarde texto
 * arbitrario. `p256dh` es un punto P-256 sin comprimir (65 bytes → ~87
 * caracteres) y `auth` son 16 bytes (~22).
 */
const base64url = /^[A-Za-z0-9_-]+=*$/

export const esquemaSuscribir = z
  .object({
    endpoint: esquemaEndpoint,
    keys: z
      .object({
        p256dh: z.string().min(60).max(200).regex(base64url),
        auth: z.string().min(16).max(64).regex(base64url),
      })
      .strict(),
  })
  .strict()

export const esquemaDesuscribir = z.object({ endpoint: esquemaEndpoint }).strict()

/**
 * `PATCH /api/push/prefs`. Todo opcional: la pantalla manda solo lo que cambió.
 *
 * Los tipos se derivan de `TIPOS_NOTIFICACION` para que añadir uno no exija
 * tocar dos sitios, y para que un tipo inventado por el cliente no llegue nunca
 * al `jsonb`.
 */
export const esquemaPrefs = z
  .object({
    ...Object.fromEntries(TIPOS_NOTIFICACION.map((tipo) => [tipo, z.boolean().optional()])),
    revelar_alias: z.boolean().optional(),
    /** Minutos desde medianoche local. `null` = volver al silencio por defecto. */
    quietFrom: z.number().int().min(0).max(1439).nullable().optional(),
    quietTo: z.number().int().min(0).max(1439).nullable().optional(),
    /** Solo el desfase, nunca la zona con nombre: 'Europe/Madrid' identifica la
     *  ciudad, y en una red anónima eso es un dato de más. */
    tzOffset: z.number().int().min(-840).max(840).optional(),
  })
  .strict()

export type EntradaSuscribir = z.infer<typeof esquemaSuscribir>
export type EntradaPrefs = z.infer<typeof esquemaPrefs>
