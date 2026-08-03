// ============================================================================
// SSOT de los límites de una encuesta.
//
// Cada número de aquí es el ESPEJO EXACTO de un CHECK de Postgres. El orden de
// autoridad no se negocia (ARCHITECTURE §0): manda el SQL, y esto es la copia
// que permite que el cliente avise antes de enviar en vez de recibir un 422
// críptico. Si alguna vez discrepan, el que está mal es este archivo.
//
// Están aquí y no tecleados dentro de cada zod porque el mismo límite lo
// necesitan la validación del servidor, la del cliente y el contador de
// caracteres de la tarjeta. Tres copias de "200" es una copia que alguien
// actualizará y dos que no.
// ============================================================================

/** `polls.question`: `check (char_length(question) between 5 and 200)`. */
export const PREGUNTA_MIN = 5
export const PREGUNTA_MAX = 200

/** `poll_options.label`: `check (char_length(label) between 1 and 80)`. */
export const OPCION_MIN = 1
export const OPCION_MAX = 80

/** `poll_bank.options`: `check (array_length(options, 1) between 2 and 5)`. */
export const OPCIONES_MIN = 2
export const OPCIONES_MAX = 5

/** `poll_options.ordinal`: `check (ordinal between 0 and 9)`. */
export const ORDINAL_MIN = 0
export const ORDINAL_MAX = 9

/**
 * `polls.min_reveal` por defecto. Por debajo de este número de votos NO se
 * publica ningún porcentaje.
 *
 * El valor real de cada encuesta vive en su fila y lo aplica
 * `encuesta_resultados()` DENTRO de Postgres; esta constante es solo el valor
 * que documentamos y con el que se prueban las funciones puras. La UI nunca
 * decide si revelar: recibe `revelado` ya resuelto.
 */
export const MIN_REVELACION_POR_DEFECTO = 5

/**
 * Tope de `posicion` aceptado en `GET /api/polls/siguiente`.
 *
 * No es un límite de producto sino de coste: `posicion` viene del cliente y solo
 * alimenta una comparación. Aceptar `2**53` no rompería nada, pero aceptar
 * cualquier entero significa aceptar cualquier cadena que zod tenga que coercer,
 * y un rango cerrado deja el fallo donde se ve.
 */
export const POSICION_MAX = 10_000

// ── Límites de petición (ficha B09, §Seguridad) ─────────────────────────────
// Juntos y no repartidos por las rutas: un límite solo se entiende en relación
// con los demás. `siguiente` es generoso porque el feed lo llama al scrollear;
// `voto` y `descartar` son acciones humanas y 20/min ya es velocidad de bot.
export const LIMITES_PETICION = {
  siguiente: { limite: 60, ventanaSegundos: 60 },
  voto: { limite: 20, ventanaSegundos: 60 },
  descartar: { limite: 20, ventanaSegundos: 60 },
  resultados: { limite: 60, ventanaSegundos: 60 },
  /** Global, no por usuario: el cron no tiene sesión. */
  reponer: { limite: 2, ventanaSegundos: 60 },
} as const
