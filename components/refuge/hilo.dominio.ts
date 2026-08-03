// ============================================================================
// B10 · La lógica del hilo que SÍ se puede probar sin navegador.
//
// Está separada de `Hilo.tsx` porque las dos reglas que viven aquí son
// exactamente las dos que la ficha exige probar (casos 9 y 10) y que dentro de
// un componente de React solo se podrían comprobar montando un DOM y un
// WebSocket falsos — es decir, probando el doble en vez del código.
//
//  · `aceptarPayload` — un payload de Realtime con OTRO `refuge_id` se descarta.
//  · `fusionarMensajes` — la lista no duplica ni pierde ningún id al mezclar
//    keyset, tiempo real y relleno tras una reconexión.
// ============================================================================

import type { MensajeDescifrado } from '@/lib/crypto/tipos'

/**
 * ¿Este payload de Realtime es de la sala abierta?
 *
 * Realtime ya respeta RLS y el canal ya lleva `filter: refuge_id=eq.<id>`, así
 * que en teoría esto nunca dice `false`. Se comprueba igual porque es la única
 * de las tres barreras que se ve desde el navegador, y una barrera que no se ve
 * es una barrera que nadie echa de menos cuando la rompe. El coste es una
 * comparación de cadenas por mensaje.
 */
export function aceptarPayload(refugeIdDelCanal: string, fila: { refuge_id?: unknown }): boolean {
  return typeof fila.refuge_id === 'string' && fila.refuge_id === refugeIdDelCanal
}

/**
 * Mezcla mensajes nuevos con los que ya están, sin duplicar y sin perder nada.
 *
 * El orden es DESCENDENTE por `id`, que en `refuge_messages` es un `bigint
 * identity`: es a la vez el orden cronológico y el cursor (0002). Ordenar por
 * `created_at` daría un orden ambiguo con dos mensajes en el mismo milisegundo,
 * y en una conversación de verdad eso pasa.
 *
 * `fusionar` es idempotente a propósito: el mismo mensaje puede llegar dos
 * veces —por el canal de Realtime y por el relleno tras una reconexión— y la
 * lista no puede enseñarlo dos veces.
 */
export function fusionarMensajes(
  previos: readonly MensajeDescifrado[],
  nuevos: readonly MensajeDescifrado[],
): MensajeDescifrado[] {
  const porId = new Map<number, MensajeDescifrado>()
  for (const m of previos) porId.set(m.id, m)
  // Los nuevos ganan: un mensaje que antes era ilegible (no había clave) y que
  // ahora se descifra tiene que sustituir al viejo, no quedar debajo.
  for (const m of nuevos) porId.set(m.id, m)

  return [...porId.values()].sort((a, b) => b.id - a.id)
}

/** El id más alto conocido. Es desde donde se pide el relleno al reconectar. */
export function ultimoId(mensajes: readonly MensajeDescifrado[]): number {
  return mensajes.reduce((max, m) => (m.id > max ? m.id : max), 0)
}

/**
 * Qué hay que pedir tras recuperar el canal.
 *
 * Un INSERT ocurrido mientras el socket estaba caído NO vuelve solo: Realtime
 * no reenvía el pasado. Sin este relleno la conversación tendría agujeros
 * silenciosos, que en un chat de apoyo significa que alguien cree que no le
 * contestaron.
 */
export function pendientesDeRellenar<T extends { id: number }>(
  recibidos: readonly T[],
  ultimoConocido: number,
): T[] {
  return recibidos.filter((m) => m.id > ultimoConocido)
}

/**
 * ¿Hay un hueco entre lo que tengo y lo que acabo de recibir?
 *
 * Si la página de relleno viene llena Y su id más bajo es mayor que
 * `ultimoConocido + 1`, puede que falten mensajes por debajo y hay que seguir
 * pidiendo hacia atrás. Devolver esto en vez de suponer que una página basta es
 * la diferencia entre «reconecté» y «reconecté y no perdí nada».
 */
export function faltanMasPaginas<T extends { id: number }>(
  recibidos: readonly T[],
  ultimoConocido: number,
  tamanoPagina: number,
): boolean {
  if (recibidos.length < tamanoPagina) return false
  const menor = recibidos.reduce((min, m) => (m.id < min ? m.id : min), Number.POSITIVE_INFINITY)
  return menor > ultimoConocido + 1
}
