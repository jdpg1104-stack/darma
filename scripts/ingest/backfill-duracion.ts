// ============================================================================
// B21 · Backfill de `duration_seconds` del catálogo existente, en local.
//
//   node --experimental-strip-types scripts/ingest/backfill-duracion.ts
//   node --experimental-strip-types scripts/ingest/backfill-duracion.ts --max 50
//
// Los vídeos ingeridos por feed Atom llegaron sin duración y la acreditación de
// escucha asume 60 s cuando falta: el +1 se concede a los ~54 s de cualquier
// vídeo. Este script consulta `videos.list` (1 unidad de cuota por vídeo) y
// rellena SOLO las filas con `duration_seconds` NULL.
//
// MISMA LÓGICA que usará cualquier cron futuro: `backfillDuracion` es la única
// implementación (lib/ingest/backfillDuracion.ts) — un script con su propia
// copia se desincronizaría del contador de cuota, igual que se dijo de
// ingesta-manual.ts respecto al filtro de seguridad.
//
// Necesita SUPABASE service_role (vía crearAlmacenSupabase, como los demás
// scripts de esta carpeta: content_items no tiene política de escritura) y
// YOUTUBE_API_KEY. Sin la clave, informa y sale sin tocar nada.
//
// Es idempotente y reanudable: repetirlo no reescribe nada, y un corte de cuota
// a mitad se retoma en la siguiente ejecución por donde iba.
// ============================================================================

import { backfillDuracion, MAX_VIDEOS_BACKFILL } from '../../lib/ingest/backfillDuracion.ts'

const argv = process.argv.slice(2)
const iMax = argv.indexOf('--max')
const maxVideos =
  iMax >= 0 ? Math.max(1, Number.parseInt(argv[iMax + 1] ?? '', 10) || MAX_VIDEOS_BACKFILL) : MAX_VIDEOS_BACKFILL

const r = await backfillDuracion({ maxVideos })

if (r.sinClave) {
  console.error('Falta YOUTUBE_API_KEY: sin ella no hay videos.list y no se tocó nada.')
  process.exit(1)
}

console.warn(
  `vistos=${r.vistos} escritos=${r.escritos} sinDuracion=${r.sinDuracion} ` +
    `sinRespuesta=${r.sinRespuesta} cortesCuota=${r.cortesCuota}`,
)
if (r.cortesCuota > 0) {
  console.warn('La cuota cortó ANTES de agotarse: vuelve a ejecutarlo más tarde y retomará donde iba.')
}
if (r.sinDuracion > 0) {
  console.warn(
    `${r.sinDuracion} vídeo(s) sin duración interpretable (directos o campos vacíos): ` +
      'quedan NULL a propósito y la acreditación sigue con su supuesto de 60 s.',
  )
}
