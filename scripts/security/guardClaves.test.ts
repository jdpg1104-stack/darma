// ============================================================================
// Tests del guard de claves de catálogo.
//
// Hay tres que importan, y en este orden:
//
//   1. Que el árbol REAL no pida ninguna clave que el catálogo no tenga. Es la
//      regresión de `curacion.*` vs `admin.curacion.*`, que se encontró a mano
//      pulsando el botón exacto porque no falla en ningún otro sitio.
//   2. Que el guard SE PONGA ROJO ante una clave inventada — sobre un fixture,
//      no de mentira. Un guard que no puede fallar no vale nada.
//   3. Que NO grite por lo que no debe: `t(variable)`, claves en comentarios,
//      la condición de un ternario, un regex con pinta de llamada. Un guard con
//      falsos positivos acaba desactivado justo antes de hacer falta.
//
// El cuarto, menos vistoso y también necesario: que el escáner no se quede MUDO.
// Si un refactor rompiera la extracción, `rotas` saldría vacío y el test pasaría
// sin haber comprobado nada. Por eso se afirma también un suelo de hallazgos.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEUDA_CONOCIDA,
  clavesDelCatalogo,
  comprobarClaves,
  enmascararNoCodigo,
  extraerReferencias,
  formatearDinamicas,
  formatearInforme,
  leerArgumento,
  resolverRamas,
  rotasNuevas,
  sugerirClave,
} from './guardClaves.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const FIXTURE = join(AQUI, 'fixtures', 'claves')

/** Catálogo mínimo para los fixtures: así el test no depende de messages/*.json. */
const CATALOGO_FIXTURE = new Set([
  'comun.aceptar',
  'comun.cancelar',
  'comun.cerrar',
  'comun.mesCorto.1',
])

// ── El árbol real ───────────────────────────────────────────────────────────

test('el código no pide ninguna clave que el catálogo no tenga', () => {
  const informe = comprobarClaves(RAIZ)
  assert.deepEqual(
    rotasNuevas(informe).map((r) => `${r.archivo}:${r.linea} → ${r.clave}`),
    [],
    formatearInforme(informe),
  )
})

test('el escáner no se ha quedado mudo', () => {
  // Sin esto, romper la extracción dejaría el test anterior en verde para
  // siempre sin haber mirado una sola clave. El suelo es holgado a propósito:
  // no es un contador que haya que actualizar en cada cambio de copy.
  const informe = comprobarClaves(RAIZ)
  assert.ok(
    informe.literales.length > 400,
    `solo ${informe.literales.length} referencias literales: el escáner está roto`,
  )
  assert.ok(
    informe.dinamicas.length > 20,
    `solo ${informe.dinamicas.length} dinámicas: el escáner está roto`,
  )
})

test('la línea base de deuda no se ha quedado obsoleta', () => {
  // Una lista de deuda con entradas ya arregladas deja de proteger: nadie sabe
  // cuáles siguen pendientes de verdad. Si esto falla, la sesión que edita
  // messages/*.json añadió la clave — borra su línea de DEUDA_CONOCIDA.
  const catalogo = clavesDelCatalogo()
  const yaExisten = DEUDA_CONOCIDA.filter((c) => catalogo.has(c))
  assert.deepEqual(
    yaExisten,
    [],
    `estas claves de DEUDA_CONOCIDA ya están en el catálogo; bórralas de la lista: ${yaExisten.join(', ')}`,
  )

  const pedidas = new Set(comprobarClaves(RAIZ).literales.map((r) => r.clave))
  const yaNoSePiden = DEUDA_CONOCIDA.filter((c) => !pedidas.has(c))
  assert.deepEqual(
    yaNoSePiden,
    [],
    `el código ya no pide estas claves; bórralas de DEUDA_CONOCIDA: ${yaNoSePiden.join(', ')}`,
  )
})

// ── Camino de fallo, sobre fixture ──────────────────────────────────────────

test('CLAVE INVENTADA: el guard falla y NOMBRA archivo, línea y clave', () => {
  const informe = comprobarClaves(FIXTURE, CATALOGO_FIXTURE)
  const rotas = rotasNuevas(informe)

  assert.deepEqual(
    [...rotas].map((r) => r.clave).sort(),
    ['inventada.del.todo', 'otra.inventada'],
    formatearInforme(informe, CATALOGO_FIXTURE),
  )

  const primera = rotas.find((r) => r.clave === 'inventada.del.todo')
  assert.ok(primera, 'falta el hallazgo de la clave inventada')
  assert.equal(primera.archivo, 'app/rota/page.tsx')
  assert.equal(primera.linea, 16)
  assert.equal(primera.origen, 't()')

  const informeTexto = formatearInforme(informe, CATALOGO_FIXTURE)
  assert.match(informeTexto, /app\/rota\/page\.tsx:16/)
  assert.match(informeTexto, /inventada\.del\.todo/)
  assert.match(informeTexto, /messages\/es\.json/)
  assert.match(informeTexto, /guardClaves\.ts --dinamicas/)
})

test('el fixture limpio no produce NI UN falso positivo', () => {
  // Regex con `//` escapados y una comilla suelta, `</span>` pegado a la
  // llamada, clave en constante, clave que llega por el cable, plantilla
  // interpolada y dos claves en comentarios. Todo legítimo.
  const informe = comprobarClaves(join(FIXTURE, '..'), CATALOGO_FIXTURE)
  const enLimpio = informe.rotas.filter((r) => r.archivo.includes('Limpio'))
  assert.deepEqual(enLimpio, [], formatearInforme(informe, CATALOGO_FIXTURE))
})

test('las dinámicas del fixture se CUENTAN, no se denuncian', () => {
  const informe = comprobarClaves(FIXTURE, CATALOGO_FIXTURE)
  const enLimpio = informe.dinamicas.filter((d) => d.archivo.includes('Limpio'))

  assert.equal(enLimpio.length, 3, formatearDinamicas(informe))
  const expresiones = enLimpio.map((d) => d.expresion)
  assert.ok(expresiones.includes('CLAVE_INDIRECTA'), expresiones.join(' | '))
  assert.ok(expresiones.includes('cuerpo.mensajeClave'), expresiones.join(' | '))
  assert.ok(
    expresiones.some((e) => e.startsWith('`comun.mesCorto.')),
    expresiones.join(' | '),
  )
  assert.match(formatearDinamicas(informe), /components\/Limpio\.tsx:\d+/)
})

// ── Extracción, en memoria ──────────────────────────────────────────────────

test('reconoce mensajeClave y t() con literal, y respeta los argumentos de más', () => {
  const { literales } = extraerReferencias(
    [
      "throw new ErrorApi('entrada_invalida', { mensajeClave: 'admin.curacion.motivoObligatorio' })",
      "const a = t('comun.aceptar')",
      "const b = t('feed.escuchas', { n: 3 })",
      'const c = t(`comun.cerrar`)',
    ].join('\n'),
  )

  assert.deepEqual(
    literales.map((r) => `${r.linea}:${r.origen}:${r.clave}`),
    [
      '1:mensajeClave:admin.curacion.motivoObligatorio',
      '2:t():comun.aceptar',
      '3:t():feed.escuchas',
      '4:t():comun.cerrar',
    ],
  )
})

test('una clave en un COMENTARIO no cuenta', () => {
  const fuente = [
    "// ejemplo: t('inventada.en.linea')",
    "/* y aquí t('inventada.en.bloque') */",
    "{/* y en JSX t('inventada.en.jsx') */}",
    "const ok = t('comun.aceptar')",
  ].join('\n')
  assert.deepEqual(
    extraerReferencias(fuente).literales.map((r) => r.clave),
    ['comun.aceptar'],
  )
})

test('`mensajeClave: string` es una anotación de tipo, no una referencia', () => {
  const { literales, dinamicas } = extraerReferencias(
    'interface Cuerpo { mensajeClave: string }\ntype Otro = { readonly mensajeClave: string }',
  )
  assert.deepEqual(literales, [])
  assert.deepEqual(dinamicas, [])
})

test('`t` no casa con el final de otro identificador', () => {
  const { literales } = extraerReferencias("const x = format('comun.aceptar') + sut('comun.cerrar')")
  assert.deepEqual(literales, [])
})

// ── Ternarios ───────────────────────────────────────────────────────────────

test('las RAMAS de un ternario son claves; la CONDICIÓN no', () => {
  assert.deepEqual(resolverRamas("cola === 'recorte' ? 'admin.a' : 'admin.b'"), [
    'admin.a',
    'admin.b',
  ])
  // Lo importante es esta segunda mitad: 'recorte' es un valor comparado, no
  // una clave. Una regex sobre todas las cadenas de la expresión se lo tragaría
  // y el guard empezaría a inventarse claves rotas.
  assert.ok(!resolverRamas("cola === 'recorte' ? 'admin.a' : 'admin.b'")!.includes('recorte'))
})

test('los ternarios encadenados se resuelven enteros', () => {
  assert.deepEqual(resolverRamas("a ? 'k.uno' : b ? 'k.dos' : 'k.tres'"), ['k.uno', 'k.dos', 'k.tres'])
})

test('si UNA rama no es literal, la expresión entera se cuenta como dinámica', () => {
  assert.equal(resolverRamas("a ? CLAVE : 'k.dos'"), null)
  const { literales, dinamicas } = extraerReferencias("const x = t(a ? CLAVE : 'k.dos')")
  assert.deepEqual(literales, [])
  assert.equal(dinamicas.length, 1)
})

test('`?.` y `??` no se confunden con el `?` de un ternario', () => {
  assert.equal(resolverRamas('a?.b'), null)
  assert.equal(resolverRamas('a ?? b'), null)
})

// ── Enmascarado ─────────────────────────────────────────────────────────────

test('enmascararNoCodigo conserva el número de líneas', () => {
  const fuente = "// uno\nconst x = 1 /* dos */\n/* tres\ncuatro */ fin\nconst re = /a\\/b/\n"
  const limpio = enmascararNoCodigo(fuente)
  assert.equal(limpio.split('\n').length, fuente.split('\n').length)
  assert.ok(limpio.includes('const x = 1'))
  assert.ok(limpio.includes('fin'))
})

test('un regex con pinta de llamada NO genera una referencia', () => {
  // El caso real de lib/crisis.ts: /\b(can'?t (take|do) (it|this) anymore)\b/ se
  // leía como una llamada `t(take|do)` y ensuciaba el recuento de dinámicas.
  const fuente = "const re = /\\b(can'?t (take|do) (it|this) anymore)\\b/\nconst ok = t('comun.aceptar')"
  const { literales, dinamicas } = extraerReferencias(fuente)
  assert.deepEqual(literales.map((r) => r.clave), ['comun.aceptar'])
  assert.deepEqual(dinamicas, [])
})

test('un `//` DENTRO de un regex no se come el resto de la línea', () => {
  // Sin conocer los regex, el `\/\/` de una URL abre un comentario de línea y
  // la llamada posterior desaparece del informe. Un falso NEGATIVO, que es el
  // peor de los dos errores: el guard calla y parece que todo está bien.
  const fuente = "const u = /^https?:\\/\\/x$/; const ok = t('comun.aceptar')"
  assert.deepEqual(
    extraerReferencias(fuente).literales.map((r) => r.clave),
    ['comun.aceptar'],
  )
})

test('un cierre de etiqueta JSX no tapa la llamada que va detrás', () => {
  // `</span>` empieza por `<` y sigue por `/`: tomarlo por un regex se comía
  // hasta el siguiente `/` de la línea, con la llamada dentro.
  const fuente = "<p><span>x</span>{t('comun.aceptar')}</p>"
  assert.deepEqual(
    extraerReferencias(fuente).literales.map((r) => r.clave),
    ['comun.aceptar'],
  )
})

test('un regex tras una flecha SÍ se enmascara', () => {
  const fuente = "const f = () => /t\\('inventada'\\)/.test(x)\nconst ok = t('comun.aceptar')"
  assert.deepEqual(
    extraerReferencias(fuente).literales.map((r) => r.clave),
    ['comun.aceptar'],
  )
})

// ── Piezas sueltas ──────────────────────────────────────────────────────────

test('leerArgumento distingue literal de expresión', () => {
  assert.deepEqual(leerArgumento("('comun.aceptar')", 1, ',)'), {
    tipo: 'literales',
    valores: ['comun.aceptar'],
  })
  assert.deepEqual(leerArgumento("('a' + b)", 1, ',)'), { tipo: 'dinamico', expresion: "'a' + b" })
  assert.deepEqual(leerArgumento('(clave, {})', 1, ',)'), { tipo: 'dinamico', expresion: 'clave' })
  // Una plantilla interpolada no es resoluble aunque esté bien cerrada.
  assert.equal(leerArgumento('(`a.${b}`)', 1, ',)')?.tipo, 'dinamico')
})

test('sugerirClave acierta el caso real: la raíz equivocada', () => {
  // Exactamente lo que pasó: `curacion.*` en vez de `admin.curacion.*`.
  const catalogo = ['admin.curacion.motivoObligatorio', 'comun.aceptar']
  assert.equal(sugerirClave('curacion.motivoObligatorio', catalogo), 'admin.curacion.motivoObligatorio')
})

test('sugerirClave se calla cuando la candidata no es única', () => {
  // Una sugerencia parecida-pero-otra hace perder más tiempo que ninguna.
  assert.equal(sugerirClave('x.titulo', ['feed.titulo', 'perfil.titulo']), null)
  assert.equal(sugerirClave('nada.de.nada', ['comun.aceptar']), null)
})

test('el informe de éxito dice cuántas dinámicas NO ha comprobado', () => {
  const informe = comprobarClaves(join(FIXTURE, 'components'), CATALOGO_FIXTURE)
  const texto = formatearInforme(informe, CATALOGO_FIXTURE)
  assert.match(texto, /OK/)
  assert.match(texto, /NO comprobable/)
})
