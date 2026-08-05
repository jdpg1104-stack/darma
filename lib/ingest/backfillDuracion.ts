// ============================================================================
// B21 · Backfill de `duration_seconds` para el catálogo YA ingerido.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
// El feed Atom no trae duración, así que los 26 vídeos aprobados de la primera
// ingesta real tienen `duration_seconds` NULL. La acreditación de escucha
// (lib/video/acreditacion.ts y la RPC de 0107) asume 60 s cuando falta el dato:
// el +1 se concede a los ~54 s de CUALQUIER vídeo, dure 40 segundos o una hora.
// La ingesta nueva ya captura la duración en la misma llamada `videos.list` de
// las guardas (metadatosVideo.ts); este módulo cierra el hueco del catálogo
// existente.
//
// ── LAS TRES PROPIEDADES QUE PROMETE ────────────────────────────────────────
//   · IDEMPOTENTE. Solo selecciona filas con `duration_seconds IS NULL` y el
//     almacén solo escribe sobre NULL (`guardarDuracion`): ejecutarlo dos veces
//     no reescribe nada, y un corte a mitad se retoma solo — las filas ya
//     rellenadas desaparecen de la consulta.
//   · RESPETA LA CUOTA. Cada `videos.list` pasa por el MISMO contador de
//     `cuota.ts` que usa la ingesta, alimentado por el cupo diario persistente
//     de Postgres. El corte llega ANTES de la llamada, nunca después, y el
//     sobrante se devuelve al terminar.
//   · NUNCA INVENTA. Si la API no da duración interpretable, la fila queda
//     NULL y la acreditación sigue con su supuesto conservador de 60 s. Un dato
//     que no consta se declara ausente — la regla de los 24 teléfonos.
//
// La función vive en lib/ y no en el script para poder probarla sin red y sin
// base de datos (mismo reparto que ejecutarIngesta / ingesta-manual.ts).
// ============================================================================

import type { AlmacenIngesta } from './almacen.ts'
import { crearAlmacenSupabase } from './almacen.ts'
import {
  crearContadorCuota,
  PRESUPUESTO_POR_CORRIDA,
  TOPE_DIARIO_PERSISTENTE,
  type ContadorCuota,
} from './cuota.ts'
import { crearConsultaMetadatos, type OpcionesMetadatos } from './metadatosVideo.ts'

/** Lo único que el backfill necesita del almacén. Acotado para que el doble de test sea pequeño. */
export type AlmacenBackfill = Pick<
  AlmacenIngesta,
  'videosSinDuracion' | 'guardarDuracion' | 'reservarCuotaYoutube' | 'devolverCuotaYoutube'
>

/** Tope de vídeos por ejecución. 200 cubre 7× el catálogo actual y cabe de sobra en una reserva. */
export const MAX_VIDEOS_BACKFILL = 200

/** Tamaño de página del keyset. */
export const PAGINA_BACKFILL = 50

export interface OpcionesBackfill {
  almacen?: AlmacenBackfill
  /** Clave y fetch de `videos.list`. Inyectable: los tests NO hacen red. */
  metadatos?: OpcionesMetadatos
  /** Contador propio (tests). Sin él se reserva del cupo diario persistente. */
  cuota?: ContadorCuota
  maxVideos?: number
}

export interface ResultadoBackfill {
  /** `true` = no había clave de API: no se tocó ni la red ni el cupo. */
  sinClave: boolean
  vistos: number
  escritos: number
  /** La API contestó pero sin duración interpretable (directos, campos vacíos). */
  sinDuracion: number
  /** `videos.list` no contestó: red caída, vídeo borrado, 403. Se reintenta en la siguiente ejecución. */
  sinRespuesta: number
  /** Cortes del contador de cuota. Si es > 0, la ejecución paró ANTES de agotar. */
  cortesCuota: number
}

function resultadoVacio(sinClave: boolean): ResultadoBackfill {
  return { sinClave, vistos: 0, escritos: 0, sinDuracion: 0, sinRespuesta: 0, cortesCuota: 0 }
}

/**
 * Rellena `duration_seconds` de los vídeos que lo tienen NULL. Ver cabecera.
 * NUNCA lanza por un vídeo concreto: un id roto no impide rellenar el resto.
 */
export async function backfillDuracion(opciones: OpcionesBackfill = {}): Promise<ResultadoBackfill> {
  // Sin clave se sale ANTES de reservar cuota o consultar filas: reservar un
  // presupuesto que ninguna llamada puede gastar solo ensuciaría el contador.
  const clave = ((opciones.metadatos?.apiKey ?? process.env.YOUTUBE_API_KEY) ?? '').trim()
  if (clave.length === 0) return resultadoVacio(true)

  const almacen = opciones.almacen ?? crearAlmacenSupabase()
  const maxVideos = opciones.maxVideos ?? MAX_VIDEOS_BACKFILL

  let cuota = opciones.cuota
  let reservadas = 0
  if (!cuota) {
    reservadas = await almacen.reservarCuotaYoutube(PRESUPUESTO_POR_CORRIDA, TOPE_DIARIO_PERSISTENTE)
    cuota = crearContadorCuota({ presupuesto: reservadas })
  }

  const consultar = crearConsultaMetadatos(opciones.metadatos)
  const r = resultadoVacio(false)
  let cursor: string | null = null

  bucle: while (r.vistos < maxVideos) {
    const lote = await almacen.videosSinDuracion(cursor, Math.min(PAGINA_BACKFILL, maxVideos - r.vistos))
    if (lote.length === 0) break

    for (const video of lote) {
      cursor = video.id
      r.vistos++

      // El corte ANTES de la llamada, no después. Sin cuota no se sigue: la
      // siguiente ejecución (u otro día) retoma por la misma consulta.
      if (cuota.intentarGastar('videos.list') !== null) {
        r.cortesCuota++
        break bucle
      }

      const meta = await consultar(video.externalId)
      if (meta === null) {
        r.sinRespuesta++
        continue
      }
      if (meta.durationSeconds == null) {
        r.sinDuracion++
        continue
      }
      await almacen.guardarDuracion(video.id, meta.durationSeconds)
      r.escritos++
    }
  }

  // El sobrante vuelve al cupo del día. Best-effort: si falla, el día pierde
  // cupo contable, que es el lado seguro del error.
  if (reservadas > 0 && cuota.restantes() > 0) {
    await almacen.devolverCuotaYoutube(cuota.restantes())
  }

  return r
}
