'use client'

// ============================================================================
// B07 · UN SOLO IntersectionObserver para todo el feed.
//
// ── POR QUÉ NO UN OBSERVER POR TARJETA ─────────────────────────────────────
// Con un observer por tarjeta, cada una solo se ve a sí misma y la pregunta que
// hay que responder —«¿soy YO la más visible?»— no se puede ni formular. En una
// pantalla alta (tablet, móvil apaisado) dos tarjetas superan el umbral a la
// vez y suenan dos vídeos simultáneamente. Es el bug clásico de los feeds
// verticales y no se arregla subiendo el umbral: se arregla teniendo un
// coordinador que compara.
//
// Aquí hay un registro de MÓDULO con la razón de visibilidad de cada tarjeta,
// un único observer, y en cada cambio se recalcula el ganador con
// `elegirActivo()` (que vive en `lib/video/autoplay.ts` porque es la decisión y
// se prueba sin DOM). El apagado del anterior ocurre ANTES del encendido del
// nuevo: React entrega el mismo valor nuevo a todas las tarjetas en el mismo
// lote, así que no hay un instante con dos activas.
//
// El observer y el registro son de MÓDULO, no de componente: si vivieran en un
// `useRef`, cada `<FeedVertical>` montado tendría el suyo y volveríamos al
// problema original en cuanto hubiera dos listas en pantalla.
//
// ── POR QUÉ `useSyncExternalStore` Y NO `useState` + `useEffect` ───────────
// Este registro ES un almacén externo a React: existe antes del primer render y
// cambia por eventos del navegador. Sincronizarlo con `setState` dentro de un
// efecto provoca un render en cascada por cada tarjeta y, peor, deja una
// ventana entre el primer render y el efecto en la que la tarjeta cree que no
// es la activa. `useSyncExternalStore` lee el valor correcto ya en el primer
// render.
// ============================================================================

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  UMBRAL_VISIBILIDAD,
  autoplayPermitido,
  elegirActivo,
  type PreferenciasReproduccion,
  type Visibilidad,
} from '@/lib/video/autoplay'

interface Tarjeta {
  id: string
  razon: number
}

const registro = new Map<Element, Tarjeta>()
const suscriptores = new Set<() => void>()
let observador: IntersectionObserver | null = null
let activoActual: string | null = null

/** Lee las preferencias del entorno. Fuera de un navegador (SSR, tests) se
 *  devuelve el caso conservador: sin autoplay. */
export function leerPreferencias(): PreferenciasReproduccion {
  if (typeof window === 'undefined') {
    return { movimientoReducido: true, ahorroDatos: true }
  }

  const movimientoReducido =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // `connection` es no estándar y no está en los tipos del DOM. El `unknown` +
  // comprobación evita un `any` (CONTRATOS §1) sin fingir que la API existe
  // siempre.
  const navegador = navigator as Navigator & { connection?: unknown }
  const conexion = navegador.connection
  const ahorroDatos =
    typeof conexion === 'object' &&
    conexion !== null &&
    (conexion as { saveData?: unknown }).saveData === true

  return { movimientoReducido, ahorroDatos }
}

function recalcular(): void {
  const visibilidades: Visibilidad[] = []
  for (const tarjeta of registro.values()) {
    visibilidades.push({ id: tarjeta.id, razon: tarjeta.razon })
  }

  const siguiente = elegirActivo(visibilidades, leerPreferencias(), UMBRAL_VISIBILIDAD)
  if (siguiente === activoActual) return

  activoActual = siguiente
  for (const avisar of suscriptores) avisar()
}

function obtenerObservador(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (observador) return observador

  observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        const tarjeta = registro.get(entrada.target)
        if (tarjeta) tarjeta.razon = entrada.intersectionRatio
      }
      recalcular()
    },
    {
      // Muchos umbrales y no solo 0,55: con un único umbral el observador
      // dispara al cruzarlo y deja de informar, así que dos tarjetas por encima
      // del umbral nunca se pueden comparar entre sí.
      threshold: [0, 0.25, 0.4, 0.55, 0.7, 0.85, 1],
    },
  )

  return observador
}

function suscribir(avisar: () => void): () => void {
  suscriptores.add(avisar)
  return () => {
    suscriptores.delete(avisar)
  }
}

function instantanea(): string | null {
  return activoActual
}

/** En el servidor no hay ventana ni observador: nadie está activo. */
function instantaneaServidor(): string | null {
  return null
}

/**
 * Solo observa quién está activo, sin registrar ninguna tarjeta.
 *
 * Lo usa `<FeedVertical>` para decidir qué tres tarjetas montan iframe. Vive
 * arriba y no en cada tarjeta porque la ventana de iframes es una propiedad de
 * la LISTA (anterior, actual, siguiente), no de una tarjeta suelta.
 */
export function useActivoDelFeed(): string | null {
  return useSyncExternalStore(suscribir, instantanea, instantaneaServidor)
}

/**
 * Registra una tarjeta y devuelve si es la que debe reproducir.
 *
 * @param id       id del contenido.
 * @param elemento nodo de la tarjeta, o `null` mientras monta.
 */
export function useAutoplayEnVista(id: string, elemento: Element | null): boolean {
  const activo = useSyncExternalStore(suscribir, instantanea, instantaneaServidor)

  useEffect(() => {
    if (!elemento) return

    const observador = obtenerObservador()
    registro.set(elemento, { id, razon: 0 })
    observador?.observe(elemento)

    return () => {
      observador?.unobserve(elemento)
      registro.delete(elemento)
      // Si la tarjeta activa se desmonta (scroll largo, navegación), hay que
      // recalcular: si no, `activoActual` apunta a un id que ya no existe y
      // ninguna tarjeta reproduce.
      recalcular()
    }
  }, [id, elemento])

  return activo === id
}

/**
 * ¿Está el autoplay permitido en este dispositivo?
 *
 * Se resuelve en un efecto y no en el render porque `matchMedia` no existe en
 * el servidor: leerlo durante el render daría una discrepancia de hidratación.
 * El valor inicial `false` es el que pinta el servidor.
 */
export function useAutoplayPermitido(): boolean {
  const [permitido, setPermitido] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sincronizar = () => setPermitido(autoplayPermitido(leerPreferencias()))

    sincronizar()
    consulta.addEventListener('change', sincronizar)
    return () => consulta.removeEventListener('change', sincronizar)
  }, [])

  return permitido
}

/** SOLO para pruebas: vacía el registro de módulo. Sin esto, dos suites que
 *  monten feeds distintos comparten estado. */
export function __reiniciarAutoplay(): void {
  registro.clear()
  suscriptores.clear()
  observador?.disconnect()
  observador = null
  activoActual = null
}
