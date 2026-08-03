// ============================================================================
// B08 · La cola de curación humana.
//
//   node --experimental-strip-types scripts/ingest/revisar-pendientes.ts [N]
//
// Lista lo que quedó en `state = 'pending'` — lo que el filtro de seguridad no
// supo decidir y lo que el embed no pudo confirmar—, ordenado por antigüedad
// (índice `idx_content_pending`).
//
// Esta cola es PEQUEÑA POR DISEÑO: si crece sin parar, no es que haya mucho
// contenido dudoso, es que falta la clave de moderación o que una fuente está
// mandando material que no encaja en el catálogo. Un número grande aquí es una
// señal de operación, no una tarea de lectura.
//
// El script NO aprueba nada. Aprobar es una decisión humana y se toma con el
// vídeo delante; automatizarla desde aquí sería reinventar el filtro que
// justamente decidió no decidir.
// ============================================================================

import { crearAlmacenSupabase } from '../../lib/ingest/almacen.ts'

const limite = Math.min(500, Math.max(1, Number.parseInt(process.argv[2] ?? '50', 10) || 50))

const almacen = crearAlmacenSupabase()
const pendientes = await almacen.pendientesDeCuracion(limite)

if (pendientes.length === 0) {
  console.warn('Cola vacía: nada pendiente de curación.')
} else {
  console.warn(`${pendientes.length} ítem(s) pendientes, del más antiguo al más reciente:\n`)
  for (const p of pendientes) {
    console.warn(`  ${p.createdAt}  ${p.id}`)
    console.warn(`    ${p.title}`)
    console.warn(`    ${p.url}\n`)
  }
  console.warn(
    'Para aprobar o rechazar: hazlo con el contenido delante, contra content_items.state, ' +
      'con el cliente service_role. El cliente no tiene privilegio de escritura sobre esta tabla.',
  )
}
