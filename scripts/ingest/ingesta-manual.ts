// ============================================================================
// B08 · Primer llenado del catálogo, en local y sin techo de tiempo.
//
//   node --experimental-strip-types scripts/ingest/ingesta-manual.ts videos
//   node --experimental-strip-types scripts/ingest/ingesta-manual.ts articulos --pasadas 5
//   node --experimental-strip-types scripts/ingest/ingesta-manual.ts reverificar
//
// MISMA LÓGICA que el cron, con otro presupuesto: `ejecutarIngesta` es la única
// implementación. Un script con su propia copia del pipeline es un script que se
// desincroniza del filtro de seguridad, y ese es exactamente el archivo que
// nadie recuerda actualizar cuando se endurece una regla.
//
// Se ejecuta en PASADAS en vez de con un presupuesto enorme: cada pasada guarda
// su cursor, así que un Ctrl+C a mitad no pierde el trabajo hecho.
// ============================================================================

import { ejecutarIngesta, type TipoEjecucion } from '../../lib/ingest/ejecutar.ts'

const argv = process.argv.slice(2)
const tipo = (argv.find((a) => !a.startsWith('--')) ?? 'videos') as TipoEjecucion

if (tipo !== 'videos' && tipo !== 'articulos' && tipo !== 'reverificar') {
  console.error('Uso: ingesta-manual.ts <videos|articulos|reverificar> [--pasadas N]')
  process.exit(1)
}

const iPasadas = argv.indexOf('--pasadas')
const pasadas = iPasadas >= 0 ? Math.max(1, Number.parseInt(argv[iPasadas + 1] ?? '1', 10) || 1) : 1

for (let i = 1; i <= pasadas; i++) {
  const r = await ejecutarIngesta({ tipo, presupuestoMs: 120_000, maxItems: 200 })
  console.warn(
    `pasada ${i}/${pasadas} · completado=${r.completado} fuentes=${r.fuentesVistas} ` +
      `insertados=${r.insertados} duplicados=${r.duplicados} pendientes=${r.pendientes} ` +
      `rechazados(seg/embed/cal/canal/idioma)=${r.rechazados.seguridad}/${r.rechazados.embed}/${r.rechazados.calidad}/${r.rechazados.canal}/${r.rechazados.idioma} ` +
      `errores=${r.errores} ms=${r.msTranscurridos}`,
  )
  // Si una pasada no encontró nada nuevo, seguir es gastar peticiones para nada.
  if (r.completado && r.insertados === 0 && r.pendientes === 0 && r.duplicados === 0) {
    console.warn('Sin novedades: se detiene aquí.')
    break
  }
}
