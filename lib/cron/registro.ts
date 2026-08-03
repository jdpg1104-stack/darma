// ============================================================================
// B00 · integración · el registro de ejecuciones y el arrendamiento.
//
// «Que se pueda auditar qué corrió y qué no» es un requisito, no un extra: el
// log de Vercel se retiene poco y no se puede consultar por trabajo. Cuando
// dentro de seis meses alguien pregunte «¿se ejecutó el borrado de esta persona
// dentro del mes que da el art. 12.3?», la respuesta tiene que salir de una
// consulta, no de la memoria de nadie.
//
// DOS DECISIONES QUE IMPORTAN:
//
//  1. SE ESCRIBE TRABAJO A TRABAJO, NO AL FINAL. Si la función muere al agotar
//     `maxDuration`, un registro acumulado en memoria se pierde ENTERO — y se
//     pierde justo el día raro, que es el único día en que se iba a consultar.
//
//  2. NINGUNA DE ESTAS FUNCIONES LANZA. Un fallo al auditar no puede tumbar el
//     despacho. Se grita en el log y se sigue.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EjecucionTrabajo } from './tipos.ts'

/**
 * Escribe una fila de `cron_runs`. NUNCA lanza.
 *
 * `iniciado_en` se calcula hacia atrás desde ahora con la duración medida: el
 * reloj del despachador es monótono e inyectable (los tests lo mueven a mano) y
 * no se puede convertir en una fecha de pared sin este resto.
 */
export async function registrarEjecucion(
  admin: SupabaseClient,
  despacho: string,
  fila: EjecucionTrabajo,
): Promise<void> {
  try {
    const { error } = await admin.from('cron_runs').insert({
      despacho,
      trabajo: fila.trabajo,
      estado: fila.estado,
      iniciado_en: new Date(Date.now() - fila.ms).toISOString(),
      ms: fila.ms,
      detalle: fila.detalle,
    })
    if (error) throw new Error(error.message)
  } catch (causa) {
    console.error('[darma][cron] cron_runs no escrito', {
      despacho,
      trabajo: fila.trabajo,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
  }
}

/**
 * Toma el arrendamiento del despachador. `false` ⇒ ya hay uno corriendo y este
 * disparo se retira sin hacer nada.
 *
 * FAIL-OPEN A PROPÓSITO, y es la única decisión fail-open de este bloque: si la
 * llamada falla (la función no existe todavía, la base no responde un instante)
 * se devuelve `true` y el despacho corre. El lease evita trabajo DUPLICADO, que
 * es un desperdicio; negarse a correr por no poder comprobarlo convertiría un
 * fallo transitorio en un borrado RGPD que no se ejecuta, que es un
 * incumplimiento. Todos los trabajos son idempotentes: duplicar es caro, no
 * incorrecto.
 */
export async function tomarLease(
  admin: SupabaseClient,
  nombre: string,
  segundos: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('cron_tomar_lease', {
      p_nombre: nombre,
      p_segundos: segundos,
    })
    if (error) throw new Error(error.message)
    return data !== false
  } catch (causa) {
    console.warn('[darma][cron] no se pudo comprobar el arrendamiento; se corre igual', {
      nombre,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
    return true
  }
}

/** Suelta el arrendamiento. NUNCA lanza: la garantía real es la caducidad. */
export async function soltarLease(admin: SupabaseClient, nombre: string): Promise<void> {
  try {
    await admin.rpc('cron_soltar_lease', { p_nombre: nombre })
  } catch (causa) {
    console.warn('[darma][cron] no se pudo soltar el arrendamiento (vencerá solo)', {
      nombre,
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
  }
}
