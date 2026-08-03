// ============================================================================
// Piezas comunes de las rutas de /api/privacy/*.
//
// Están en `_dominio/` —con guion bajo, así el App Router no lo trata como una
// ruta— para que las cuatro rutas compartan las decisiones de seguridad en vez
// de repetirlas cuatro veces. Repetir una decisión de seguridad es garantizar
// que un día solo se corrija en tres sitios.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '@/lib/auth/errores'
import { rateLimit } from '@/lib/rateLimit'

/**
 * Límites de este bloque.
 *
 * La exportación es la consulta más pesada que hará un usuario normal: nueve
 * consultas, algunas sobre las tablas más grandes de la app. Sin un límite
 * duro, un bucle de peticiones de exportación es una denegación de servicio
 * contra nuestra propia base de datos, y encima autenticada — el atacante ni
 * siquiera tiene que esconderse.
 */
export const LIMITES_PRIVACIDAD = {
  /** UNA exportación cada 24 h y persona. */
  exportar: { limite: 1, ventanaSegundos: 86_400 },
  /** Descargar: algo más de margen para un reintento honesto de red. */
  descargar: { limite: 10, ventanaSegundos: 3_600 },
  /** Solicitar o confirmar un borrado. Bajo: es una acción irreversible. */
  eliminar: { limite: 5, ventanaSegundos: 3_600 },
  /** Leer y registrar consentimientos. */
  consentimientos: { limite: 30, ventanaSegundos: 3_600 },
} as const

export type AccionPrivacidad = keyof typeof LIMITES_PRIVACIDAD

/**
 * Aplica el límite y lanza `demasiadas_peticiones` con `retryAfter` en segundos.
 *
 * `failClosed: true` en todo este bloque, al revés que en el feed. Aquí no hay
 * ninguna acción que sea peor denegar que permitir: si Postgres no responde,
 * dejar pasar una exportación significa servir el volcado completo de la vida
 * emocional de alguien sin contar cuántas veces va, y dejar pasar un borrado
 * significa ejecutar algo irreversible sin límite.
 */
export async function limitarPrivacidad(
  accion: AccionPrivacidad,
  userId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const preset = LIMITES_PRIVACIDAD[accion]
  const resultado = await rateLimit({
    key: `privacy_${accion}:${userId}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    supabase,
    failClosed: true,
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}

/**
 * Registro de movimientos de privacidad (solicitud, confirmación, ejecución,
 * descarga).
 *
 * Lleva `userId`, acción y fecha, y NADA MÁS. Ni IP ni user-agent: CONTRATOS §2
 * los prohíbe, y un registro de privacidad que guarda la IP de quien ejerce su
 * derecho al anonimato es una contradicción con forma de buena práctica.
 */
export function registrarMovimiento(
  accion: string,
  userId: string,
  extra: Record<string, string | number | boolean> = {},
): void {
  // `console.warn` y no `console.log`: el eslint del repo prohíbe `log` para
  // que ningún cuerpo de desahogo acabe en los logs de Vercel por descuido.
  console.warn(
    JSON.stringify({
      evento: 'privacidad',
      accion,
      user_id: userId,
      fecha: new Date().toISOString(),
      ...extra,
    }),
  )
}
