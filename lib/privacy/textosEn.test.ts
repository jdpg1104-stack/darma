// ============================================================================
// La prueba de los documentos legales en INGLÉS.
//
// Misma mecánica que `textos.test.ts`: si alguien edita una coma de un cuerpo
// inglés sin subir su versión, esto falla. Y dos verificaciones que solo
// existen aquí: la paridad estructural con el original español (mismo número
// de secciones numeradas — una traducción a la que le falta una sección no es
// una traducción) y la cláusula de prevalencia (cada cuerpo inglés declara que
// es traducción de trabajo y que el español manda hasta la revisión externa).
// ============================================================================

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { CONTACTO_EMAIL } from './avisos.ts'
import { cubreVersionActual, versionVigente } from './consentimientos.ts'
import { POLITICA_RETENCION } from './retencion.ts'
import { DOCUMENTOS_LEGALES, ORDEN_DOCUMENTOS, huellaTexto, rutaDocumento } from './textos.ts'
import {
  DOCUMENTOS_LEGALES_EN,
  TRADUCCION_RETENCION_EN,
  documentoParaLocale,
  rutaDocumentoEn,
} from './textosEn.ts'

const RAIZ = join(import.meta.dirname, '..', '..')

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/** Títulos de sección numerados («3. RECIPROCITY…»). Es lo que la paridad
 *  estructural compara: el número de secciones, no su texto. La mayúscula tras
 *  el número distingue un título real de una referencia cruzada («…el punto
 *  4.») que el ajuste de línea dejó a principio de renglón. */
function seccionesNumeradas(cuerpo: string): number {
  return (cuerpo.match(/^\d+\. [A-ZÁÉÍÓÚÜÑ]/gm) ?? []).length
}

test('EN · el sha256 declarado de cada documento coincide con su cuerpo', () => {
  for (const documento of Object.values(DOCUMENTOS_LEGALES_EN)) {
    const real = sha256(documento.cuerpo)
    assert.equal(
      documento.sha256,
      real,
      `El texto de «${documento.titulo}» ha cambiado sin actualizar su huella.\n` +
        `Sube la versión (ahora ${documento.version}) y pon sha256: '${real}'.`,
    )
  }
})

test('EN · huellaTexto() produce el mismo sha256 que la declaración', async () => {
  for (const documento of Object.values(DOCUMENTOS_LEGALES_EN)) {
    assert.equal(await huellaTexto(documento.cuerpo), documento.sha256)
  }
})

test('EN · cada documento tiene versión en-v*, fecha, título y sustancia', () => {
  for (const [tipo, documento] of Object.entries(DOCUMENTOS_LEGALES_EN)) {
    assert.equal(documento.tipo, tipo)
    // El prefijo `en-` no es decorativo: es lo que hace imposible confundir en
    // `consents.version` una aceptación inglesa con una española.
    assert.match(documento.version, /^en-v\d+-\d{4}-\d{2}$/, `versión inválida en ${tipo}`)
    assert.match(documento.actualizadoEn, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(documento.titulo.length > 3)
    assert.ok(documento.cuerpo.length > 500, `${tipo} es sospechosamente corto`)
  }
})

test('EN · cubre exactamente los mismos seis tipos que el español', () => {
  assert.deepEqual(
    Object.keys(DOCUMENTOS_LEGALES_EN).sort(),
    Object.keys(DOCUMENTOS_LEGALES).sort(),
  )
})

test('EN · paridad estructural: mismo número de secciones numeradas que el original', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    const es = seccionesNumeradas(DOCUMENTOS_LEGALES[tipo].cuerpo)
    const en = seccionesNumeradas(DOCUMENTOS_LEGALES_EN[tipo].cuerpo)
    assert.equal(
      en,
      es,
      `${tipo}: el español tiene ${es} secciones numeradas y el inglés ${en}. ` +
        'Una traducción con secciones de más o de menos no es una traducción.',
    )
  }
})

test('EN · la cláusula de prevalencia está en los seis, con la versión del original', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    const cuerpo = DOCUMENTOS_LEGALES_EN[tipo].cuerpo
    assert.match(cuerpo, /working translation/, `${tipo} no se declara traducción de trabajo`)
    assert.match(cuerpo, /Spanish version prevails/, `${tipo} no declara que el español prevalece`)
    assert.match(cuerpo, /pending external legal review/, `${tipo} no menciona la revisión externa`)
    // La cláusula interpola la VERSIÓN del original: subir la versión española
    // cambia este cuerpo, rompe su sha256 y fuerza a revisar la traducción.
    assert.ok(
      cuerpo.includes(`(version ${DOCUMENTOS_LEGALES[tipo].version})`),
      `${tipo} no cita la versión del original español (${DOCUMENTOS_LEGALES[tipo].version})`,
    )
  }
})

test('EN · ningún «write to us / contact us» apunta al vacío: siempre lleva el buzón', () => {
  // El mismo guard que el español («escríbenos» → siempre con dirección),
  // aplicado a las fórmulas inglesas. Un derecho que se ejerce «writing to us»
  // sin decir a dónde no se puede ejercer.
  const buzon = CONTACTO_EMAIL.replaceAll('.', '\\.')
  const huerfana = new RegExp(`(?:writ(?:e|ing) to us|contact us)(?!\\s+at\\s+${buzon})`, 'iu')
  for (const documento of Object.values(DOCUMENTOS_LEGALES_EN)) {
    assert.ok(
      !huerfana.test(documento.cuerpo),
      `«${documento.titulo}» pide que le escriban sin decir a qué dirección`,
    )
  }
})

test('EN · si el original da el correo de contacto, la traducción también', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    if (!DOCUMENTOS_LEGALES[tipo].cuerpo.includes(CONTACTO_EMAIL)) continue
    assert.ok(
      DOCUMENTOS_LEGALES_EN[tipo].cuerpo.includes(CONTACTO_EMAIL),
      `${tipo}: el español da ${CONTACTO_EMAIL} y el inglés lo omite`,
    )
  }
})

test('EN · retención se GENERA desde POLITICA_RETENCION, no se duplica', () => {
  const cuerpo = DOCUMENTOS_LEGALES_EN.retencion.cuerpo
  for (const regla of POLITICA_RETENCION) {
    assert.ok(cuerpo.includes(regla.tabla), `la tabla ${regla.tabla} no aparece en el documento EN`)
  }
  // Los rótulos de cada entrada van traducidos, no en español.
  assert.match(cuerpo, /Period: /)
  assert.match(cuerpo, /Legal basis: /)
  assert.match(cuerpo, /Automatic batched deletion: (?:yes|no)/)
})

test('EN · el mapa de traducción de retención cubre EXACTAMENTE las tablas de la política', () => {
  // Ni una tabla sin traducir (el cuerpo caería al español, verdad en el idioma
  // equivocado) ni una traducción huérfana de una tabla que ya no existe.
  const tablas = POLITICA_RETENCION.map((r) => r.tabla).sort()
  const traducidas = Object.keys(TRADUCCION_RETENCION_EN).sort()
  assert.deepEqual(traducidas, tablas)
})

test('EN · las versiones inglesas no se confunden con las vigentes de consents', () => {
  // El sistema de consentimientos asume UNA versión vigente por tipo: la del
  // documento español. Las cadenas `en-v…` deben ser distintas de las `v…` y
  // `cubreVersionActual()` —igualdad exacta— jamás debe darlas por buenas
  // mientras el cableado de consentimiento en inglés no exista.
  for (const tipo of ORDEN_DOCUMENTOS) {
    assert.notEqual(DOCUMENTOS_LEGALES_EN[tipo].version, DOCUMENTOS_LEGALES[tipo].version)
  }
  assert.equal(cubreVersionActual('terminos', DOCUMENTOS_LEGALES_EN.terminos.version), false)
  assert.equal(cubreVersionActual('privacidad', DOCUMENTOS_LEGALES_EN.privacidad.version), false)
  assert.equal(
    cubreVersionActual('no_es_terapia', DOCUMENTOS_LEGALES_EN.no_es_terapia.version),
    false,
  )
  assert.equal(cubreVersionActual('edad_minima', DOCUMENTOS_LEGALES_EN.menores.version), false)
  // Y la vigente sigue siendo la española: registrar un consentimiento no ha
  // cambiado de significado por añadir las traducciones.
  assert.equal(versionVigente('terminos'), DOCUMENTOS_LEGALES.terminos.version)
})

test('EN · documentoParaLocale sirve inglés a en y español a es (el fallback)', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    assert.equal(documentoParaLocale(tipo, 'en'), DOCUMENTOS_LEGALES_EN[tipo])
    assert.equal(documentoParaLocale(tipo, 'es'), DOCUMENTOS_LEGALES[tipo])
  }
})

test('EN · las rutas inglesas cuelgan de /legal/ y derivan de las españolas', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    const ruta = rutaDocumentoEn(tipo)
    assert.ok(ruta.startsWith('/legal/en/'), `${tipo}: ${ruta} no cuelga de /legal/en/`)
    assert.equal(ruta, `/legal/en${rutaDocumento(tipo).slice('/legal'.length)}`)
  }
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('EN · FALLO · un cuerpo alterado deja de casar con su huella declarada', () => {
  const documento = DOCUMENTOS_LEGALES_EN.terminos
  const alterado = documento.cuerpo.replace('Darma', 'Darma,')
  assert.notEqual(alterado, documento.cuerpo, 'la alteración de prueba no cambió nada')
  assert.notEqual(sha256(alterado), documento.sha256)
})

test('EN · FALLO · las siete páginas inglesas existen, estáticas y sin cliente', () => {
  const segmentos: readonly string[] = [
    '', // el índice /legal/en
    'terminos',
    'privacidad',
    'cookies',
    'no-es-terapia',
    'menores',
    'retencion',
  ]

  for (const segmento of segmentos) {
    const partes = segmento === '' ? ['page.tsx'] : [segmento, 'page.tsx']
    const ruta = join(RAIZ, 'app', '(legal)', 'legal', 'en', ...partes)
    const contenido = readFileSync(ruta, 'utf8')
    // Sin `force-static` la página dejaría de servirse desde el CDN cuando la
    // app esté caída — la única garantía de este grupo de rutas.
    assert.match(contenido, /force-static/, `${ruta} no es estática`)
    assert.ok(!contenido.includes("'use client'"), `${ruta} no debe ser cliente`)
  }
})

test('EN · FALLO · cada página inglesa renderiza SU documento, no un duplicado a mano', () => {
  const segmentoDe: Readonly<Record<string, string>> = {
    terminos: 'terminos',
    privacidad: 'privacidad',
    cookies: 'cookies',
    no_es_terapia: 'no-es-terapia',
    menores: 'menores',
    retencion: 'retencion',
  }

  for (const tipo of ORDEN_DOCUMENTOS) {
    const ruta = join(RAIZ, 'app', '(legal)', 'legal', 'en', segmentoDe[tipo], 'page.tsx')
    const contenido = readFileSync(ruta, 'utf8')
    assert.ok(
      contenido.includes(`DOCUMENTOS_LEGALES_EN['${tipo}']`),
      `${ruta} no renderiza el documento inglés ${tipo}: el texto estaría duplicado a mano`,
    )
  }
})
