// ============================================================================
// B08 · Siembra del catálogo de orígenes.
//
//   node --experimental-strip-types scripts/ingest/sembrar-fuentes.ts
//   node --experimental-strip-types scripts/ingest/sembrar-fuentes.ts --verificar
//   node --experimental-strip-types scripts/ingest/sembrar-fuentes.ts --seco
//
//   --verificar  descarga cada feed y reporta el código HTTP. Es la comprobación
//                que exige la regla de admisión: una fuente cuyo feed no responde
//                200 no entra, por muy respetable que sea el organismo.
//   --seco       valida e imprime, sin tocar la base de datos.
//
// El upsert NO pisa `enabled`, `cursor` ni `cooldown_until`: lo que un humano
// apagó a mano sigue apagado tras el siguiente despliegue.
// ============================================================================

import { FUENTES_SEMILLA, urlDeFuente, validarSemilla } from '../../lib/ingest/fuentes.ts'
import { crearAlmacenSupabase } from '../../lib/ingest/almacen.ts'

const args = new Set(process.argv.slice(2))
const verificar = args.has('--verificar')
const seco = args.has('--seco')

async function principal(): Promise<void> {
  const problemas = validarSemilla()
  if (problemas.length > 0) {
    console.error('La semilla NO es válida. No se escribe nada:')
    for (const p of problemas) console.error(`  · ${p}`)
    process.exitCode = 1
    return
  }

  console.warn(`Semilla válida: ${FUENTES_SEMILLA.length} fuentes.`)
  for (const f of FUENTES_SEMILLA) {
    console.warn(`  ${f.key.padEnd(14)} ${f.kind.padEnd(17)} ${f.language}  ${f.porQue.slice(0, 70)}…`)
  }

  if (verificar) {
    console.warn('\nComprobando los feeds en vivo…')
    let fallos = 0
    for (const f of FUENTES_SEMILLA) {
      const url = urlDeFuente(f)
      let estado = 'sin respuesta'
      try {
        const res = await fetch(url, { headers: { accept: 'application/xml, text/xml, */*' } })
        estado = String(res.status)
        if (!res.ok) fallos++
      } catch {
        fallos++
      }
      console.warn(`  ${f.key.padEnd(14)} → ${estado}`)
    }
    if (fallos > 0) {
      console.error(`\n${fallos} fuente(s) no responden. Revísalas ANTES de sembrar.`)
      process.exitCode = 1
      return
    }
  }

  if (seco) {
    console.warn('\n--seco: no se ha escrito nada.')
    return
  }

  const almacen = crearAlmacenSupabase()
  const escritas = await almacen.sembrarFuentes(FUENTES_SEMILLA)
  console.warn(`\n${escritas}/${FUENTES_SEMILLA.length} fuentes sembradas.`)
}

await principal()
