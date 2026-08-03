// ============================================================================
// Validación de B05 con zod
//
// REGLA: los patrones son IDÉNTICOS a los CHECK de `public.profiles` en
// 0001_core.sql. No parecidos — idénticos. Si zod acepta algo que el CHECK
// rechaza, la persona recibe un 500 del constraint en vez de "ese alias no
// vale"; si zod rechaza algo que el CHECK acepta, hay campos que la base
// permite y la app no, y nadie sabe cuál de los dos manda.
//
//   alias  · char_length between 3 and 24 · ~ '^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$'
//   bio    · char_length <= 280
//   availability in ('disponible','necesito_hablar','ausente')
//
// La validación NO es la seguridad. La seguridad es el `grant update (alias,
// avatar_seed, bio, availability)` de 0001: aunque este archivo dejara pasar un
// `karma_reputation`, Postgres no lo escribiría. Esto es para que el mensaje de
// error sea humano, no para que la regla se cumpla.
// ============================================================================

import { z } from 'zod'

/** Copia literal del CHECK de `profiles.alias`. */
export const RE_ALIAS = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]{3,24}$/

/** `avatar_seed` es `encode(gen_random_bytes(8),'hex')` = 16 hex. Se aceptan
 *  hasta 32 porque `deriveAvatarSeed` de lib/anonymity.ts produce 16 y el
 *  formato podría crecer; menos de 8 sería una semilla adivinable a mano. */
export const RE_SEMILLA_AVATAR = /^[0-9a-f]{8,32}$/

export const esquemaAlias = z
  .string()
  .trim()
  .regex(RE_ALIAS, 'El alias necesita entre 3 y 24 letras, números, guiones bajos o espacios.')

export const esquemaBio = z
  .string()
  .trim()
  .max(280, 'La biografía no puede pasar de 280 caracteres.')

export const esquemaSemillaAvatar = z.string().regex(RE_SEMILLA_AVATAR)

export const esquemaDisponibilidad = z.enum(['disponible', 'necesito_hablar', 'ausente'])

/**
 * Entrada de la Server Action de edición.
 *
 * `.strict()` a propósito: una clave desconocida es un ERROR, no algo que se
 * ignora en silencio. Si mañana alguien envía `{ crystals: 9999 }` desde el
 * formulario, quiero enterarme en la validación y no descubrirlo el día que un
 * `grant` cambie y el campo empiece a escribirse de verdad. Es la diferencia
 * entre "no funciona" y "no funciona todavía".
 */
export const esquemaEditarPerfil = z
  .object({
    alias: esquemaAlias.optional(),
    avatarSeed: esquemaSemillaAvatar.optional(),
    bio: esquemaBio.optional(),
    disponibilidad: esquemaDisponibilidad.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'No has cambiado nada.',
  })

/** Query de `GET /api/karma/historial`. */
export const esquemaConsultaHistorial = z.object({
  // Coerción explícita: en un query string todo es texto. `int()` después de
  // `coerce` rechaza "20.5" y "abc" (que se convierte en NaN).
  limite: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(256).optional(),
})

/**
 * Query de `GET /api/karma/insignias`.
 *
 * `userId` es OPCIONAL y solo sirve para pedir las insignias PÚBLICAS de otra
 * persona. Nunca cambia de quién se leen los datos privados: esos salen de
 * RPCs filtradas por `auth.uid()` y no aceptan ningún parámetro de usuario.
 */
export const esquemaConsultaInsignias = z.object({
  userId: z.string().uuid().optional(),
})

export const esquemaIdPerfil = z.string().uuid()
