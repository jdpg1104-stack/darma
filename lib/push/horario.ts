// ============================================================================
// B13 · Política antiadicción, escrita como código y no como propósito
//
// Todo lo de este archivo son CONSTANTES y una función pura. Es deliberado: una
// política que vive en un comentario se incumple sin que nadie se entere; una
// que vive en `decidirEnvio()` con pruebas alrededor se rompe en CI el día que
// alguien la relaje.
//
// ── LAS CUATRO REGLAS ──────────────────────────────────────────────────────
//  1. TECHO DURO. Máximo 4 avisos por persona y día para todo lo que no sea
//     `alma_afin_en_crisis`. Cuatro es un número escogido para que quepan los
//     avisos que importan de un día normal y no quepa nada más.
//  2. AGRUPACIÓN. Varios eventos del mismo tipo en 30 minutos se anuncian una
//     sola vez, agregados («3 personas te escucharon»). Tres vibraciones
//     seguidas por la misma cosa no informan mejor: solo enseñan a mirar el
//     móvil.
//  3. HORAS DE SILENCIO. 23:00–08:00 locales por defecto. Lo acumulado se
//     ENTREGA al terminar el silencio (`diferidoHasta`), no se descarta: perder
//     el aviso de que alguien te escuchó sería peor que darlo tarde.
//  4. LA CRISIS GANA SIEMPRE. `alma_afin_en_crisis` ignora techo, agrupación y
//     silencio. Alguien que puso «necesito hablar» a las 3 de la madrugada es
//     exactamente el caso para el que existe este bloque.
//
// ── LO QUE NO EXISTE Y NO PUEDE EXISTIR ────────────────────────────────────
// No hay ninguna constante de «recordatorio», «racha», «inactividad» ni
// «resumen semanal», y no es un olvido. Un aviso cuyo propósito sea reabrir la
// app sin que haya pasado nada dirigido a esta persona no cabe en el tipo
// `TipoNotificacion` (preferencias.ts) ni en las plantillas (plantillas.ts), y
// hay una prueba que recorre las dos cosas buscando ese vocabulario.
//
// ── DÓNDE SE TOMA LA DECISIÓN ──────────────────────────────────────────────
// AQUÍ, en el servidor. Nunca dentro del service worker: si el navegador recibe
// un evento `push` y no muestra ninguna notificación, Chrome cuenta un «push
// silencioso» y tras unos pocos REVOCA el permiso del origen. Si un aviso está
// agrupado o cae en horas de silencio, simplemente no se envía.
// ============================================================================

import { estaActivo, type Preferencias, type TipoNotificacion } from './preferencias.ts'

/** Techo diario para todo lo que no es crisis. */
export const TECHO_DIARIO = 4

/** Ventana de agrupación: dos eventos del mismo tipo dentro de esto → uno solo. */
export const VENTANA_AGRUPACION_MS = 30 * 60 * 1000

/** Inicio del silencio por defecto: 23:00 locales, en minutos desde medianoche. */
export const SILENCIO_DESDE_POR_DEFECTO = 23 * 60
/** Fin del silencio por defecto: 08:00 locales. */
export const SILENCIO_HASTA_POR_DEFECTO = 8 * 60

const MINUTOS_POR_DIA = 24 * 60
const MS_POR_MINUTO = 60_000

/**
 * El único tipo que se salta la política entera. Se declara como constante
 * exportada para que las pruebas puedan afirmar sobre ella y para que quien
 * lea el `if` de abajo vea el nombre y no un literal suelto.
 */
export const TIPO_EXENTO: TipoNotificacion = 'alma_afin_en_crisis'

export interface DecisionEnvio {
  enviar: boolean
  /** `null` cuando `enviar` es true. */
  motivo: 'silencio' | 'techo' | 'agrupado' | 'desactivado' | null
  /** ISO-8601 cuando se difiere al final de las horas de silencio. */
  diferidoHasta: string | null
}

export interface ArgumentosDecision {
  tipo: TipoNotificacion
  prefs: Preferencias
  /** Minutos desde medianoche LOCAL. `null` ⇒ el default (23:00). */
  quietFrom: number | null
  /** Minutos desde medianoche LOCAL. `null` ⇒ el default (08:00). */
  quietTo: number | null
  /** Desfase de la persona en minutos (+120 = UTC+2). Nunca la zona con nombre. */
  tzOffset: number
  /** Avisos no exentos ya entregados hoy. Lo cuenta `check_rate_limit`. */
  enviadosHoy: number
  /** Epoch ms del último aviso de ESTE tipo, o `null` si no hubo. */
  ultimoDelTipoMs: number | null
  ahora?: Date
}

/** Minutos desde medianoche en la hora local de la persona. */
function minutosLocales(ahora: Date, tzOffset: number): number {
  const utc = ahora.getUTCHours() * 60 + ahora.getUTCMinutes()
  // El `+ MINUTOS_POR_DIA` cubre los desfases negativos: sin él, `-1 % 1440`
  // es `-1` en JavaScript y la ventana de silencio se calcularía al revés.
  return (((utc + tzOffset) % MINUTOS_POR_DIA) + MINUTOS_POR_DIA) % MINUTOS_POR_DIA
}

/**
 * ¿Está `minuto` dentro de [desde, hasta)?
 *
 * La ventana NORMAL de silencio cruza la medianoche (23:00 → 08:00), así que el
 * caso envolvente no es el raro: es el habitual. Escribirlo como `desde <= m &&
 * m < hasta` habría dejado el silencio nocturno sin efecto justo entre las 23 y
 * las 24, que es cuando más falta hace.
 */
function dentroDeVentana(minuto: number, desde: number, hasta: number): boolean {
  if (desde === hasta) return false // ventana vacía = sin silencio
  return desde < hasta
    ? minuto >= desde && minuto < hasta
    : minuto >= desde || minuto < hasta
}

/** Instante UTC del próximo `minutoLocal` a partir de `ahora`. */
function proximoInstanteLocal(ahora: Date, tzOffset: number, minutoLocal: number): Date {
  const actual = minutosLocales(ahora, tzOffset)
  let faltan = minutoLocal - actual
  if (faltan <= 0) faltan += MINUTOS_POR_DIA

  // Se parte del minuto en curso (segundos y ms a cero) para que el diferido
  // caiga exactamente en la hora de fin del silencio y no unos segundos después.
  const base = ahora.getTime() - (ahora.getUTCSeconds() * 1000 + ahora.getUTCMilliseconds())
  return new Date(base + faltan * MS_POR_MINUTO)
}

/**
 * Decide si un aviso sale ahora, se calla, o se difiere.
 *
 * Función PURA: mismo argumento, misma respuesta. Todo el estado (cuántos van
 * hoy, cuándo fue el último del tipo) entra por parámetro, y por eso las nueve
 * pruebas de esta política no necesitan base de datos ni reloj falso global.
 *
 * ORDEN DE LAS COMPROBACIONES, que sí importa:
 *   crisis → desactivado → silencio → techo → agrupación.
 * «Desactivado» va antes que «silencio» porque quien apagó un tipo no está en
 * silencio: es que no lo quiere, y el motivo que se registra debe decir eso.
 */
export function decidirEnvio(args: ArgumentosDecision): DecisionEnvio {
  const ahora = args.ahora ?? new Date()

  // ── 1. LA CRISIS GANA SIEMPRE ─────────────────────────────────────────────
  // Ignora techo, agrupación y horas de silencio, sin excepción.
  //
  // ⚠️ DESVIACIÓN CONSCIENTE DEL CONTRATO DE LA FICHA, anotada en PEDIDOS.md:
  // la ficha dice «devuelve SIEMPRE {enviar:true}». Aquí se respeta UNA sola
  // cosa capaz de pararlo: que esa persona haya apagado EXPLÍCITAMENTE
  // `alma_afin_en_crisis` en sus preferencias. Sostener lo contrario sería
  // enviar notificaciones a alguien que dijo que no las quiere, y hacerlo de
  // madrugada — que es la única forma de que este bloque acabe siendo el
  // problema en vez de la solución. Quien no ha tocado nada tiene el tipo en ON
  // por defecto, así que el camino normal es el de la ficha.
  if (args.tipo === TIPO_EXENTO) {
    return estaActivo(args.prefs, TIPO_EXENTO)
      ? { enviar: true, motivo: null, diferidoHasta: null }
      : { enviar: false, motivo: 'desactivado', diferidoHasta: null }
  }

  // ── 2. ¿Lo quiere? ────────────────────────────────────────────────────────
  if (!estaActivo(args.prefs, args.tipo)) {
    return { enviar: false, motivo: 'desactivado', diferidoHasta: null }
  }

  // ── 3. Horas de silencio ──────────────────────────────────────────────────
  const desde = args.quietFrom ?? SILENCIO_DESDE_POR_DEFECTO
  const hasta = args.quietTo ?? SILENCIO_HASTA_POR_DEFECTO
  if (dentroDeVentana(minutosLocales(ahora, args.tzOffset), desde, hasta)) {
    return {
      enviar: false,
      motivo: 'silencio',
      // No se descarta: se entrega al terminar el silencio.
      diferidoHasta: proximoInstanteLocal(ahora, args.tzOffset, hasta).toISOString(),
    }
  }

  // ── 4. Techo duro ─────────────────────────────────────────────────────────
  if (args.enviadosHoy >= TECHO_DIARIO) {
    return { enviar: false, motivo: 'techo', diferidoHasta: null }
  }

  // ── 5. Agrupación ─────────────────────────────────────────────────────────
  // Lo acumulado no se pierde: sale en el siguiente aviso del tipo, agregado
  // (`push_dispatch_state.pendientes` en la migración 0131).
  if (
    args.ultimoDelTipoMs !== null &&
    ahora.getTime() - args.ultimoDelTipoMs < VENTANA_AGRUPACION_MS
  ) {
    return { enviar: false, motivo: 'agrupado', diferidoHasta: null }
  }

  return { enviar: true, motivo: null, diferidoHasta: null }
}
