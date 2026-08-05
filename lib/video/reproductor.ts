// ============================================================================
// B07 · Hablar con el iframe de YouTube por postMessage.
//
// ── LO ÚNICO QUE NO SE PUEDE OLVIDAR: `event.origin` ───────────────────────
// Un `window.addEventListener('message', ...)` sin comprobar el origen acepta
// mensajes de CUALQUIER iframe de la página y de cualquier ventana que nos haya
// abierto. En este bloque eso no es un problema teórico: el mensaje que nos
// interesa es `onStateChange: ENDED`, y ese mensaje es lo que dispara la
// llamada a `/completado`. Sin la comprobación, cualquier iframe podría fingir
// que un vídeo terminó.
//
// (La comprobación de origen es la primera barrera, no la única: aunque alguien
// consiguiera disparar `/completado`, la RPC exige el 90 % de la duración
// acumulada en el SERVIDOR a partir de latidos. Las dos capas son
// independientes a propósito.)
//
// Este módulo es deliberadamente pasivo respecto al DOM: `parsearMensaje()` es
// una función pura sobre `{origin, data}` para que el camino de fallo —el
// mensaje del origen impostor— se pueda probar sin navegador.
// ============================================================================

import { ORIGEN_EMBED } from './embed.ts'

/** Órdenes que entiende el reproductor incrustado. Lista CERRADA. */
export type ComandoReproductor = 'playVideo' | 'pauseVideo' | 'mute' | 'unMute'

/**
 * Estados de la IFrame API de YouTube. Los números son de su protocolo, no
 * nuestros: `-1` sin empezar, `0` terminado, `1` reproduciendo, `2` en pausa,
 * `3` almacenando en búfer, `5` en cola.
 */
export const ESTADO = {
  SIN_EMPEZAR: -1,
  TERMINADO: 0,
  REPRODUCIENDO: 1,
  PAUSADO: 2,
  BUFFER: 3,
  EN_COLA: 5,
} as const

export type EstadoReproductor = (typeof ESTADO)[keyof typeof ESTADO]

/** Lo que sacamos de un mensaje del reproductor. `null` = no nos interesa. */
export interface MensajeReproductor {
  evento: 'onStateChange' | 'onReady' | 'infoDelivery'
  estado: EstadoReproductor | null
}

/** Lo mínimo de un `MessageEvent` que este módulo necesita. Tipar así permite
 *  probar el camino de fallo sin fabricar un `MessageEvent` real. */
export interface MensajeEntrante {
  origin: string
  data: unknown
  source?: unknown
}

/**
 * Traduce un mensaje entrante, o devuelve `null`.
 *
 * Devuelve `null` —y no lanza— para todo lo que no reconoce: mensajes de otros
 * orígenes, de extensiones del navegador, de React DevTools, de HMR. Son
 * frecuentes y normales; tratarlos como error llenaría la consola de ruido y
 * escondería el problema de verdad.
 */
export function parsearMensaje(
  evento: MensajeEntrante,
  origenPermitido: string = ORIGEN_EMBED,
): MensajeReproductor | null {
  // ── LA BARRERA ───────────────────────────────────────────────────────────
  // Comparación exacta contra UN único origen completo. Nunca `includes()` ni
  // `endsWith()`: `https://www.youtube-nocookie.com.evil.example` pasa las dos.
  //
  // `origenPermitido` existe para UN caso: el stub e2e (lib/video/stubE2E.ts),
  // cuyo srcdoc hereda nuestro propio origen. Solo TarjetaVideo lo inyecta y
  // solo con el fusible abierto; en todos los demás llamadores rige el valor
  // por defecto. Lo vigila scripts/security/guardStubReproductor.ts.
  if (evento.origin !== origenPermitido) return null

  let carga: unknown = evento.data
  if (typeof carga === 'string') {
    try {
      carga = JSON.parse(carga)
    } catch {
      return null
    }
  }

  if (typeof carga !== 'object' || carga === null) return null

  const objeto = carga as { event?: unknown; info?: unknown }
  const evt = objeto.event
  if (evt !== 'onStateChange' && evt !== 'onReady' && evt !== 'infoDelivery') return null

  // `onStateChange` trae el estado en `info` como número; `infoDelivery` lo
  // trae dentro de `info.playerState`.
  let estado: number | null = null
  if (typeof objeto.info === 'number') {
    estado = objeto.info
  } else if (typeof objeto.info === 'object' && objeto.info !== null) {
    const detalle = (objeto.info as { playerState?: unknown }).playerState
    if (typeof detalle === 'number') estado = detalle
  }

  return {
    evento: evt,
    estado: esEstadoConocido(estado) ? estado : null,
  }
}

function esEstadoConocido(valor: number | null): valor is EstadoReproductor {
  return valor !== null && (Object.values(ESTADO) as number[]).includes(valor)
}

/** Interfaz mínima de un iframe para poder mandarle órdenes (y para poder
 *  sustituirlo por un doble en las pruebas). */
export interface DestinoComando {
  postMessage(mensaje: string, origenDestino: string): void
}

/**
 * Manda una orden al reproductor.
 *
 * El segundo argumento de `postMessage` es el origen DESTINO, y va explícito
 * (nunca `'*'`): con `'*'` el mensaje se entrega a quien sea que ocupe ese
 * iframe, incluido un origen distinto tras una redirección.
 *
 * `origenDestino` es el mismo punto de inyección (y con la misma regla) que el
 * `origenPermitido` de `parsearMensaje`: solo el stub e2e lo usa.
 */
export function enviarComando(
  destino: DestinoComando | null | undefined,
  comando: ComandoReproductor,
  origenDestino: string = ORIGEN_EMBED,
): void {
  if (!destino || typeof destino.postMessage !== 'function') return

  destino.postMessage(
    JSON.stringify({ event: 'command', func: comando, args: [] }),
    origenDestino,
  )
}

/**
 * Se suscribe al reproductor para recibir sus eventos.
 *
 * Sin este mensaje inicial YouTube no envía NADA aunque `enablejsapi=1` esté
 * puesto: el `listening` es lo que abre el canal.
 */
export function suscribirse(
  destino: DestinoComando | null | undefined,
  idEscucha: string,
  origenDestino: string = ORIGEN_EMBED,
): void {
  if (!destino || typeof destino.postMessage !== 'function') return

  destino.postMessage(
    JSON.stringify({ event: 'listening', id: idEscucha, channel: 'widget' }),
    origenDestino,
  )
}
