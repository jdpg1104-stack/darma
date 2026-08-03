// ============================================================================
// B07 · Desbloqueo de audio — la máquina de estados, sin DOM.
//
// ── LAS TRES COSAS QUE HAY QUE ENTENDER ────────────────────────────────────
//
// 1. NINGÚN navegador permite reproducir con sonido sin activación de usuario.
//    Los vídeos arrancan MUTEADOS siempre. No es una preferencia de producto.
//
// 2. EL SCROLL NO ES ACTIVACIÓN. `scroll`, `wheel` y `touchmove` no cuentan
//    como gesto para el navegador. Solo cuentan `pointerdown`, `keydown` y
//    `touchend` (y `click`, que se deriva de los anteriores). Escuchar el
//    scroll para "detectar interacción" produce un desbloqueo que el navegador
//    no reconoce: pedimos `unMute` y el navegador PAUSA el vídeo.
//
// 3. EL DESBLOQUEO NO SE PERSISTE. «Ya lo desbloqueó una vez» y «está
//    desbloqueado ahora» son cosas distintas: la activación de usuario es una
//    propiedad del DOCUMENTO y muere con él. Un flag en `sessionStorage`
//    sobrevive a la recarga, así que tras un F5 creeríamos tener permiso, se
//    pediría `unMute` sin activación real y el navegador respondería pausando.
//    Resultado: la persona se queda sin vídeo Y sin sonido, y el botón 🔇 no
//    aparece porque "según nosotros" ya estaba desbloqueado. Por eso el estado
//    vive en una variable de módulo y nada más.
//
// El estado se aísla aquí para poder probar el ciclo completo —incluida la
// "recarga"— sin navegador.
// ============================================================================

/** Eventos que el navegador SÍ considera activación de usuario. */
export const GESTOS_VALIDOS = ['pointerdown', 'keydown', 'touchend'] as const

export type GestoValido = (typeof GESTOS_VALIDOS)[number]

/** Eventos que parecen interacción y NO lo son. Están listados para que quede
 *  escrito por qué no aparecen arriba. */
export const GESTOS_INVALIDOS = ['scroll', 'wheel', 'touchmove', 'mousemove'] as const

export function esGestoValido(tipo: string): tipo is GestoValido {
  return (GESTOS_VALIDOS as readonly string[]).includes(tipo)
}

/**
 * Estado del desbloqueo. Un objeto y no variables sueltas para que "simular una
 * recarga" en una prueba sea construir uno nuevo, igual que en el navegador es
 * construir un documento nuevo.
 */
export interface EstadoAudio {
  desbloqueado: boolean
}

/** Documento recién cargado: muteado, siempre. */
export function estadoInicial(): EstadoAudio {
  return { desbloqueado: false }
}

/**
 * Interfaz mínima de `navigator.userActivation`, que es la fuente autorizada:
 * si el navegador ya registró un gesto (por ejemplo el clic que trajo a la
 * persona a esta pantalla), no hace falta esperar a otro.
 */
export interface ActivacionUsuario {
  hasBeenActive?: boolean
  isActive?: boolean
}

/**
 * Consulta el estado, preguntando primero al navegador.
 *
 * `hasBeenActive` es "hubo un gesto en este documento", que es exactamente la
 * condición que el navegador exige para permitir audio. Se consulta ANTES que
 * nuestro propio flag porque el navegador es la autoridad y nosotros somos un
 * caché; cuando los dos discrepan, quien decide si el vídeo se pausa es él.
 */
export function puedeSonar(estado: EstadoAudio, activacion?: ActivacionUsuario | null): boolean {
  if (activacion?.hasBeenActive === true) return true
  return estado.desbloqueado
}

/**
 * Registra un gesto. Devuelve `true` si esta llamada ha cambiado el estado
 * (para que quien llama sepa cuándo hay que desmutear y no lo haga en cada
 * pulsación).
 */
export function registrarGesto(estado: EstadoAudio, tipo: string): boolean {
  if (!esGestoValido(tipo)) return false
  if (estado.desbloqueado) return false

  estado.desbloqueado = true
  return true
}
