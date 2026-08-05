// ============================================================================
// B21 · Presupuesto de cuota de la YouTube Data API, por corrida.
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ─────────────────────────────────────────────
// La Data API no cobra por petición: cobra por UNIDADES, y el precio varía dos
// órdenes de magnitud entre endpoints que devuelven casi lo mismo. `search.list`
// cuesta 100 unidades; `playlistItems.list`, 1. La cuota gratuita son 10.000
// unidades al día, y cuando se agota la API deja de contestar hasta el reset:
// no degrada, se apaga.
//
// Esto ya pasó, y no aquí. DataLaps (`lib/videoSyndication.ts`) tenía el frente
// de canales sobre `search.list`: ~52 canales + 12 búsquedas de texto al día,
// todo a 100 unidades = 6.400 en UNA corrida, con 429 real confirmado el
// 2026-07-29. La corrección fue doble —migrar los canales a
// `playlistItems.list` y topar las búsquedas— pero la lección que falta ahí, y
// que este archivo pone por escrito, es que NADIE llevaba la cuenta: el gasto se
// descubrió cuando la API dejó de responder. Un contador que solo se lee después
// del incidente es un contador que no sirve.
//
// ── LA DECISIÓN DE DISEÑO: SE CORTA ANTES, NO DESPUÉS ───────────────────────
// `puedeGastar()` se pregunta ANTES de la llamada y devuelve el motivo del corte;
// `intentarGastar()` cobra SOLO si la concede. No existe forma de gastar y
// enterarse luego. La diferencia no es estética: una corrida que descubre que se
// pasó ya ha dejado la cuota del día siguiente comprometida, y en Darma eso
// significa que `/animo` —la pantalla de quien todavía no se atreve a escribir—
// amanece sin contenido nuevo y nadie se entera hasta que alguien la abre.
//
// ── LA RESERVA DE VERIFICACIÓN ──────────────────────────────────────────────
// Descubrir un vídeo no basta para publicarlo: hay que verificarlo (idioma de
// audio real, identidad de canal, embebibilidad), y eso son llamadas a
// `videos.list`. Si el descubrimiento puede gastar hasta la última unidad, la
// corrida termina con una lista de candidatos que NO se pueden comprobar, y la
// única salida es publicar a ciegas o tirarlos. Por eso las operaciones de
// descubrimiento no pueden bajar del suelo `RESERVA_VERIFICACION`, que solo
// `videos.list` puede tocar. Descubrir de menos cuesta un vídeo; verificar de
// menos cuesta la confianza en el feed entero.
//
// ── LOS TOPES POR OPERACIÓN, ADEMÁS DEL PRESUPUESTO ─────────────────────────
// Dos controles y no uno, porque protegen de cosas distintas. El presupuesto en
// unidades protege la CUOTA. El tope por operación protege de que una sola vía
// se coma el presupuesto entero: sin él, tres búsquedas abiertas (300 unidades)
// dejarían fuera a los siete orígenes curados que cuestan 1 unidad cada uno, y
// el feed se llenaría de desconocidos mientras las fuentes revisadas a mano se
// quedan sin leer. El orden de preferencia del producto se codifica aquí.
//
// ── ALTERNATIVAS DESCARTADAS ────────────────────────────────────────────────
// · Contador en Postgres, como `ingest_consume_model_budget`. Es lo correcto
//   para el cupo DIARIO (sobrevive a los reinicios y a varias instancias) y
//   probablemente haga falta. No sustituye a este: una corrida necesita decidir
//   antes de CADA llamada, y un round-trip a la base por cada unidad de cuota
//   cuesta más tiempo del que ahorra. Anotado en el informe: el cupo diario
//   persistente es una pieza que este archivo no cubre a propósito.
// · Leer la cuota restante de la propia API. No existe ese endpoint; solo se
//   sabe que se agotó cuando devuelve 403 `quotaExceeded`. Enterarse por el
//   error es exactamente lo que se quiere evitar.
// · Contar peticiones en vez de unidades. Es la medida equivocada, y es
//   literalmente la que llevó al incidente: 64 peticiones parecen pocas hasta
//   que se sabe que 64 × 100 = 6.400 unidades.
//
// Este módulo es PURO y no importa nada: se prueba sin red, sin base de datos y
// sin reloj.
// ============================================================================

/** Los tres endpoints que este bloque puede llegar a llamar. Cerrada a propósito. */
export type OperacionCuota = 'playlistItems.list' | 'search.list' | 'videos.list'

/**
 * Precio en unidades de cada operación. Verificado contra la tabla oficial de
 * costes de la Data API v3 (developers.google.com/youtube/v3/determine_quota_cost).
 *
 * El 100 de `search.list` es el número entero de este archivo: es lo que hace
 * que una búsqueda abierta valga lo mismo que cien lecturas de playlist.
 */
export const COSTE_UNIDADES: Readonly<Record<OperacionCuota, number>> = {
  'playlistItems.list': 1,
  'search.list': 100,
  'videos.list': 1,
} as const

/** Cuota gratuita diaria de un proyecto de la Data API. No es configurable por nosotros. */
export const CUOTA_DIARIA = 10_000

/**
 * Corridas que se asume que puede haber en un día en el peor caso razonable: una
 * por hora. No es la cadencia prevista —el cron de vídeo va mucho más espaciado—
 * sino el escenario contra el que se dimensiona el presupuesto: un cron mal
 * configurado, un despliegue que dispara la ruta a mano o un reintento en bucle.
 */
export const CORRIDAS_MAX_POR_DIA = 24

/**
 * Presupuesto por corrida. 400 × 24 = 9.600 < 10.000: incluso con el cron
 * disparándose cada hora del día, la cuota diaria NO se agota. Ese es el
 * criterio con el que se eligió el número, y el test que lo comprueba es el que
 * se pondrá rojo si alguien lo sube «solo un poco».
 */
export const PRESUPUESTO_POR_CORRIDA = 400

/** Unidades que el descubrimiento no puede tocar. Ver «LA RESERVA» en la cabecera. */
export const RESERVA_VERIFICACION = 120

/**
 * Tope diario PERSISTENTE, en unidades. Es el número que aplica Postgres
 * (`ingest_reservar_cuota_youtube`, migración 0214) al principio de cada
 * corrida: el contador en memoria de este archivo protege UNA corrida, pero no
 * sobrevive ni a un reinicio ni a dos instancias — el techo de verdad tiene que
 * ser transaccional y compartido, igual que `ingest_model_budget` (0108).
 *
 * 6 × 400 = 2.400, y el reparto está elegido, no redondeado:
 *   · El cron real va cada 6 h (4 corridas/día a presupuesto completo) y las
 *     2 reservas restantes son margen para corridas manuales o el backfill.
 *   · Deja 7.600 de las 10.000 unidades diarias libres, porque HOY
 *     `YOUTUBE_API_KEY` es la MISMA clave que usa DataLaps (anotado en
 *     PEDIDOS.md): ya la agotó una vez (429 real, 2026-07-29) y Darma no debe
 *     poder dejarla a cero por su cuenta.
 * Además, lo que una corrida reserva y no gasta se DEVUELVE al terminar
 * (`ingest_devolver_cuota_youtube`), así que el gasto contable se pega al real.
 */
export const TOPE_DIARIO_PERSISTENTE = 6 * PRESUPUESTO_POR_CORRIDA

/**
 * Tope de LLAMADAS por operación y corrida.
 *
 * `search.list` a 2 no es timidez: son 200 de las 400 unidades del presupuesto,
 * la mitad, para una vía que devuelve vídeos de canales que nadie ha revisado.
 * Mientras no exista el clasificador (§5 de la ficha) esa cola la mira una
 * persona, y una cola que crece más rápido de lo que se revisa no es contenido:
 * es trabajo que nadie va a hacer.
 */
export const TOPE_LLAMADAS_POR_CORRIDA: Readonly<Record<OperacionCuota, number>> = {
  'playlistItems.list': 60,
  'search.list': 2,
  'videos.list': 120,
} as const

/**
 * Qué operaciones cuentan como VERIFICACIÓN y pueden entrar en la reserva.
 * `videos.list` es la única que responde «¿este vídeo sirve de verdad?»
 * (idioma de audio, canal propietario, embebible), y por eso es la única que
 * tiene derecho al colchón.
 */
export function esVerificacion(operacion: OperacionCuota): boolean {
  return operacion === 'videos.list'
}

/** Por qué se denegó un gasto. Identificadores estables: van a logs y a `ingest_log.reason`. */
export type MotivoCorteCuota = 'presupuesto_agotado' | 'tope_de_operacion' | 'reserva_de_verificacion'

/** Foto del contador. Se emite al terminar la corrida; es la señal de operación. */
export interface ResumenCuota {
  presupuesto: number
  reservaVerificacion: number
  gastadas: number
  restantes: number
  llamadas: Record<OperacionCuota, number>
  /** Cuántas veces se denegó por cada motivo. Un contador que sube es una alarma temprana. */
  cortes: Record<MotivoCorteCuota, number>
}

export interface ContadorCuota {
  /** ¿Se puede? `null` = sí. NO cobra nada: es la pregunta, no el gasto. */
  puedeGastar(operacion: OperacionCuota): MotivoCorteCuota | null
  /** Cobra si se puede. `null` = concedido y ya descontado; si no, el motivo del corte. */
  intentarGastar(operacion: OperacionCuota): MotivoCorteCuota | null
  gastadas(): number
  restantes(): number
  resumen(): ResumenCuota
}

export interface OpcionesCuota {
  presupuesto?: number
  reservaVerificacion?: number
  /** Sustituye topes concretos; los que no se nombren mantienen el valor por defecto. */
  topes?: Partial<Record<OperacionCuota, number>>
}

/**
 * Normaliza un número de configuración. Lo que no sea un entero finito y no
 * negativo se convierte en 0, NUNCA en «sin límite»: un presupuesto corrupto
 * (un `Number(process.env.X)` que dio NaN) debe dejar la corrida sin gastar, no
 * dejarla gastar sin freno. Fail-closed, igual que el cupo del modelo.
 */
function enteroNoNegativo(valor: number | undefined, porDefecto: number): number {
  if (valor === undefined) return porDefecto
  if (!Number.isFinite(valor) || valor < 0) return 0
  return Math.floor(valor)
}

/**
 * Crea el contador de UNA corrida. El estado vive en el cierre: no hay contador
 * global, y eso es deliberado — dos corridas solapadas (Vercel puede lanzar la
 * siguiente antes de que termine la anterior) deben tener cada una su
 * presupuesto, no compartir uno que ninguna de las dos controla.
 */
export function crearContadorCuota(opciones: OpcionesCuota = {}): ContadorCuota {
  const presupuesto = enteroNoNegativo(opciones.presupuesto, PRESUPUESTO_POR_CORRIDA)
  // La reserva nunca puede superar al presupuesto: si lo hiciera, el
  // descubrimiento quedaría bloqueado desde la primera llamada sin que nadie
  // entendiera por qué.
  const reserva = Math.min(enteroNoNegativo(opciones.reservaVerificacion, RESERVA_VERIFICACION), presupuesto)

  const topes: Record<OperacionCuota, number> = {
    'playlistItems.list': enteroNoNegativo(
      opciones.topes?.['playlistItems.list'],
      TOPE_LLAMADAS_POR_CORRIDA['playlistItems.list'],
    ),
    'search.list': enteroNoNegativo(opciones.topes?.['search.list'], TOPE_LLAMADAS_POR_CORRIDA['search.list']),
    'videos.list': enteroNoNegativo(opciones.topes?.['videos.list'], TOPE_LLAMADAS_POR_CORRIDA['videos.list']),
  }

  const llamadas: Record<OperacionCuota, number> = {
    'playlistItems.list': 0,
    'search.list': 0,
    'videos.list': 0,
  }
  const cortes: Record<MotivoCorteCuota, number> = {
    presupuesto_agotado: 0,
    tope_de_operacion: 0,
    reserva_de_verificacion: 0,
  }

  let gastadas = 0

  function puedeGastar(operacion: OperacionCuota): MotivoCorteCuota | null {
    // El tope se mira primero porque es el motivo más específico: decir
    // «presupuesto agotado» cuando lo que se acabó fueron las búsquedas mandaría
    // a quien depura a subir el presupuesto, que no arregla nada.
    if (llamadas[operacion] >= topes[operacion]) return 'tope_de_operacion'

    const coste = COSTE_UNIDADES[operacion]
    if (gastadas + coste > presupuesto) return 'presupuesto_agotado'
    if (!esVerificacion(operacion) && gastadas + coste > presupuesto - reserva) return 'reserva_de_verificacion'
    return null
  }

  return {
    puedeGastar,

    intentarGastar(operacion) {
      const motivo = puedeGastar(operacion)
      if (motivo) {
        cortes[motivo]++
        return motivo
      }
      // Se cobra ANTES de que la llamada salga. Cobrar después dejaría una
      // ventana en la que dos llamadas concurrentes ven el mismo saldo.
      gastadas += COSTE_UNIDADES[operacion]
      llamadas[operacion]++
      return null
    },

    gastadas: () => gastadas,
    restantes: () => Math.max(0, presupuesto - gastadas),

    resumen: () => ({
      presupuesto,
      reservaVerificacion: reserva,
      gastadas,
      restantes: Math.max(0, presupuesto - gastadas),
      llamadas: { ...llamadas },
      cortes: { ...cortes },
    }),
  }
}

/**
 * Cuántas unidades costaría un plan de llamadas. PURA.
 *
 * Existe para poder escribir el coste esperado de una estrategia en un test en
 * vez de en un comentario. El incidente de DataLaps cabe en una línea de
 * aritmética, y una línea de aritmética que nadie ejecuta es la que nadie
 * comprueba antes de desplegar.
 */
export function unidadesEstimadas(plan: Partial<Record<OperacionCuota, number>>): number {
  let total = 0
  for (const [operacion, coste] of Object.entries(COSTE_UNIDADES) as Array<[OperacionCuota, number]>) {
    const veces = plan[operacion]
    if (typeof veces === 'number' && Number.isFinite(veces) && veces > 0) total += Math.floor(veces) * coste
  }
  return total
}
