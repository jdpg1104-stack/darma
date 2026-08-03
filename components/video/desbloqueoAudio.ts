'use client'

// ============================================================================
// B07 · Desbloqueo de audio — el cableado al documento.
//
// La máquina de estados vive en `lib/video/audio.ts` (probable sin navegador);
// aquí solo se conecta a los eventos reales y se avisa a las tarjetas.
//
// LAS TRES REGLAS, otra vez, porque son las que se rompen:
//  1. Los vídeos arrancan MUTEADOS. Siempre. Ningún navegador permite otra cosa
//     sin activación de usuario.
//  2. El SCROLL NO CUENTA. Solo `pointerdown`, `keydown` y `touchend`. Escuchar
//     `scroll` produce un desbloqueo que el navegador no reconoce.
//  3. NO SE PERSISTE. El estado vive en una variable de módulo y muere con el
//     documento, igual que la activación real. Un flag en `sessionStorage`
//     sobreviviría a la recarga y nos haría pedir `unMute` sin permiso: el
//     navegador responde PAUSANDO el vídeo, y la persona se queda sin vídeo y
//     sin sonido, sin que aparezca el botón 🔇 porque «según nosotros» ya
//     estaba desbloqueado.
//
// Los listeners van en `capture` y sobre `document`: un `pointerdown` dentro de
// un iframe de YouTube no llega a nosotros, pero cualquier gesto en el resto de
// la app —incluida otra pantalla— sí, y con uno basta para todo el documento.
//
// Es un almacén externo a React (existe antes del primer render, cambia por
// eventos del navegador), así que se expone con `useSyncExternalStore`: leer el
// valor correcto ya en el primer render evita el parpadeo del botón 🔇 y los
// renders en cascada de una tarjeta por vídeo.
// ============================================================================

import { useSyncExternalStore } from 'react'
import {
  GESTOS_VALIDOS,
  estadoInicial,
  puedeSonar as puedeSonarPuro,
  registrarGesto,
  type EstadoAudio,
} from '@/lib/video/audio'

/** Estado del DOCUMENTO actual. Se recrea al recargar, igual que la activación
 *  real del navegador. Nada de esto se persiste. */
const estado: EstadoAudio = estadoInicial()

const suscriptores = new Set<() => void>()
let cableado = false

function activacionDelNavegador(): { hasBeenActive?: boolean } | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }
  return nav.userActivation ?? null
}

/** ¿Se puede pedir `unMute` AHORA sin que el navegador pause el vídeo? */
export function puedeSonar(): boolean {
  return puedeSonarPuro(estado, activacionDelNavegador())
}

function alGesto(evento: Event): void {
  if (!registrarGesto(estado, evento.type)) return
  for (const avisar of suscriptores) avisar()
  desconectar()
}

function conectar(): void {
  if (cableado || typeof document === 'undefined') return
  cableado = true
  for (const tipo of GESTOS_VALIDOS) {
    document.addEventListener(tipo, alGesto, { capture: true, passive: true })
  }
}

function desconectar(): void {
  if (!cableado || typeof document === 'undefined') return
  cableado = false
  for (const tipo of GESTOS_VALIDOS) {
    document.removeEventListener(tipo, alGesto, { capture: true })
  }
}

function suscribir(avisar: () => void): () => void {
  suscriptores.add(avisar)
  // Puede que el navegador ya tenga activación (el clic que trajo a la persona
  // hasta aquí). Solo se cablea si todavía hace falta esperar a un gesto.
  if (!puedeSonar()) conectar()

  return () => {
    suscriptores.delete(avisar)
    if (suscriptores.size === 0) desconectar()
  }
}

function instantanea(): boolean {
  return puedeSonar()
}

/** En el servidor nunca hay activación de usuario: siempre muteado. */
function instantaneaServidor(): boolean {
  return false
}

/**
 * Devuelve si el audio está desbloqueado y mantiene la escucha viva mientras
 * haya al menos una tarjeta montada.
 */
export function useDesbloqueoAudio(): boolean {
  return useSyncExternalStore(suscribir, instantanea, instantaneaServidor)
}

/** SOLO para pruebas: devuelve el documento al estado de recién cargado. */
export function __reiniciarAudio(): void {
  estado.desbloqueado = false
  suscriptores.clear()
  desconectar()
}
