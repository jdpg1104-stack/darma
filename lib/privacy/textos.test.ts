// ============================================================================
// LA PRUEBA CENTRAL DEL BLOQUE.
//
// Si alguien edita una coma de un texto legal sin subir su versión, esto falla.
// Sin este archivo, «aceptaste los términos» no significa nada: los términos
// pudieron cambiar después y no habría forma de saberlo.
// ============================================================================

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { AVISO_NO_TERAPIA, AVISO_NO_TERAPIA_LARGO, EDAD_MINIMA } from './avisos.ts'
import {
  DOCUMENTOS_LEGALES,
  ORDEN_DOCUMENTOS,
  TEXTO_LAPIDA_POST,
  huellaTexto,
  rutaDocumento,
  type TipoDocumentoLegal,
} from './textos.ts'

const RAIZ = join(import.meta.dirname, '..', '..')

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

test('el sha256 declarado de cada documento coincide con su cuerpo', () => {
  for (const documento of Object.values(DOCUMENTOS_LEGALES)) {
    const real = sha256(documento.cuerpo)
    assert.equal(
      documento.sha256,
      real,
      `El texto de «${documento.titulo}» ha cambiado sin actualizar su huella.\n` +
        `Sube la versión (ahora ${documento.version}) y pon sha256: '${real}'.`,
    )
  }
})

test('huellaTexto() produce el mismo sha256 que la declaración', async () => {
  for (const documento of Object.values(DOCUMENTOS_LEGALES)) {
    assert.equal(await huellaTexto(documento.cuerpo), documento.sha256)
  }
})

test('cada documento tiene versión, fecha, título y un cuerpo con sustancia', () => {
  for (const [tipo, documento] of Object.entries(DOCUMENTOS_LEGALES)) {
    assert.equal(documento.tipo, tipo)
    assert.match(documento.version, /^v\d+-\d{4}-\d{2}$/, `versión inválida en ${tipo}`)
    assert.match(documento.actualizadoEn, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(documento.titulo.length > 3)
    // Un documento legal de dos líneas es un documento legal que no dice nada.
    assert.ok(documento.cuerpo.length > 500, `${tipo} es sospechosamente corto`)
  }
})

test('ORDEN_DOCUMENTOS cubre los seis documentos, sin repetir ni faltar', () => {
  const declarados = Object.keys(DOCUMENTOS_LEGALES).sort()
  const listados = [...ORDEN_DOCUMENTOS].sort()
  assert.deepEqual(listados, declarados)
  assert.equal(new Set(ORDEN_DOCUMENTOS).size, ORDEN_DOCUMENTOS.length)
})

test('las rutas van bajo /legal/ — si no, quedan detrás del login (Trampa #5)', () => {
  for (const tipo of ORDEN_DOCUMENTOS) {
    assert.ok(
      rutaDocumento(tipo).startsWith('/legal/'),
      `${tipo} no cuelga de /legal/: proxy.ts solo hace pública esa ruta`,
    )
  }
})

test('el texto lápida es IDÉNTICO al literal de la migración 0201', () => {
  const migracion = readFileSync(
    join(RAIZ, 'supabase', 'migrations', '0201_1_b20_privacidad.sql'),
    'utf8',
  )
  assert.ok(
    migracion.includes(TEXTO_LAPIDA_POST),
    'TEXTO_LAPIDA_POST no aparece literalmente en borrar_usuario(): el borrado escribiría ' +
      'un texto distinto del que este módulo declara.',
  )
})

test('el texto lápida cumple el check de longitud de posts.body (20–5000)', () => {
  assert.ok(TEXTO_LAPIDA_POST.length >= 20)
  assert.ok(TEXTO_LAPIDA_POST.length <= 5000)
})

test('los avisos de no-terapia existen y no desalientan', () => {
  assert.equal(EDAD_MINIMA, 16)
  // Una frase para el pie: si crece, deja de caber y alguien lo quitará.
  assert.ok(AVISO_NO_TERAPIA.length < 200)
  assert.ok(AVISO_NO_TERAPIA_LARGO.length > 800)
  // El aviso corto tiene que nombrar lo que Darma SÍ es, no solo lo que no es.
  assert.match(AVISO_NO_TERAPIA, /acompañamiento|entre personas/i)
  // Y no puede cerrar la puerta: tiene que mencionar la ayuda profesional como
  // algo que suma, no como un «vete a otro sitio».
  assert.match(AVISO_NO_TERAPIA, /también/i)
})

test('el documento de privacidad explica la política de borrado CON ESAS PALABRAS', () => {
  const cuerpo = DOCUMENTOS_LEGALES.privacidad.cuerpo
  // La parte que una persona no espera y tiene derecho a saber ANTES de pulsar.
  assert.match(cuerpo, /LO QUE ESCRIBISTE PARA OTRAS PERSONAS SE CONSERVA/)
  assert.match(cuerpo, /no puede robarle a otra persona/)
  assert.match(cuerpo, /17\.3/)
  assert.match(cuerpo, /30 días/)
  assert.match(cuerpo, /un solo uso/)
  // Y la irreversibilidad de la bóveda de identidad.
  assert.match(cuerpo, /clave secreta/)
})

test('el documento de menores razona la edad y el consentimiento parental', () => {
  const cuerpo = DOCUMENTOS_LEGALES.menores.cuerpo
  assert.match(cuerpo, /16 años/)
  assert.match(cuerpo, /no verifica/i)
  assert.match(cuerpo, /NO recogerá datos del progenitor/)
  assert.match(cuerpo, /restringir funciones/)
  assert.match(cuerpo, /revisión legal/)
  // La vía del tutor, que es la limitación incómoda que hay que declarar.
  assert.match(cuerpo, /tutor|hijo o hija/)
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('FALLO · ninguna página de /legal usa dangerouslySetInnerHTML', () => {
  const base = join(RAIZ, 'app', '(legal)')
  const archivos: string[] = []

  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) recorrer(ruta)
      else if (entrada.name.endsWith('.tsx') || entrada.name.endsWith('.ts')) archivos.push(ruta)
    }
  }
  recorrer(base)

  assert.ok(archivos.length >= 8, `esperaba al menos 8 archivos en (legal), hay ${archivos.length}`)

  for (const archivo of archivos) {
    const contenido = readFileSync(archivo, 'utf8')
    assert.ok(
      !contenido.includes('dangerouslySetInnerHTML'),
      `${archivo} inyecta HTML: un documento legal que inyecta HTML es XSS con traje`,
    )
  }
})

test('FALLO · un cuerpo alterado deja de casar con su huella declarada', () => {
  const documento = DOCUMENTOS_LEGALES.terminos
  const alterado = documento.cuerpo.replace('Darma', 'Darma,')
  assert.notEqual(alterado, documento.cuerpo, 'la alteración de prueba no cambió nada')
  assert.notEqual(sha256(alterado), documento.sha256)
})

test('FALLO · las siete páginas de /legal existen en el sitio correcto', () => {
  const esperadas = [
    ['legal', 'page.tsx'],
    ['legal', 'terminos', 'page.tsx'],
    ['legal', 'privacidad', 'page.tsx'],
    ['legal', 'cookies', 'page.tsx'],
    ['legal', 'no-es-terapia', 'page.tsx'],
    ['legal', 'menores', 'page.tsx'],
    ['legal', 'retencion', 'page.tsx'],
  ]

  for (const partes of esperadas) {
    const ruta = join(RAIZ, 'app', '(legal)', ...partes)
    const contenido = readFileSync(ruta, 'utf8')
    // Sin `force-static` la página pasaría a renderizarse por petición y
    // dejaría de servirse desde el CDN cuando la app esté caída.
    assert.match(contenido, /force-static/, `${ruta} no es estática`)
    // Un 'use client' aquí serían KB de JavaScript en una página de solo texto.
    assert.ok(!contenido.includes("'use client'"), `${ruta} no debe ser cliente`)
  }
})

test('FALLO · un tipo de documento sin página en disco se detecta', () => {
  const segmentos: Readonly<Record<TipoDocumentoLegal, string>> = {
    terminos: 'terminos',
    privacidad: 'privacidad',
    cookies: 'cookies',
    no_es_terapia: 'no-es-terapia',
    menores: 'menores',
    retencion: 'retencion',
  }

  for (const tipo of ORDEN_DOCUMENTOS) {
    const ruta = join(RAIZ, 'app', '(legal)', 'legal', segmentos[tipo], 'page.tsx')
    const contenido = readFileSync(ruta, 'utf8')
    assert.ok(
      contenido.includes(`DOCUMENTOS_LEGALES['${tipo}']`),
      `${ruta} no renderiza el documento ${tipo}: el texto estaría duplicado a mano`,
    )
  }
})
