// ============================================================================
// EL TEST DE LA LÍNEA ROJA
//
// > El dinero no compra karma, ni prioridad de escucha, ni adelanta la cola de
// > crisis.
//
// Este test recorre TODO `lib/billing/**`, `app/api/billing/**`,
// `components/economia/**` y la migración `0121_1_b12_economia.sql` buscando
// cualquier rastro de una conversión de dinero a karma, y falla si aparece.
//
// ── ES INTENCIONADAMENTE TOSCO ──────────────────────────────────────────────
// Es un grep. No entiende de sintaxis, no sigue el flujo de datos y da falsos
// positivos con una palabra en un comentario. Todo eso es a propósito: su valor
// no está en ser preciso, está en **romperse el día que alguien intente
// convertir dinero en karma**, aunque lo haga con buena intención y en una
// línea que parezca inocente. Un análisis fino se puede esquivar sin querer;
// un grep, no.
//
// SI ESTE TEST FALLA: no lo relajes ni añadas tu archivo a la lista de
// excepciones. Lo que hay que revisar es el código. Si de verdad hiciera falta
// una excepción, es una decisión de producto y va a `HANDOFF/PEDIDOS.md`, no a
// este archivo.
//
// Los comentarios que EXPLICAN la regla sí pueden nombrarla, claro: por eso el
// escaneo ignora las líneas de comentario y mira solo el código.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

/** Los cuatro territorios de B12. Si el bloque crece, esta lista crece. */
const TERRITORIOS = [
  join(RAIZ, 'lib', 'billing'),
  join(RAIZ, 'app', 'api', 'billing'),
  join(RAIZ, 'components', 'economia'),
]

const MIGRACION = join(RAIZ, 'supabase', 'migrations', '0121_1_b12_economia.sql')

/**
 * Lo prohibido en un camino de compra. Cada patrón es una forma concreta de
 * romper la línea roja:
 *  · `award_karma`        → la única función que otorga karma. Si una compra la
 *                           llama, el dinero acaba de comprar reputación.
 *  · `karma_reputation`   → la columna del nivel. Vitalicia y no comprable.
 *  · `karma_spendable +`  → sumar saldo gastable es acuñar karma; restarlo
 *                           (spend_karma) es legítimo y por eso el patrón lleva
 *                           el `+`.
 *  · `p_kind`/`kind:`     → firma de award_karma; delata una llamada envuelta.
 */
const PROHIBIDOS: ReadonlyArray<{ patron: RegExp; porque: string }> = [
  { patron: /\baward_karma\b/, porque: 'otorgar karma desde un camino de compra' },
  { patron: /\bkarma_reputation\b/, porque: 'escribir o leer la reputación desde la economía premium' },
  { patron: /karma_spendable\s*(\+|\+=)/, porque: 'sumar karma gastable (acuñar karma)' },
  { patron: /set\s+karma_spendable/i, porque: 'escribir directamente en el saldo gastable' },
  { patron: /\bawardKarma\b/, porque: 'envoltorio de award_karma' },
]

/** Recorre un directorio y devuelve los archivos de código. */
function archivosDe(directorio: string): string[] {
  let entradas: string[]
  try {
    entradas = readdirSync(directorio)
  } catch {
    return []
  }

  const salida: string[] = []
  for (const entrada of entradas) {
    const ruta = join(directorio, entrada)
    if (statSync(ruta).isDirectory()) {
      salida.push(...archivosDe(ruta))
    } else if (/\.(ts|tsx|sql|css)$/.test(entrada)) {
      salida.push(ruta)
    }
  }
  return salida
}

/**
 * Quita los comentarios. Un comentario que dice «aquí NO se llama a
 * award_karma()» es exactamente lo que queremos que exista, así que el escaneo
 * mira el código y no la prosa.
 *
 * Es un despojado simple, no un parser: sirve porque estos archivos no meten
 * `//` dentro de cadenas salvo en urls, y una url no contiene los patrones.
 */
function soloCodigo(fuente: string): string[] {
  const sinBloques = fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  return (
    sinBloques
      .split('\n')
      // El `\r` de un archivo con finales CRLF hay que quitarlo ANTES: `.` no
      // casa con un terminador de línea, así que `\/\/.*$` no llegaría al final
      // de la cadena y el comentario se quedaría sin despojar — el test pasaría
      // en un repositorio con LF y fallaría en el mismo código con CRLF. Se
      // encontró exactamente así.
      .map((linea) => linea.replace(/\r$/, ''))
      .map((linea) => linea.replace(/(^|[^:])\/\/.*$/, '$1').replace(/^\s*--.*$/, ''))
  )
}

test('la lista de territorios apunta a directorios que existen y tienen archivos', () => {
  for (const territorio of TERRITORIOS) {
    assert.ok(
      archivosDe(territorio).length > 0,
      `sin archivos en ${territorio}: el test estaría pasando por no mirar nada`,
    )
  }
  assert.ok(readFileSync(MIGRACION, 'utf8').length > 1000, 'no se ha podido leer la migración de B12')
})

test('🔴 ningún camino de compra otorga karma (grep sobre lib/billing, app/api/billing, components/economia y la migración)', () => {
  const archivos = [...TERRITORIOS.flatMap(archivosDe), MIGRACION]
    // El propio test nombra los patrones; excluirse a sí mismo no es una
    // excepción de conveniencia: es no medir la regla con la regla.
    .filter((ruta) => !ruta.endsWith('lineaRoja.test.ts'))

  const hallazgos: string[] = []

  for (const ruta of archivos) {
    const lineas = soloCodigo(readFileSync(ruta, 'utf8'))
    lineas.forEach((linea, indice) => {
      for (const { patron, porque } of PROHIBIDOS) {
        if (patron.test(linea)) {
          hallazgos.push(`${relative(RAIZ, ruta)}:${indice + 1} → ${porque}\n    ${linea.trim()}`)
        }
      }
    })
  }

  assert.deepEqual(
    hallazgos,
    [],
    'LÍNEA ROJA ROTA. El dinero no puede comprar karma:\n' + hallazgos.join('\n'),
  )
})

test('🔴 la economía premium no toca la cola de crisis', () => {
  // `crisis_events` se ordena por `created_at` y por nada más. Ningún archivo de
  // este bloque puede escribir en esa tabla ni leerla para decidir un orden: si
  // el dinero pudiera tocarla, adelantaría a alguien que está en peligro.
  const archivos = [...TERRITORIOS.flatMap(archivosDe), MIGRACION].filter(
    (ruta) => !ruta.endsWith('lineaRoja.test.ts'),
  )

  const hallazgos: string[] = []
  for (const ruta of archivos) {
    soloCodigo(readFileSync(ruta, 'utf8')).forEach((linea, indice) => {
      if (/\bcrisis_events\b/.test(linea)) {
        hallazgos.push(`${relative(RAIZ, ruta)}:${indice + 1}: ${linea.trim()}`)
      }
    })
  }

  assert.deepEqual(hallazgos, [], 'la economía premium no puede tocar crisis_events:\n' + hallazgos.join('\n'))
})

test('🔴 ninguna ruta de compra acepta una cantidad del cliente', () => {
  // El cliente manda un SKU o un tipo de regalo. Si un esquema de validación
  // aceptara `amount`, `crystals`, `price` o `delta`, la cantidad la decidiría
  // quien paga — que es la definición de imprimir moneda.
  const validacion = readFileSync(join(AQUI, 'validacion.ts'), 'utf8')
  const codigo = soloCodigo(validacion).join('\n')

  for (const campo of ['amount', 'crystals:', 'price', 'delta', 'cantidad']) {
    assert.ok(
      !codigo.includes(campo),
      `el esquema de entrada no puede aceptar «${campo}»: la cantidad la decide el servidor`,
    )
  }

  // Y todos los esquemas son `.strict()`, así que un campo colado se RECHAZA en
  // vez de ignorarse en silencio.
  const esquemas = codigo.match(/z\s*\n?\s*\.object\(/g) ?? []
  const estrictos = codigo.match(/\.strict\(\)/g) ?? []
  assert.equal(
    esquemas.length,
    estrictos.length,
    'todo z.object() de billing tiene que llevar .strict(): un campo de más debe ser un 422, no un no-evento',
  )
})

test('🔴 ningún cosmético imita un nivel de karma ni la insignia de mentor', async () => {
  const { CATALOGO_COSMETICOS, prohibidoPorqueImitaNivel } = await import('./cosmeticos.ts')

  for (const cosmetico of CATALOGO_COSMETICOS) {
    assert.equal(
      prohibidoPorqueImitaNivel(cosmetico),
      false,
      `«${cosmetico.etiqueta}» (${cosmetico.id}) se parece a un nivel de karma: comprar algo que aparenta reputación es comprar reputación`,
    )
  }
})

// ── LA FRASE EN LAS CUATRO SUPERFICIES ──────────────────────────────────────
//
// La frase ya no es una constante en español: vive en `messages/es.json` y
// `messages/en.json` bajo `CLAVE_LINEA_ROJA`, y la pinta `<FraseLineaRoja />`.
// Eso parte la comprobación en tres eslabones, y los tres se comprueban aquí
// porque la promesa solo se cumple si la cadena entera se cumple:
//
//   1. las cuatro superficies de pago pintan el componente,
//   2. el componente resuelve exactamente esa clave (y no otra tecleada a mano),
//   3. la clave tiene texto de verdad en LOS DOS idiomas.
//
// Comprobar solo el punto 1 —que es lo que hacía este test cuando la frase era
// una constante— dejaría pasar un componente que resuelve una clave inexistente
// y pinta «karma.economia.lineaRoja» en una pantalla de pago.

const SUPERFICIES_DE_PAGO = [
  'TiendaCristales.tsx',
  'DialogoBoost.tsx',
  'SelectorRegalo.tsx',
  'HistorialCompras.tsx',
] as const

test('🔴 la frase del producto aparece en todas las superficies de pago', () => {
  for (const superficie of SUPERFICIES_DE_PAGO) {
    const fuente = readFileSync(join(RAIZ, 'components', 'economia', superficie), 'utf8')
    assert.match(
      fuente,
      /<FraseLineaRoja/,
      `${superficie} es una superficie de pago y tiene que pintar la frase de la línea roja`,
    )
  }
})

test('🔴 la frase existe, en los dos idiomas, y es la que pinta el componente', async () => {
  const { LOCALES, obtenerTraductor } = await import('../../i18n/index.ts')
  const { CLAVE_LINEA_ROJA } = await import('./textos.ts')

  // El componente no puede teclear su propia clave: la importa de `textos.ts`,
  // que es la MISMA que devuelven `/api/billing/catalog` y `/api/billing/boost`.
  // Si aquí volviera a aparecer una cadena literal, servidor y pantalla podrían
  // apuntar a dos frases distintas otra vez.
  const componente = readFileSync(join(RAIZ, 'components', 'economia', 'FraseLineaRoja.tsx'), 'utf8')
  assert.match(componente, /\bCLAVE_LINEA_ROJA\b/, 'FraseLineaRoja tiene que usar CLAVE_LINEA_ROJA')
  assert.match(componente, /t\(CLAVE_LINEA_ROJA\)/, 'la frase se resuelve con el traductor del locale')

  for (const locale of LOCALES) {
    const frase = obtenerTraductor(locale)(CLAVE_LINEA_ROJA)
    assert.notEqual(
      frase,
      CLAVE_LINEA_ROJA,
      `sin texto para ${CLAVE_LINEA_ROJA} en ${locale}: la pantalla de pago pintaría la clave`,
    )
    assert.ok(frase.trim().length > 20, `la frase en ${locale} está vacía o es un marcador`)
  }
})

test('🔴 la frase no vuelve a estar escrita a mano en ningún sitio', () => {
  // Una sola fuente significa una sola fuente. Si la frase aparece como cadena
  // literal en el código de pago, es una segunda copia que dentro de seis meses
  // dirá algo distinto — y en un solo idioma.
  const literal = /Los cristales no dan karma|Crystals don't buy karma/
  const archivos = [...TERRITORIOS.flatMap(archivosDe)].filter(
    (ruta) => !ruta.endsWith('lineaRoja.test.ts'),
  )

  const hallazgos = archivos.filter((ruta) => literal.test(soloCodigo(readFileSync(ruta, 'utf8')).join('\n')))

  assert.deepEqual(
    hallazgos.map((ruta) => relative(RAIZ, ruta)),
    [],
    'la frase se lee del catálogo (CLAVE_LINEA_ROJA), no se teclea',
  )
})
