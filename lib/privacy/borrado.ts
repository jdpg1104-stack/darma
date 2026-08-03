// ============================================================================
// Borrado de cuenta — la parte de TypeScript, que es deliberadamente pequeña.
//
// ── EL ALGORITMO NO ESTÁ AQUÍ, Y ESO ES EL DISEÑO ──────────────────────────
// El borrado entero vive en `borrar_usuario()` (migración 0201) porque tiene
// que ser UNA transacción. Si se ejecutara como N llamadas desde Node y una
// fallara a mitad, quedaría una persona MEDIO BORRADA: con la bóveda de
// identidad ya vacía —irreversible— y el perfil aún visible, sin ninguna forma
// de reanudar y sin saber por dónde iba. Ese estado no se puede arreglar
// después, así que no se puede permitir que exista.
//
// Este archivo hace tres cosas: generar el token de confirmación, invocar la
// RPC y traducir el jsonb de vuelta a un tipo. Nada más.
//
// ── POR QUÉ DOS PASOS ──────────────────────────────────────────────────────
// Sin confirmación, un XSS o una sesión robada bastan para borrarle la cuenta a
// alguien de forma irreversible. Se guarda `sha256(token)`, nunca el token: un
// volcado de `privacy_requests` no permite confirmar el borrado de nadie.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResultadoBorrado {
  /** Debe ser `true` SIEMPRE. Si es false, no ha habido borrado. */
  identityVaultBorrado: boolean
  perfilAnonimizado: boolean
  postsLapidados: number
  comentariosConservados: number
  refugiosAbandonados: number
  authUserBorrado: boolean
  aliasRetirado: string
  /** ISO-8601 */
  ejecutadoEn: string
  /** `true` si la persona ya estaba borrada (reintento idempotente). */
  yaEstabaBorrado: boolean
  /**
   * Lo que este borrado NO puede prometer porque depende de otro bloque.
   *
   * La lección del proyecto hermano (`rgpdErase.ts`): allí se borró «por las
   * rutas que declaraba una fila» y cuatro ficheros de una persona ya suprimida
   * siguieron vivos diez días, porque lo que ninguna fila referencia es
   * invisible. Aquí el equivalente son las claves de refugio de B10: el
   * `ciphertext` queda en la tabla y su borrado REAL es asunto de las claves,
   * que este bloque no controla. Se declara en el resultado en vez de darlo por
   * hecho, y está pedido en HANDOFF/PEDIDOS.md.
   */
  pendienteDeOtrosBloques: string[]
}

/** Horas de vida del token de confirmación de borrado. */
export const HORAS_CONFIRMACION = 24
/** Días de arrepentimiento entre la confirmación y la ejecución. */
export const DIAS_ARREPENTIMIENTO = 30

const PENDIENTE_B10 =
  'Claves de cifrado de los refugios (B10): el ciphertext se conserva y su destrucción real depende de la eliminación de las claves.'

interface FilaResultado {
  identity_vault_borrado: boolean
  perfil_anonimizado: boolean
  posts_lapidados: number
  comentarios_conservados: number
  refugios_abandonados: number
  auth_user_borrado: boolean
  alias_retirado: string
  ya_estaba_borrado: boolean
  ejecutado_en: string
}

/**
 * Token de confirmación y su huella.
 *
 * 32 bytes de `randomBytes`, no `randomUUID`: un uuid v4 aporta 122 bits y
 * además tiene estructura reconocible. Aquí el token es el único secreto que
 * separa una cuenta viva de una borrada para siempre, así que se paga el
 * máximo. Lo que se persiste es la huella; el token solo viaja al dueño.
 */
export async function generarTokenConfirmacion(): Promise<{ token: string; sha256: string }> {
  const { randomBytes, createHash } = await import('node:crypto')
  const token = randomBytes(32).toString('base64url')
  const sha256 = createHash('sha256').update(token, 'utf8').digest('hex')
  return { token, sha256 }
}

/** Huella de un token recibido, para compararlo contra el guardado. */
export async function huellaToken(token: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function aResultado(fila: FilaResultado): ResultadoBorrado {
  return {
    identityVaultBorrado: fila.identity_vault_borrado === true,
    perfilAnonimizado: fila.perfil_anonimizado === true,
    postsLapidados: Number(fila.posts_lapidados ?? 0),
    comentariosConservados: Number(fila.comentarios_conservados ?? 0),
    refugiosAbandonados: Number(fila.refugios_abandonados ?? 0),
    authUserBorrado: fila.auth_user_borrado === true,
    aliasRetirado: fila.alias_retirado ?? '',
    ejecutadoEn: fila.ejecutado_en,
    yaEstabaBorrado: fila.ya_estaba_borrado === true,
    pendienteDeOtrosBloques: [PENDIENTE_B10],
  }
}

/**
 * Ejecuta el borrado. Idempotente: repetirla no falla y devuelve el mismo
 * estado final (el recuento es del ESTADO, no de las filas tocadas en la
 * pasada, que es lo que hace que un reintento no mienta).
 *
 * ⚠️ Exige el cliente ADMIN: `borrar_usuario()` está concedida solo a
 * `service_role`.
 */
export async function ejecutarBorradoCon(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResultadoBorrado> {
  const { data, error } = await supabase.rpc('borrar_usuario', { p_user: userId })
  if (error) throw new Error(error.message)

  const fila = data as FilaResultado | null
  if (!fila) throw new Error('borrar_usuario no devolvió resultado')

  // Invariante del bloque entero. Si esto no se cumple, lo que ha ocurrido no
  // es un borrado sino un cambio de nombre, y hay que enterarse aquí y no en
  // una auditoría dentro de seis meses.
  if (fila.identity_vault_borrado !== true) {
    throw new Error('borrado incompleto: identity_vault sigue teniendo fila')
  }

  return aResultado(fila)
}

/** Contrato de la ficha. Usa `service_role`: solo desde el servidor. */
export async function ejecutarBorrado(userId: string): Promise<ResultadoBorrado> {
  const { createAdminClient } = await import('../supabase/admin.ts')
  return ejecutarBorradoCon(createAdminClient(), userId)
}

/** Crea la solicitud y devuelve el token EN CLARO una sola vez: es lo único
 *  que no se puede volver a obtener, porque en la base solo está su huella. */
export async function solicitarBorradoCon(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ solicitudId: string; token: string; expiraEn: string }> {
  const { token, sha256 } = await generarTokenConfirmacion()

  const { data, error } = await supabase.rpc('crear_solicitud_privacidad', {
    p_user: userId,
    p_kind: 'erase',
    p_token_sha256: sha256,
    p_ttl_segundos: HORAS_CONFIRMACION * 3600,
    p_confirmada: false,
  })
  if (error) throw new Error(error.message)

  const expira = new Date(Date.now() + HORAS_CONFIRMACION * 3600 * 1000).toISOString()
  return { solicitudId: String(data), token, expiraEn: expira }
}

/** Contrato de la ficha. */
export async function solicitarBorrado(userId: string): Promise<{ solicitudId: string }> {
  const { createAdminClient } = await import('../supabase/admin.ts')
  const { solicitudId } = await solicitarBorradoCon(createAdminClient(), userId)
  return { solicitudId }
}

/**
 * Confirma el borrado con el token. Devuelve `false` sin distinguir entre
 * token inválido, caducado o ya usado: cualquier distinción le diría a quien
 * prueba tokens cuál de los tres muros ha tocado.
 */
export async function confirmarBorradoCon(
  supabase: SupabaseClient,
  solicitudId: string,
  userId: string,
  token: string,
): Promise<boolean> {
  const sha256 = await huellaToken(token)
  const { data, error } = await supabase.rpc('confirmar_borrado', {
    p_solicitud: solicitudId,
    p_user: userId,
    p_token_sha256: sha256,
  })
  if (error) throw new Error(error.message)
  return data === true
}

/**
 * Firma literal de la ficha, conservada para que el hueco sea VISIBLE.
 *
 * Lanza siempre y a propósito: sin el `userId` de la sesión no hay forma de
 * comprobar de quién es la solicitud, y aceptar la confirmación sin ese
 * chequeo convertiría un id filtrado en el borrado de una cuenta ajena. Un
 * stub que lanza con este mensaje es preferible a borrar la función del
 * contrato en silencio o —mucho peor— a implementarla sin la comprobación.
 * Anotado en HANDOFF/PEDIDOS.md.
 */
export async function confirmarBorrado(_solicitudId: string, _token: string): Promise<void> {
  throw new Error(
    'confirmarBorrado(solicitudId, token) necesita el userId de la sesión: usa confirmarBorradoCon(). ' +
      'Ver HANDOFF/PEDIDOS.md — la firma de la ficha omite el sujeto y aceptar el borrado sin comprobar ' +
      'de quién es la solicitud convertiría un id filtrado en el borrado de una cuenta ajena.',
  )
}

/** Cancela un borrado dentro de los 30 días de arrepentimiento. */
export async function cancelarBorradoCon(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancelar_borrado', { p_user: userId })
  if (error) throw new Error(error.message)
  return data === true
}

/** Fecha en que se ejecutará un borrado confirmado ahora. */
export function fechaDeEjecucion(confirmadoEn = new Date()): string {
  const fecha = new Date(confirmadoEn.getTime() + DIAS_ARREPENTIMIENTO * 24 * 3600 * 1000)
  return fecha.toISOString()
}
