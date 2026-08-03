// ============================================================================
// Rate limits de B05
//
// ── POR QUÉ SOLO LA CAPA DE MEMORIA, Y POR QUÉ ESO ES UNA DEUDA ────────────
// `lib/rateLimit.ts` tiene dos capas: memoria por instancia (barata,
// best-effort) y `check_rate_limit()` en Postgres (la real, compartida entre
// instancias). La segunda está concedida SOLO a `service_role`, así que exige
// el cliente admin.
//
// La ficha de B05 dice «cero uso del cliente admin en este bloque», y no es una
// preferencia estética: en un bloque que pinta saldos y ledgers, un cliente que
// salta RLS a mano es exactamente el objeto que no debe existir en el
// directorio. Entre saltarse esa regla y quedarnos con una capa, se elige la
// capa — y se anota en HANDOFF/PEDIDOS.md para que B00/F3 expongan una vía de
// rate limiting que no obligue a `service_role` (o concedan la RPC a
// `authenticated`, que también es defendible: la función cuenta, no lee datos).
//
// Qué se pierde mientras tanto: con N instancias en Vercel el límite efectivo
// es N × el configurado. Lo que NO se pierde es lo que de verdad protege estas
// rutas — el ledger y el resumen son de solo lectura y de datos propios, y la
// edición del perfil está topada aguas abajo por el `grant update` de cuatro
// columnas y por el UNIQUE del alias.
// ============================================================================

import { rateLimit } from '@/lib/rateLimit'
import { ErrorApi } from '@/lib/auth/errores'

/**
 * Límites del bloque. Juntos y en un sitio: un límite solo se entiende
 * comparado con los otros.
 */
export const LIMITES_PERFIL = {
  /** Historial del karma. 60/min = una pulsación de "cargar más" por segundo
   *  sostenida durante un minuto: por encima de eso ya no hay una persona
   *  leyendo su historial. */
  historial: { limite: 60, ventanaSegundos: 60 },
  /** Resumen e insignias. Se piden al pintar el perfil. */
  resumen: { limite: 60, ventanaSegundos: 60 },
  /** Editar el perfil. Diez cambios en una hora ya es alguien probando el
   *  validador, no alguien eligiendo su alias. */
  editarPerfil: { limite: 10, ventanaSegundos: 3600 },
  /**
   * Cambiar la disponibilidad. Mismo número que la edición, pero por una razón
   * distinta y que conviene dejar escrita: pasar a `necesito_hablar` es una
   * SEÑAL SENSIBLE. Es lo que otras personas y (más adelante) el emparejamiento
   * de Almas Afines leen como "esta persona está mal ahora mismo". Sin límite,
   * alternarla en bucle sería una forma barata de acaparar atención — y de
   * gastar la atención de quien acude, que es el recurso más escaso de Darma.
   */
  disponibilidad: { limite: 10, ventanaSegundos: 3600 },
} as const

export type AccionPerfil = keyof typeof LIMITES_PERFIL

/**
 * Aplica un límite y LANZA si se ha superado.
 *
 * Lanza en vez de devolver un booleano por el mismo motivo que `requireSesion`:
 * un `if` olvidado en una ruta es una ruta sin límite, y ese olvido no se ve en
 * una revisión de código.
 */
export async function limitarPerfil(accion: AccionPerfil, userId: string): Promise<void> {
  const preset = LIMITES_PERFIL[accion]

  const resultado = await rateLimit({
    key: `${accion}:${userId}`,
    limit: preset.limite,
    windowSeconds: preset.ventanaSegundos,
    // Sin cliente: solo capa 1. Ver la cabecera del archivo.
  })

  if (!resultado.ok) {
    throw new ErrorApi('demasiadas_peticiones', {
      retryAfter: Math.max(1, Math.ceil(resultado.retryAfter)),
    })
  }
}
