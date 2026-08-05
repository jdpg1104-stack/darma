// ============================================================================
// Registrar que una persona verificó un teléfono de crisis
//
//   node --experimental-strip-types scripts/security/registrarVerificacion.ts \
//     "ES·Línea de Atención a la Conducta Suicida" --por "Nombre Apellido"
//
//   ... --seco     enseña el cambio sin escribir nada.
//
// ── PARA QUÉ ───────────────────────────────────────────────────────────────
// Registrar una verificación son TRES ediciones a mano en `recursosCrisis.ts`:
// `verificadoPor`, `verificadoEn` y borrar la línea de `PENDIENTES_DECLARADOS`.
// Hacerlas 24 veces a mano garantiza que alguna salga mal, y la que salga mal
// será silenciosa: un `verificadoPor` puesto sin quitar de la lista de
// pendientes es una verificación que el guard no cuenta, y al revés es un
// número que el guard da por bueno sin que nadie firme.
//
// Este script hace las tres o ninguna.
//
// ── LO QUE ESTE SCRIPT NO HACE, Y ES LO IMPORTANTE ────────────────────────
// No verifica nada. Verificar es marcar el número y que conteste una persona,
// o leer la fuente oficial. Esto solo REGISTRA que alguien con nombre lo hizo.
// Si lo ejecutas sin haber llamado, lo único que consigues es que el registro
// mienta — y es el registro que decide si Darma se despliega con los teléfonos
// que verá alguien a las tres de la mañana.
//
// Por eso pide `--por` con un nombre real y no acepta un valor por defecto.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RUTA = join(AQUI, '..', '..', 'i18n', 'recursosCrisis.ts')

const args = process.argv.slice(2)
const seco = args.includes('--seco')
const idxPor = args.indexOf('--por')
const por = idxPor >= 0 ? args[idxPor + 1] : undefined
const id = args.find((a) => a.includes('·'))

function salir(mensaje: string): never {
  console.error(mensaje)
  process.exit(1)
}

if (!id) {
  salir(
    'Falta el identificador del recurso, con el formato PAIS·Nombre.\n' +
      'Ejemplo: "ES·Línea de Atención a la Conducta Suicida"\n' +
      'Para ver los pendientes: node --experimental-strip-types scripts/security/gateTelefonos.ts',
  )
}
if (!por || por.trim().length < 3 || por.startsWith('--')) {
  salir('Falta --por "Nombre Apellido". Tiene que ser una persona; el registro es de quién lo confirmó.')
}

const pais = id.slice(0, id.indexOf('·'))
const nombre = id.slice(id.indexOf('·') + 1)
const hoy = new Date().toISOString().slice(0, 10)
const original = readFileSync(RUTA, 'utf8')

// ── 1 y 2 · la entrada ──────────────────────────────────────────────────────
//
// 🔴 SE BUSCA DENTRO DEL BLOQUE DEL PAÍS, NO EN TODO EL ARCHIVO.
//
// La primera versión de este script anclaba solo en `nombre:`, y era un fallo
// grave y silencioso: «Emergencias» aparece CINCO veces —ES, MX, AR, CO, PE— y
// `indexOf` devuelve siempre la primera. Registrar «MX·Emergencias» habría
// marcado como verificado el 112 español, dejando el 911 mexicano sin firmar y
// el registro mintiendo en los dos sentidos a la vez. Lo cazó una prueba del
// camino de fallo, no el camino feliz.
const posPais = original.indexOf(`pais: '${pais}',`)
if (posPais === -1) salir(`No encuentro el bloque del país «${pais}» en ${RUTA}.`)

// El bloque termina donde empieza el país siguiente (o al final del archivo).
const posSiguientePais = original.slice(posPais + 1).search(/\n\s{4}pais: '/)
const finPais = posSiguientePais === -1 ? original.length : posPais + 1 + posSiguientePais

const anclaje = `nombre: '${nombre.replace(/'/g, "\\'")}',`
const posRelativa = original.slice(posPais, finPais).indexOf(anclaje)
if (posRelativa === -1) salir(`No encuentro «${nombre}» dentro del bloque de «${pais}».`)
const posNombre = posPais + posRelativa

const finBloque = original.indexOf('}),', posNombre)
if (finBloque === -1) salir('El recurso no tiene la forma esperada; revísalo a mano.')

const bloque = original.slice(posNombre, finBloque)
if (!bloque.includes('verificadoPor: null')) {
  salir(`«${id}» ya tiene verificadoPor. Si quieres re-verificarlo, edítalo a mano.`)
}

const bloqueNuevo = bloque
  .replace('verificadoPor: null', `verificadoPor: '${por.replace(/'/g, "\\'")}'`)
  .replace(/verificadoEn: [^,]+,/, `verificadoEn: '${hoy}',`)

let salida = original.slice(0, posNombre) + bloqueNuevo + original.slice(finBloque)

// ── 3 · la lista de pendientes ──────────────────────────────────────────────
const lineaPendiente = new RegExp(`^\\s*'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\r?\\n`, 'm')
if (!lineaPendiente.test(salida)) {
  salir(`«${id}» no está en PENDIENTES_DECLARADOS. Comprueba el identificador exacto.`)
}
salida = salida.replace(lineaPendiente, '')

if (seco) {
  console.warn(`[seco] «${id}»\n  verificadoPor: '${por}'\n  verificadoEn: '${hoy}'\n  y se quita de PENDIENTES_DECLARADOS.`)
  console.warn('\nNada escrito. Quita --seco para aplicarlo.')
} else {
  writeFileSync(RUTA, salida, 'utf8')
  console.warn(`Registrado: «${id}» verificado por ${por} el ${hoy}.`)
  console.warn('\nComprueba cuántos quedan:\n  node --experimental-strip-types scripts/security/gateTelefonos.ts')
}
