// ============================================================================
// Acceso a `auth_totp` — el ÚNICO sitio de B01 que toca esa tabla
//
// ⚠️ USA EL CLIENTE ADMIN, Y ES INEVITABLE: `auth_totp` tiene RLS activada y
// CERO políticas (ver 0101_b01_auth.sql), igual que `identity_vault`. Eso
// significa denegado para `anon` y para `authenticated`, así que no hay
// política que escribir ni consulta de RLS que pueda leerla: solo `service_role`
// la ve. No es un atajo; es el diseño.
//
// Se concentra aquí en vez de repartirse por las tres rutas de 2FA para que
// "quién puede leer los secretos del segundo factor" sea una pregunta con una
// sola respuesta y un solo archivo que auditar. Ninguna función de este módulo
// devuelve el secreto descifrado: devuelven el blob, y descifrar es una
// decisión explícita de quien llama.
//
// ⛔ SOLO SERVIDOR (importa lib/supabase/admin.ts, que lleva su propia guarda).
// ============================================================================

import { createAdminClient } from '../supabase/admin.ts'
import { ErrorApi } from './errores.ts'

const TABLA = 'auth_totp'

export interface RegistroTotp {
  secretoCifrado: Buffer
  /** ISO-8601 o null mientras no se ha validado el primer código. */
  confirmadoEn: string | null
  hashesRecuperacion: string[]
}

/**
 * PostgREST serializa `bytea` como el literal hexadecimal de Postgres
 * (`\x00ff…`) y espera ese mismo formato al escribir. Se traduce aquí y solo
 * aquí: dejarlo suelto en las rutas garantiza que alguien acabe guardando un
 * base64 y descubriéndolo el día que un mentor pierda el móvil.
 */
function aBytea(datos: Buffer): string {
  return `\\x${datos.toString('hex')}`
}

function desdeBytea(valor: unknown): Buffer {
  if (typeof valor !== 'string' || !valor.startsWith('\\x')) {
    throw new ErrorApi('error_interno', { causa: new Error('bytea con formato inesperado') })
  }
  return Buffer.from(valor.slice(2), 'hex')
}

export async function leerRegistroTotp(userId: string): Promise<RegistroTotp | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from(TABLA)
    .select('secret_encrypted, confirmed_at, recovery_hashes')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new ErrorApi('error_interno', { causa: error })
  if (!data) return null

  return {
    secretoCifrado: desdeBytea(data.secret_encrypted),
    confirmadoEn: data.confirmed_at ?? null,
    hashesRecuperacion: Array.isArray(data.recovery_hashes) ? data.recovery_hashes : [],
  }
}

/**
 * ¿Tiene el segundo factor ACTIVO? Activo = confirmado.
 *
 * Un secreto guardado pero sin confirmar no cuenta: si contara, alguien que
 * empezó a configurar el 2FA y no llegó a escanear el QR se quedaría fuera de
 * su propia cuenta, y recuperarla exigiría justo la vía que el 2FA protege.
 */
export async function tieneSegundoFactor(userId: string): Promise<boolean> {
  const registro = await leerRegistroTotp(userId)
  return registro?.confirmadoEn != null
}

/**
 * Guarda (o reemplaza) el secreto sin confirmar.
 *
 * Reemplazar borra los códigos de recuperación anteriores a propósito: son
 * códigos del secreto viejo y con el nuevo no abren nada. Dejarlos daría una
 * lista de códigos que parecen válidos y no lo son.
 */
export async function guardarSecretoTotp(userId: string, secretoCifrado: Buffer): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from(TABLA).upsert(
    {
      user_id: userId,
      secret_encrypted: aBytea(secretoCifrado),
      confirmed_at: null,
      recovery_hashes: [],
    },
    { onConflict: 'user_id' },
  )

  if (error) throw new ErrorApi('error_interno', { causa: error })
}

/** Marca el segundo factor como confirmado y fija sus códigos de recuperación. */
export async function confirmarTotp(userId: string, hashesRecuperacion: string[]): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from(TABLA)
    .update({ confirmed_at: new Date().toISOString(), recovery_hashes: hashesRecuperacion })
    .eq('user_id', userId)

  if (error) throw new ErrorApi('error_interno', { causa: error })
}

/**
 * Persiste la lista de códigos que quedan tras consumir uno.
 *
 * Es la mitad que hace que un código sea DE UN SOLO USO. Verificar sin guardar
 * convierte los diez códigos en diez llaves permanentes.
 */
export async function guardarHashesRecuperacion(userId: string, hashes: string[]): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from(TABLA).update({ recovery_hashes: hashes }).eq('user_id', userId)

  if (error) throw new ErrorApi('error_interno', { causa: error })
}
