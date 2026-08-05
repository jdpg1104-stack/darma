// ============================================================================
// El historial reciente de quien escucha — lo que alimenta `self_repetition`
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
// `lib/moderation.ts` sabe detectar la plantilla desde el primer día: compara
// el comentario nuevo con `previousByAuthor` y, si se parece demasiado a algo
// que esa misma persona ya escribió, dispara `self_repetition`. Esa señal
// llevaba desde entonces apagada por una razón tonta y cara: nadie le pasaba
// los comentarios anteriores, así que la lista siempre llegaba vacía y el
// bucle no comparaba con nada.
//
// El agujero que deja: el MISMO texto pegado en 12 posts distintos pasa las 12
// veces y cobra 12 veces karma. `0213` cerró el farmeo por PERSONA —escuchar
// tres veces a la misma no da tres créditos—, pero pegar la misma plantilla a
// doce personas distintas seguía siendo doce escuchas de pleno derecho. Doce
// personas que abrieron una respuesta y encontraron un copia y pega.
//
// Esta consulta es lo único que faltaba. No decide nada: solo le da a la
// heurística los datos con los que ya sabía trabajar.
//
// ── DECISIÓN 1 · CUÁNTOS COMENTARIOS SE TRAEN (20) ─────────────────────────
// Esto corre en el camino caliente de comentar, que es el acto central de la
// app: lo que cueste aquí lo paga TODO el mundo para cazar a unos pocos. El
// coste dominante no es comparar (Jaccard sobre bigramas es lineal y son
// microsegundos), es el transporte: cada fila trae un `body` de hasta 4000
// caracteres.
//
// 20 es donde se cruzan las dos curvas:
//   · Por arriba: 200 filas serían hasta ~800 KB por comentario publicado, y un
//     comentario típico ronda los 300 caracteres, así que 20 se queda en unos
//     6 KB reales. Diez veces más filas no cazan diez veces más plantillas —
//     cazan las mismas, porque quien pega una plantilla la pega SEGUIDO.
//   · Por abajo: 5 bastaría para el pegador en serie, pero cae ante la rotación
//     de tres o cuatro textos alternos, que es la evasión obvia en cuanto
//     alguien nota el filtro. Con 20, evadir exige mantener veintiuna
//     plantillas distintas y buenas en rotación — y escribir veintiún textos
//     distintos y sinceros ES el comportamiento que la red quiere. El filtro no
//     tiene que ser inevadible; tiene que hacer que evadirlo cueste más que
//     portarse bien.
//
// ── DECISIÓN 2 · QUÉ VENTANA (30 DÍAS, ADEMÁS DEL LÍMITE) ──────────────────
// Las dos cosas a la vez, y cada una tapa lo que la otra deja:
//   · Solo «los últimos 20» castigaría a quien escribe poco: alguien que lleva
//     un año acompañando y comenta una vez al mes se estaría comparando con lo
//     que escribió hace año y medio. Repetir una frase que te sirvió hace un
//     año no es farmear, es tener una manera de hablar. Y el mensaje
//     («ya has escrito algo casi idéntico antes») sería incontestable: nadie
//     recuerda lo que escribió en marzo.
//   · Solo «los últimos 30 días» dejaría la consulta sin techo: quien comenta
//     cincuenta veces al día traería cincuenta filas justo cuando más caro es.
//
// 30 días es el mismo criterio que ya usa `ventana_credito_repetido()` de 0213
// para el crédito por persona. No es una dependencia —si aquella cambia, esta
// no tiene por qué—, es que la app ya tiene una noción de «reciente» en materia
// de antifarmeo y tener dos sería tener dos verdades. Dentro de esa ventana, un
// 0,6 de Jaccard sobre bigramas es prácticamente una copia: quien la dispara
// reconoce el texto al leerlo.
//
// ── DECISIÓN 3 · QUÉ PASA SI LA CONSULTA FALLA ─────────────────────────────
// Mismo patrón que `lib/ingest/embebible.ts`: «no pude» es un estado propio y
// NUNCA se colapsa a «no». Por eso esta función devuelve `estado` y no una
// lista a secas, y por eso no lanza nunca.
//
//   · Un fallo de base de datos NO rechaza el comentario. Si un timeout de
//     Postgres pudiera invalidar una escucha sincera, la app le estaría
//     diciendo «esto no cuenta» a alguien que hizo justo lo que se le pidió, y
//     por un motivo que no es suyo. Las demás señales (longitud, relleno, eco)
//     siguen aplicándose: se valida con la información que sí hay.
//   · Tampoco es vía libre SILENCIOSA: queda un `console.warn` con prefijo
//     estable en la ruta, así que un pico de estos fallos se ve. Un filtro
//     antifarmeo que se apaga sin ruido es peor que no tenerlo, porque se
//     confía en él.
//   · Lo que NO se hace: contárselo a quien comenta. «No pudimos comprobar tu
//     historial» es exactamente el aviso que le enseña a alguien que durante
//     una caída la plantilla pasa. Y tampoco se escribe en `moderation_flags`:
//     esa cola señala a PERSONAS, y aquí quien ha fallado es el sistema.
//
// ── CLIENTE ────────────────────────────────────────────────────────────────
// Se llama con el cliente RLS (CONTRATOS §6). La política `comments_read` solo
// deja ver los comentarios `state = 'active'`, así que no se filtra `state` a
// mano: sería repetir la política. Consecuencia conocida y anotada: retirar tu
// propio comentario borra su huella para esta señal.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Cuántos comentarios anteriores entran en la comparación. Ver decisión 1. */
export const MAX_PREVIOS_AUTOR = 20

/** Antigüedad máxima de un comentario para que cuente. Ver decisión 2. */
export const VENTANA_PREVIOS_DIAS = 30

export const VENTANA_PREVIOS_MS = VENTANA_PREVIOS_DIAS * 24 * 60 * 60 * 1000

/**
 * `consultado` = la base contestó (aunque sea con cero filas: esa persona no
 * tiene historial reciente, que es un hecho, no una duda).
 * `no_disponible` = no se pudo preguntar. NO significa «no hay plantilla».
 */
export type EstadoHistorial = 'consultado' | 'no_disponible'

export interface HistorialAutor {
  estado: EstadoHistorial
  /** Cuerpos, del más reciente al más antiguo. Vacío si `no_disponible`. */
  previos: readonly string[]
  /** Código del fallo, SOLO para el log. `null` cuando se pudo consultar. */
  codigo: string | null
}

export interface OpcionesHistorial {
  /** Siempre de la sesión, nunca del body (CONTRATOS §6). */
  autorId: string
  /** Inyectable para que los tests fijen la ventana sin depender del reloj. */
  ahora?: Date
}

/** Solo se pide `body`: ni el id, ni la fecha, ni el post. Nada más hace falta. */
interface FilaCuerpo {
  body: string | null
}

/** Código de un error de PostgREST o de red, sin arrastrar mensaje ni SQL. */
function codigoDe(causa: unknown): string {
  if (typeof causa === 'object' && causa !== null) {
    const codigo = (causa as { code?: unknown }).code
    if (codigo != null && codigo !== '') return String(codigo)
  }
  return 'desconocido'
}

/**
 * Últimos comentarios VALIDADOS de esta persona dentro de la ventana.
 *
 * `is_validated` no es un detalle: lo que se busca es texto que YA cobró. Un
 * comentario que no pasó el filtro no pagó nada y no tiene por qué condenar al
 * siguiente. Además es lo que hace que la consulta caiga entera dentro de
 * `idx_comments_credito_repetido` —`(author_id, created_at desc) where
 * is_validated`, de 0213— sin necesidad de un índice nuevo.
 *
 * El comentario que se está evaluando no puede colarse en el resultado: cuando
 * esto se consulta todavía no existe, y aunque existiera nacería con
 * `is_validated = false` (0004 ni siquiera deja escribir esa columna desde la
 * ruta).
 *
 * NUNCA LANZA. Ver decisión 3 en la cabecera.
 */
export async function leerPreviosDelAutor(
  supabase: SupabaseClient,
  opciones: OpcionesHistorial,
): Promise<HistorialAutor> {
  const ahora = opciones.ahora ?? new Date()
  const desde = new Date(ahora.getTime() - VENTANA_PREVIOS_MS).toISOString()

  try {
    const { data, error } = await supabase
      .from('comments')
      .select('body')
      .eq('author_id', opciones.autorId)
      .eq('is_validated', true)
      .gt('created_at', desde)
      // El mismo par que ordena el índice parcial de 0213. Si alguna vez dejan
      // de coincidir, esto pasa a ser un recorrido por todo el historial de la
      // persona en el camino caliente de comentar.
      .order('created_at', { ascending: false })
      .limit(MAX_PREVIOS_AUTOR)

    if (error) return { estado: 'no_disponible', previos: [], codigo: codigoDe(error) }

    const filas = (data ?? []) as unknown as readonly FilaCuerpo[]
    const previos = filas
      .map((fila) => fila.body)
      .filter((cuerpo): cuerpo is string => typeof cuerpo === 'string' && cuerpo.trim() !== '')

    return { estado: 'consultado', previos, codigo: null }
  } catch (causa) {
    // Red caída, cliente mal construido, respuesta ilegible. Da igual cuál:
    // desde aquí no se distingue, y ninguno de ellos es motivo para negarle la
    // validación a nadie.
    return { estado: 'no_disponible', previos: [], codigo: codigoDe(causa) }
  }
}
