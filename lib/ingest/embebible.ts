// ============================================================================
// B08 · ¿Se puede REPRODUCIR este vídeo dentro de Darma? — sin gastar cuota.
//
// LA PREGUNTA CORRECTA. `videos.list` de la Data API contesta muchas cosas y
// cuesta cuota (10.000 unidades/día, que dos backfills se comen). oEmbed
// contesta exactamente la que importa —«¿me dejas incrustarlo?»— y NO consume
// cuota de la Data API. Un endpoint que se agota es un endpoint que un día
// dejará de contestar justo cuando el cron más corre.
//
// 🔴 `desconocido` NUNCA es `no_embebible`. Es la trampa nº 2 de la ficha y el
// motivo de que este tipo tenga cuatro valores y no un booleano:
//   · Si la red falla y lo llamamos «no embebible», archivamos contenido bueno
//     en silencio y nadie se entera nunca, porque el ítem desaparece sin ruido.
//   · Peor: en el barrido de reverificación, tratar un timeout como «el dueño lo
//     bloqueó» retiraría del feed vídeos vivos en cada hipo de red, y el feed se
//     vaciaría solo.
// Ante la duda, el ítem se queda `pending` (ingesta) o sigue `approved`
// (reverificación) y se vuelve a preguntar mañana.
//
// Esta función NUNCA lanza.
// ============================================================================

import type { ResultadoEmbed } from './tipos.ts'

const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed'

/** Timeout por intento. Sin él, una conexión colgada se come el presupuesto de la ejecución entera. */
export const TIMEOUT_SONDA_MS = 5_000

export interface OpcionesSonda {
  /** Inyectable: los tests NO hacen red. */
  fetchImpl?: typeof fetch
  /** Reintentos ADICIONALES al primer intento. */
  reintentos?: number
  /** Inyectable para no dormir de verdad en los tests. */
  esperarImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
}

/**
 * Pregunta por UN vídeo de YouTube.
 *
 * Reintenta lo que significa «ahora no» (429, 5xx, sin respuesta) con espera
 * creciente; no reintenta lo que es una respuesta firme (401/403 = bloqueado
 * por el dueño, 400/404 = no existe o es privado).
 */
export async function sondaEmbed(videoId: string, opciones: OpcionesSonda = {}): Promise<ResultadoEmbed> {
  const fetchFn = opciones.fetchImpl ?? globalThis.fetch
  const reintentos = opciones.reintentos ?? 2
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_SONDA_MS
  const esperar = opciones.esperarImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  if (!videoId || typeof fetchFn !== 'function') return 'desconocido'

  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    format: 'json',
  })
  const destino = `${OEMBED_ENDPOINT}?${params.toString()}`

  for (let intento = 0; intento <= reintentos; intento++) {
    let status: number | null = null

    // AbortController y no solo el timeout del runtime: en serverless una
    // petición sin cancelar mantiene viva la invocación hasta el techo de la
    // función, y el presupuesto de 45 s deja de significar nada.
    const control = new AbortController()
    const alarma = setTimeout(() => control.abort(), timeoutMs)
    try {
      const res = await fetchFn(destino, { signal: control.signal })
      status = typeof res?.status === 'number' ? res.status : null
    } catch {
      // Timeout, abort, DNS, red caída. Deliberadamente NO se registra el error:
      // el mensaje puede arrastrar la URL completa. Queda como 'desconocido'.
      status = null
    } finally {
      clearTimeout(alarma)
    }

    if (status === 200) return 'embebible'
    // El dueño bloqueó la reproducción fuera de YouTube.
    if (status === 401 || status === 403) return 'no_embebible'
    // No existe, es privado, o el id es inválido.
    if (status === 400 || status === 404) return 'ausente_o_privado'

    // 429 / 5xx / sin respuesta → «ahora no».
    if (intento < reintentos) await esperar(400 * (intento + 1))
  }

  return 'desconocido'
}

/**
 * Pregunta por muchos con concurrencia acotada.
 *
 * El límite existe por dos motivos, y los dos importan: el barrido corre dentro
 * de una función con 60 s de techo (secuencial sobre 200 vídeos no cabe), y
 * disparar 200 peticiones a la vez a YouTube se gana un 429 que convertiría
 * respuestas buenas en 'desconocido' — es decir, el atajo se castiga solo.
 */
export async function sondaEmbedVarios(
  videoIds: readonly string[],
  opciones: OpcionesSonda & { concurrencia?: number } = {},
): Promise<Map<string, ResultadoEmbed>> {
  const unicos = [...new Set(videoIds)]
  const salida = new Map<string, ResultadoEmbed>()
  const concurrencia = Math.max(1, Math.min(opciones.concurrencia ?? 6, unicos.length || 1))

  let siguiente = 0
  async function trabajador(): Promise<void> {
    for (;;) {
      const i = siguiente++
      if (i >= unicos.length) return
      salida.set(unicos[i], await sondaEmbed(unicos[i], opciones))
    }
  }

  await Promise.all(Array.from({ length: concurrencia }, trabajador))
  return salida
}
