// ============================================================================
// Las claves de la economía existen y tienen texto en LOS DOS idiomas.
//
// ── POR QUÉ ESTE TEST ───────────────────────────────────────────────────────
// Desde que los textos de B12 son claves de catálogo, una clave mal escrita no
// revienta nada: `obtenerTraductor` devuelve la clave tal cual —a propósito, un
// respaldo silencioso al español dejaría media app sin traducir sin que nadie
// se entere— y la tienda pinta «karma.economia.paquetes.crystals_550» donde
// tenía que poner el nombre del paquete.
//
// El guard de paridad de i18n (`i18n/claves.test.ts`) compara los dos catálogos
// entre SÍ, así que no ve este fallo: una clave que no existe en ninguno de los
// dos está perfectamente equilibrada. Lo que falta es comprobar el otro extremo
// del cable —lo que el código PIDE contra lo que el catálogo TIENE— y eso solo
// lo puede hacer quien es dueño de las claves. Por eso vive aquí y no en i18n.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { LOCALES, obtenerTraductor } from '../../i18n/index.ts'
import { KARMA_COSTS } from '../karma.ts'
import { opcionesDePago } from './boosts.ts'
import { PAQUETES } from './catalogo.ts'
import { REGALOS } from './regalos.ts'
import { CLAVES_DE_TEXTO } from './textos.ts'

/** Todas las claves que el código de la economía le pide al catálogo. */
function clavesDeLaEconomia(): string[] {
  const opciones = opcionesDePago({
    cupoGratisRestante: 1,
    boostsHoy: 0,
    karmaSpendable: 500,
    crystals: 500,
    costeKarma: KARMA_COSTS.boost,
    costeCristales: KARMA_COSTS.boost,
    maxDia: 3,
  })

  return [
    ...CLAVES_DE_TEXTO,
    ...PAQUETES.map((p) => p.claveEtiqueta),
    ...REGALOS.map((r) => r.claveEtiqueta),
    ...opciones.map((o) => o.claveEtiqueta),
  ]
}

test('toda clave de la economía tiene texto en es y en en', () => {
  const faltan: string[] = []

  for (const clave of clavesDeLaEconomia()) {
    for (const locale of LOCALES) {
      const texto = obtenerTraductor(locale)(clave)
      // `obtenerTraductor` devuelve la clave cuando no la encuentra: si texto y
      // clave coinciden, la pantalla estaría pintando el identificador.
      if (texto === clave || texto.trim() === '') faltan.push(`${clave} (${locale})`)
    }
  }

  assert.deepEqual(faltan, [], 'claves sin texto: la pantalla pintaría el identificador')
})

test('las claves viven todas bajo karma.economia: el catálogo se organiza por dominio', () => {
  for (const clave of clavesDeLaEconomia()) {
    assert.match(clave, /^karma\.economia\./, `${clave} está fuera del dominio de la economía`)
  }
})

test('ninguna etiqueta de dato se ha quedado como texto en español dentro del módulo', () => {
  // La prueba de que son CLAVES y no nombres: un `claveEtiqueta` con espacios o
  // con acentos es una etiqueta escrita a mano que se ha colado.
  for (const dato of [...PAQUETES, ...REGALOS]) {
    assert.match(
      dato.claveEtiqueta,
      /^[a-z][a-zA-Z0-9_.]*$/,
      `«${dato.claveEtiqueta}» parece un nombre, no una clave de catálogo`,
    )
  }
})

test('el precio en cristales del boost se pinta con el plural del catálogo, no concatenado', () => {
  // «1 cristales» es el fallo clásico de armar la etiqueta en el servidor. Aquí
  // el número lo pone la vista y el plural lo decide cada idioma.
  const t = obtenerTraductor('es')
  assert.equal(t('karma.economia.boost.opciones.cristales', { n: 1 }), '1 cristal')
  assert.equal(t('karma.economia.boost.opciones.cristales', { n: 50 }), '50 cristales')

  const en = obtenerTraductor('en')
  assert.equal(en('karma.economia.boost.opciones.cristales', { n: 1 }), '1 crystal')
  assert.equal(en('karma.economia.boost.opciones.cristales', { n: 50 }), '50 crystals')
})
