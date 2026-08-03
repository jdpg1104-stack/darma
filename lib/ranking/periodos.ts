// ============================================================================
// B06 · Periodos de CALENDARIO con reloj de negocio fijo (Europe/Madrid)
//
// ── POR QUÉ CALENDARIO Y NO VENTANA RODANTE ────────────────────────────────
// Una ventana rodante de 7 días no se reinicia nunca. El efecto de producto es
// que el tablero deja de ser una competición que cualquiera puede ganar ESTA
// semana y se convierte en una lista de veteranos: quien lleva meses arriba
// sigue arriba, porque su ventana siempre arrastra un buen tramo. Y rompe el
// movimiento: sin «periodo anterior» no hay `prev_rank` que comparar.
//
// ── POR QUÉ UN RELOJ FIJO Y NO EL DEL NAVEGADOR ────────────────────────────
// Si el corte dependiera de la zona de cada persona, la semana empezaría a
// horas distintas para cada una y el mismo comentario contaría en semanas
// diferentes según quién mire. Peor: alguien podría ganar horas de ventaja
// cambiándose la zona horaria del dispositivo. Un instante que todo el mundo
// comparte es lo que hace que el tablero sea comparable.
//
// ── POR QUÉ FUNCIONES PURAS CON `ahora` INYECTABLE ─────────────────────────
// Es lo que hace que probar el cambio de mes y los dos cambios de hora sea
// trivial en vez de imposible. Ninguna función de este archivo lee el reloj por
// su cuenta salvo por el valor por defecto del parámetro.
//
// ── CÓMO SE HACE LA CONVERSIÓN DE ZONA SIN DEPENDENCIAS ────────────────────
// `Intl.DateTimeFormat` con `timeZone: 'Europe/Madrid'` da la fecha CIVIL de
// Madrid para un instante. A partir de ahí toda la aritmética se hace sobre
// fecha civil (año, mes, día), no sobre instantes: restar días a un
// `2026-03-30` es siempre restar días, pase lo que pase con el horario de
// verano. Sumar milisegundos a un `Date` sería lo que se rompe en la madrugada
// del último domingo de marzo, cuando el día tiene 23 horas.
// ============================================================================

import { esPeriodo, type PeriodoRanking } from './tipos.ts'

/** El reloj de negocio de Darma. Único, fijo y escrito una sola vez. */
export const ZONA_NEGOCIO = 'Europe/Madrid'

/**
 * Corte del periodo `historico`.
 *
 * El histórico no se reinicia, pero `ranking_snapshots.period_start` es
 * `not null` y forma parte de la PK, así que necesita un valor. Se usa una
 * fecha centinela anterior a cualquier dato posible en vez de, por ejemplo, la
 * fecha de lanzamiento: una constante que no hay que actualizar nunca no se
 * puede quedar obsoleta.
 */
export const INICIO_HISTORICO = '1970-01-01'

/** Partes de la fecha civil en la zona de negocio. */
interface FechaCivil {
  anio: number
  mes: number
  /** 1–31 */
  dia: number
  /** 1 = lunes … 7 = domingo (ISO). */
  diaSemana: number
}

// Un único formateador reutilizado: construir un `Intl.DateTimeFormat` cuesta
// bastante más que usarlo, y esto se llama en cada render del tablero.
const FORMATEADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})

const DIAS_ISO: Readonly<Record<string, number>> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

/**
 * Fecha civil de Madrid para un instante dado.
 *
 * Exportada porque el constructor del snapshot y los tests la necesitan, y
 * porque tenerla suelta evita que alguien recree la conversión a mano en otro
 * archivo con `getDay()` —que es la hora LOCAL DEL SERVIDOR, y en Vercel el
 * servidor está en UTC—.
 */
export function fechaCivil(instante: Date): FechaCivil {
  if (Number.isNaN(instante.getTime())) {
    throw new RangeError('[darma][ranking] instante inválido')
  }

  const partes = FORMATEADOR.formatToParts(instante)
  const buscar = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? ''

  const diaSemana = DIAS_ISO[buscar('weekday')]
  if (diaSemana === undefined) {
    throw new RangeError('[darma][ranking] no se pudo resolver el día de la semana')
  }

  return {
    anio: Number(buscar('year')),
    mes: Number(buscar('month')),
    dia: Number(buscar('day')),
    diaSemana,
  }
}

/** `YYYY-MM-DD` a partir de año, mes y día civiles. */
function aIso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Suma (o resta) días a una fecha civil, devolviendo `YYYY-MM-DD`.
 *
 * Se apoya en `Date.UTC`, que no tiene horario de verano: aquí no se está
 * manipulando un instante, sino contando casillas de calendario. Es
 * precisamente por eso que el resultado es correcto también en los dos días del
 * año en que Madrid tiene 23 o 25 horas.
 */
function sumarDias(anio: number, mes: number, dia: number, delta: number): string {
  const t = Date.UTC(anio, mes - 1, dia) + delta * 86_400_000
  const d = new Date(t)
  return aIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/**
 * Inicio del periodo en curso, como fecha ISO-8601 (`YYYY-MM-DD`).
 *
 *  · `semana`    → el LUNES de esa semana en Madrid.
 *  · `mes`       → el día 1 de ese mes en Madrid.
 *  · `historico` → la centinela; el histórico no tiene inicio.
 */
export function inicioPeriodo(periodo: PeriodoRanking, ahora: Date = new Date()): string {
  if (!esPeriodo(periodo)) {
    throw new RangeError('[darma][ranking] periodo desconocido')
  }
  if (periodo === 'historico') return INICIO_HISTORICO

  const { anio, mes, dia, diaSemana } = fechaCivil(ahora)

  if (periodo === 'mes') return aIso(anio, mes, 1)

  // ISO: lunes = 1. El domingo a las 23:59 de Madrid sigue perteneciendo a la
  // semana que empezó el lunes anterior, y por eso el desplazamiento es
  // `diaSemana − 1` y no «el lunes más cercano».
  return sumarDias(anio, mes, dia, -(diaSemana - 1))
}

/**
 * Inicio del periodo ANTERIOR, o `null` si no lo hay.
 *
 * Es lo que da sentido a `prev_rank`. La razón de que no sea «restar 7 días» ni
 * «restar 30 días» es el mes: el 1 de marzo, el periodo anterior es el 1 de
 * FEBRERO, y febrero no tiene 30 días — ni siquiera siempre los mismos. Se
 * calcula sobre el calendario, que es donde vive la respuesta correcta.
 */
export function inicioPeriodoAnterior(
  periodo: PeriodoRanking,
  ahora: Date = new Date(),
): string | null {
  if (!esPeriodo(periodo)) {
    throw new RangeError('[darma][ranking] periodo desconocido')
  }
  // El histórico no se reinicia: no hay corte anterior con el que comparar, y
  // por eso el movimiento allí es siempre `null`.
  if (periodo === 'historico') return null

  const inicio = inicioPeriodo(periodo, ahora)
  const [anio, mes, dia] = inicio.split('-').map(Number) as [number, number, number]

  if (periodo === 'semana') return sumarDias(anio, mes, dia, -7)

  return mes === 1 ? aIso(anio - 1, 12, 1) : aIso(anio, mes - 1, 1)
}

/**
 * Fin EXCLUSIVO de la ventana del periodo (`day < fin`), o `null` si es abierta.
 *
 * El constructor necesita cerrar la ventana cuando se reconstruye un corte
 * PASADO a mano: sin el límite superior, reconstruir «la semana del 2 de marzo»
 * sumaría también todo lo que ha pasado desde entonces.
 */
export function finPeriodo(periodo: PeriodoRanking, corte: string): string | null {
  if (periodo === 'historico') return null

  const [anio, mes, dia] = corte.split('-').map(Number) as [number, number, number]

  if (periodo === 'semana') return sumarDias(anio, mes, dia, 7)

  return mes === 12 ? aIso(anio + 1, 1, 1) : aIso(anio, mes + 1, 1)
}

/**
 * El corte inmediatamente anterior a uno DADO (no al de ahora).
 *
 * Es lo que usa la reconstrucción manual de un corte pasado para resolver su
 * `prev_rank`: reutilizar `inicioPeriodoAnterior(periodo)` allí compararía
 * contra el periodo anterior a HOY, y el tablero de marzo saldría con el
 * movimiento respecto a agosto.
 */
export function corteAnteriorDe(periodo: PeriodoRanking, corte: string): string | null {
  if (periodo === 'historico') return null

  const [anio, mes, dia] = corte.split('-').map(Number) as [number, number, number]

  if (periodo === 'semana') return sumarDias(anio, mes, dia, -7)

  return mes === 1 ? aIso(anio - 1, 12, 1) : aIso(anio, mes - 1, 1)
}

/** `YYYY-MM-DD` estricto. Valida el `corte` que llega por el body del cron. */
export function esFechaIso(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false

  const [anio, mes, dia] = valor.split('-').map(Number) as [number, number, number]
  const d = new Date(Date.UTC(anio, mes - 1, dia))

  // Roundtrip: descarta el 2026-02-31, que pasa la expresión regular y no
  // existe. Una fecha inexistente en el corte produciría una foto vacía sin que
  // nada lo señalara.
  return (
    d.getUTCFullYear() === anio && d.getUTCMonth() + 1 === mes && d.getUTCDate() === dia
  )
}
