// ============================================================================
// Cadencia de encuestas — decisión PURA, sin base de datos y sin reloj propio.
//
// POR QUÉ UNA CADENCIA Y NO "UNA ENCUESTA CADA X TARJETAS":
// el feed de Darma se lee en ráfagas cortas. Con una regla solo posicional,
// quien abre la app cinco veces al día ve cinco encuestas —siempre la misma
// posición, siempre desde arriba— y la encuesta pasa de "¿le pasa a alguien
// más?" a peaje. Con el tope diario ve dos.
//
// LOS UMBRALES VIVEN SOLO AQUÍ. Si se repiten en la UI, en un comentario de
// otro archivo o en una descripción de producto, se desincronizarán: el número
// de la copia es el que nadie actualiza. La tarjeta no sabe cuántas encuestas
// van hoy; recibe una encuesta o no la recibe.
//
// `ahora` es inyectable para que el test no dependa del reloj de la máquina.
// Un test que solo pasa antes de medianoche no es un test.
// ============================================================================

/** Tope de encuestas mostradas a una misma persona en un día natural. */
export const MAX_ENCUESTAS_DIA = 2

/** Separación mínima entre dos encuestas para la misma persona. */
export const HORAS_ENTRE_ENCUESTAS = 6

/**
 * A partir de qué posición del feed puede caer una encuesta.
 *
 * Es un SUELO (`posicion >= CADA_N_TARJETAS`), no un módulo. Con un módulo, los
 * slots fijos de B02 —índices 3, 8 y 13 en `SLOTS_INTERLEAVE`— no serían
 * múltiplos de 7 y el carril de encuestas se apagaría entero sin que nada
 * fallara: cero errores, cero encuestas. El "cada N" real lo imponen el tope
 * diario y la separación mínima, que son las dos reglas que de verdad protegen
 * a la persona.
 */
export const CADA_N_TARJETAS = 7

export interface SenalesCadencia {
  /** ISO-8601, o null si nunca se le ha mostrado una. */
  ultimaMostradaEn: string | null
  mostradasHoy: number
  /** Índice de la tarjeta dentro de la página del feed. */
  posicionEnFeed: number
  /** ¿Ya votó o descartó la encuesta candidata? */
  yaVotoOMDescarto: boolean
}

export interface DecisionCadencia {
  mostrar: boolean
  /** Estable y en snake_case: se registra y se agrega, no se enseña. */
  motivo: string
}

const MS_POR_HORA = 3_600_000

/**
 * ¿Toca enseñar una encuesta ahora?
 *
 * PURA y determinista: mismas señales y mismo `ahora` → misma salida. El orden
 * de las comprobaciones va de la razón más definitiva a la más circunstancial,
 * para que el `motivo` sea el que de verdad explica la decisión.
 */
export function decidirMostrar(s: SenalesCadencia, ahora: Date = new Date()): DecisionCadencia {
  if (s.yaVotoOMDescarto) {
    return { mostrar: false, motivo: 'ya_respondida' }
  }

  if (s.mostradasHoy >= MAX_ENCUESTAS_DIA) {
    return { mostrar: false, motivo: 'tope_diario' }
  }

  if (s.posicionEnFeed < CADA_N_TARJETAS) {
    return { mostrar: false, motivo: 'demasiado_arriba' }
  }

  const ultima = instanteValido(s.ultimaMostradaEn)
  if (ultima !== null) {
    const horas = (ahora.getTime() - ultima) / MS_POR_HORA
    // El futuro también cuenta como "muy pronto": un `last_shown_at` adelantado
    // por un reloj desincronizado no debe abrir la puerta de par en par.
    if (horas < HORAS_ENTRE_ENCUESTAS) {
      return { mostrar: false, motivo: 'muy_pronto' }
    }
  }

  return { mostrar: true, motivo: 'ok' }
}

/**
 * Señales a partir de la fila de `poll_cadence`.
 *
 * También PURA. El reinicio del contador diario se hace aquí, comparando el
 * `day` guardado con el de `ahora`: sin esto, quien no abre la app en una
 * semana vuelve con `shown_today = 2` y no vería ninguna encuesta hasta que
 * algo escribiera esa fila — y lo único que la escribe es haber visto una.
 * El mismo cálculo lo repite `encuesta_siguiente()` en SQL al incrementar, con
 * `current_date`; aquí se replica para LEER, no para decidir la escritura.
 */
export function senalesDesdeFila(
  fila: FilaCadenciaMinima | null,
  posicionEnFeed: number,
  yaVotoOMDescarto: boolean,
  ahora: Date = new Date(),
): SenalesCadencia {
  const hoy = diaLocal(ahora)
  const mismoDia = fila !== null && fila.day === hoy

  return {
    ultimaMostradaEn: fila?.last_shown_at ?? null,
    mostradasHoy: mismoDia ? fila.shown_today : 0,
    posicionEnFeed,
    yaVotoOMDescarto,
  }
}

/** Lo mínimo que `senalesDesdeFila` necesita de `poll_cadence`. */
export interface FilaCadenciaMinima {
  last_shown_at: string | null
  shown_today: number
  day: string
}

/** `YYYY-MM-DD` en UTC, que es lo que compara `current_date` en la base. */
export function diaLocal(fecha: Date): string {
  return fecha.toISOString().slice(0, 10)
}

function instanteValido(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  // Una fecha ilegible se trata como "nunca". Bloquear por un dato corrupto
  // dejaría a alguien sin encuestas para siempre y sin ningún síntoma.
  return Number.isNaN(t) ? null : t
}
