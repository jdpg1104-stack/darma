// ============================================================================
// B13 · Tipos compartidos del bloque
//
// Viven aparte de `enviar.ts` para que `plantillas.ts` (que solo construye
// texto y no toca la red) no tenga que importar el módulo de envío. Sin esta
// separación, una prueba de anonimato del contenido arrastraría el transporte
// HTTP entero. `enviar.ts` los reexporta con los nombres que fija la ficha.
// ============================================================================

import type { TipoNotificacion } from './preferencias.ts'

/** Una suscripción tal y como la necesita el envío. Nada más. */
export interface Suscripcion {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Lo ÚNICO que sale por la red hacia el dispositivo.
 *
 * Cuatro campos y ni uno más, y esa escasez es el contrato de anonimato del
 * bloque:
 *  · `cuerpo` NUNCA contiene el texto de un post ni de un comentario. Una
 *    notificación aparece en la pantalla de bloqueo y la lee cualquiera que
 *    pase por delante del móvil.
 *  · No hay `postId`, ni `authorId`, ni `aliasEmisor` como campo suelto. Si el
 *    alias está oculto, el service worker no debe tener material con el que
 *    reconstruirlo: lo que no viaja no se puede filtrar.
 *  · `url` es una ruta interna. Abrir el hilo exige sesión, así que el destino
 *    no revela nada por sí mismo.
 */
export interface CargaPush {
  tipo: TipoNotificacion
  titulo: string
  cuerpo: string
  url: string
}

/** Resultado de un intento de entrega. `'gone'` ⇒ hay que borrar la fila. */
export type ResultadoEnvio = 'ok' | 'gone' | 'error'
