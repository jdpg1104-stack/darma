// ============================================================================
// B07 · Quién reproduce — la decisión, sin DOM.
//
// ── POR QUÉ ESTO NO ESTÁ DENTRO DEL HOOK ───────────────────────────────────
// El fallo que se quiere evitar (dos vídeos sonando a la vez en una pantalla
// alta) es un fallo de DECISIÓN, no de DOM: ocurre cuando cada tarjeta decide
// por su cuenta si está lo bastante visible. Sacar la decisión aquí permite
// probarla con `node --test` y sin navegador, que es lo que hace que la prueba
// del caso "tres tarjetas visibles" sea una prueba de verdad.
//
// El hook (`components/video/useAutoplayEnVista.ts`) mantiene UN SOLO
// IntersectionObserver de módulo, recoge las razones de visibilidad de todas
// las tarjetas registradas y llama a `elegirActivo()` con el mapa entero. Con
// un observer por tarjeta la pregunta "¿soy yo la más visible?" no se puede ni
// formular: cada una solo se ve a sí misma.
// ============================================================================

/** Fracción visible mínima para que una tarjeta pueda ser la activa. */
export const UMBRAL_VISIBILIDAD = 0.55

/** Preferencias del entorno que APAGAN el autoplay por completo. */
export interface PreferenciasReproduccion {
  /** `prefers-reduced-motion: reduce`. */
  movimientoReducido: boolean
  /** `navigator.connection.saveData`. */
  ahorroDatos: boolean
}

/**
 * ¿Se permite el autoplay?
 *
 * Los dos casos son negativas explícitas de la persona, no heurísticas:
 *  · `prefers-reduced-motion` lo activa quien tiene migrañas, vértigo o
 *    trastornos vestibulares. Un feed de vídeo que arranca solo es exactamente
 *    lo que esa preferencia pide que no ocurra.
 *  · `saveData` lo activa quien paga los megas. Un feed vertical que
 *    precarga vídeo puede costar dinero real.
 *
 * En ambos casos la tarjeta se queda en miniatura y reproduce al tocar: no se
 * pierde el contenido, se pierde la reproducción automática.
 */
export function autoplayPermitido(preferencias: PreferenciasReproduccion): boolean {
  return !preferencias.movimientoReducido && !preferencias.ahorroDatos
}

/** Lo que el observador sabe de una tarjeta. */
export interface Visibilidad {
  id: string
  /** 0–1. Fracción del alto de la tarjeta que está en pantalla. */
  razon: number
  /**
   * Superficie visible REAL en px². Opcional: sin ella se desempata por `razon`,
   * que es lo que se hacía antes.
   *
   * ── POR QUÉ NO BASTA `razon` ───────────────────────────────────────────────
   * `razon` es una fracción del alto de CADA tarjeta, así que compara peras con
   * manzanas en cuanto dos tarjetas miden distinto: una tarjeta corta vista
   * ENTERA (razon 1,0) le gana a una de pantalla completa vista al 80 %
   * (razon 0,8), aunque la segunda ocupe cinco veces más pantalla y sea
   * evidentemente la que la persona está mirando.
   *
   * Hoy es latente: todas las tarjetas de `/animo` son `100dvh` y las dos
   * medidas coinciden. Se añade ahora porque el día que se intercale una tarjeta
   * de otra altura —un aviso, una encuesta, un separador— la elección empezaría
   * a fallar EN SILENCIO, sin error y sin prueba roja. Encontrado al portar
   * desde DataLaps (HANDOFF/B21.md §3).
   */
  superficie?: number
}

/**
 * Devuelve el id de la ÚNICA tarjeta SELECCIONADA (la actual), o `null`.
 *
 * ── SELECCIÓN ≠ REPRODUCCIÓN ───────────────────────────────────────────────
 * Esta función ya NO mira las preferencias (`prefers-reduced-motion`,
 * `saveData`): esas apagan el arranque AUTOMÁTICO (`autoplayPermitido()`, que
 * evalúa la tarjeta al decidir si envía `playVideo`), nunca la selección.
 * Cuando las miraba, con movimiento reducido no había tarjeta activa, y como
 * el bucle de latidos solo corre en la activa, quien pedía menos movimiento
 * podía ver el vídeo ENTERO tocando play a mano y no recibir jamás su +1: la
 * preferencia de accesibilidad lo expulsaba de la economía del nivel 1 en
 * silencio. Lo encontró el primer recorrido e2e real (spec 06, camino 11).
 *
 * Desempate por id (orden lexicográfico) y no "la primera que llegó": con dos
 * tarjetas exactamente igual de visibles —que ocurre al parar el scroll justo
 * en medio— un desempate por orden de llegada hace que la elegida dependa del
 * orden en que el observador entregó las entradas, que no es estable. El
 * resultado sería un parpadeo entre dos vídeos.
 */
export function elegirActivo(
  visibilidades: ReadonlyArray<Visibilidad>,
  umbral: number = UMBRAL_VISIBILIDAD,
): string | null {
  let mejor: Visibilidad | null = null
  for (const v of visibilidades) {
    // El UMBRAL se sigue evaluando sobre `razon`: «¿se ve lo bastante de ESTA
    // tarjeta?» es una pregunta sobre la tarjeta, no sobre la pantalla.
    if (v.razon < umbral) continue
    if (mejor === null || ganaA(v, mejor)) mejor = v
  }

  return mejor?.id ?? null
}

/**
 * Desempate entre dos candidatas que ya pasaron el umbral.
 *
 * Orden: superficie visible → razón → id. El id último y siempre presente hace
 * la elección DETERMINISTA: sin él, dos tarjetas empatadas podrían alternarse
 * entre recálculos y el vídeo parpadearía de una a otra.
 */
function ganaA(candidata: Visibilidad, actual: Visibilidad): boolean {
  const sa = candidata.superficie
  const sb = actual.superficie
  // Solo se compara por superficie si AMBAS la traen: mezclar px² con fracciones
  // daría una comparación sin sentido y ganaría siempre quien la declare.
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa > sb
  if (candidata.razon !== actual.razon) return candidata.razon > actual.razon
  return candidata.id < actual.id
}

/**
 * Qué tarjetas montan iframe: la activa y sus dos vecinas.
 *
 * Diez iframes de YouTube simultáneos son ~4 MB de JS de terceros; el
 * presupuesto de CONTRATOS §11 es 120 KB por ruta. Las demás tarjetas son un
 * `<img>` de `i.ytimg.com`, que además es lo que se ve mientras el vídeo carga
 * de todas formas.
 *
 * Cuando no hay activa (autoplay apagado, o nada visible) se monta la PRIMERA:
 * sin eso, con `prefers-reduced-motion` el feed no tendría ni un reproductor y
 * tocar la tarjeta no haría nada.
 */
export function ventanaDeIframes(orden: ReadonlyArray<string>, activo: string | null): Set<string> {
  if (orden.length === 0) return new Set()

  const centro = activo === null ? 0 : Math.max(0, orden.indexOf(activo))
  const vivos = new Set<string>()

  for (let i = centro - 1; i <= centro + 1; i++) {
    if (i >= 0 && i < orden.length) vivos.add(orden[i])
  }

  return vivos
}
