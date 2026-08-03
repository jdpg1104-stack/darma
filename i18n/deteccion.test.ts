import test from 'node:test'
import assert from 'node:assert/strict'

import { negociarLocale, resolverLocaleDesde } from './deteccion.ts'
import { esLocale, idiomaBase, LOCALE_POR_DEFECTO, opcionesCookiePreferencia } from './routing.ts'
import { normalizarPais, resolverPaisDesde } from './pais.ts'
import { obtenerTraductor, traducirCodigoError, CODIGOS_DE_ERROR, subarbolDeMensajes } from './index.ts'

// ── Negociación de idioma · camino feliz ────────────────────────────────────

test('negociarLocale respeta la calidad q=', () => {
  assert.equal(negociarLocale('en-GB,en;q=0.9,es;q=0.8'), 'en')
  assert.equal(negociarLocale('es-419,es;q=0.9'), 'es')
  assert.equal(negociarLocale('es'), 'es')
  assert.equal(negociarLocale('en'), 'en')
  // El orden lo manda q=, no la posición: aquí el inglés va segundo pero gana.
  assert.equal(negociarLocale('es;q=0.2,en;q=0.9'), 'en')
  // A igual q, gana el primero (RFC 9110).
  assert.equal(negociarLocale('en;q=0.5,es;q=0.5'), 'en')
})

test('negociarLocale recorta la variante regional', () => {
  assert.equal(negociarLocale('es-MX'), 'es')
  assert.equal(negociarLocale('es_AR'), 'es')
  assert.equal(negociarLocale('EN-gb'), 'en')
})

test('negociarLocale ignora idiomas no soportados y sigue buscando', () => {
  assert.equal(negociarLocale('fr-FR,fr;q=0.9,en;q=0.4'), 'en')
  assert.equal(negociarLocale('de,pt;q=0.9,es;q=0.1'), 'es')
})

// ── Negociación de idioma · camino de fallo ─────────────────────────────────

test('negociarLocale NUNCA lanza y cae siempre a es', () => {
  const basura = [
    null,
    undefined,
    '',
    '   ',
    'zz',
    '*',
    '*;q=0.5',
    ';;;;',
    'q=1',
    'es;q=abc',
    'es;q=0',
    'x'.repeat(5000),
    '{"__proto__":1}',
  ]
  for (const caso of basura) {
    assert.equal(negociarLocale(caso), LOCALE_POR_DEFECTO, `caso ${JSON.stringify(caso)}`)
  }
})

test('un q ilegible no descarta el idioma: se ignora el parámetro, no la preferencia', () => {
  // Perder el idioma preferido de alguien por un punto y coma mal puesto es peor
  // que ignorar el q roto y quedarse con el orden de aparición.
  assert.equal(negociarLocale('es;q=abc,en'), 'es')
  assert.equal(negociarLocale('fr;q=abc,en'), 'en')
})

// ── Orden de resolución: cookie → cabecera → defecto ────────────────────────

test('la cookie válida gana a la cabecera', () => {
  assert.equal(resolverLocaleDesde('en', 'es-ES,es;q=0.9'), 'en')
  assert.equal(resolverLocaleDesde('es', 'en-GB,en;q=0.9'), 'es')
})

test('una cookie manipulada se ignora y se negocia la cabecera', () => {
  for (const cookie of ['fr', 'ES', '__proto__', 'constructor', '', null, undefined, 'es-MX']) {
    assert.equal(resolverLocaleDesde(cookie, 'en-GB,en;q=0.9'), 'en', `cookie ${String(cookie)}`)
  }
})

test('sin cookie y sin cabecera → es', () => {
  assert.equal(resolverLocaleDesde(null, null), 'es')
})

test('esLocale es lista blanca estricta', () => {
  assert.equal(esLocale('es'), true)
  assert.equal(esLocale('en'), true)
  for (const v of ['ES', 'es-MX', 'fr', '', null, undefined, 0, {}, ['es'], '__proto__']) {
    assert.equal(esLocale(v), false, `esLocale(${JSON.stringify(v)}) debería ser false`)
  }
})

test('idiomaBase recorta a las dos letras que exige content_items.language', () => {
  assert.equal(idiomaBase('es-419'), 'es')
  assert.equal(idiomaBase('EN_GB'), 'en')
  assert.equal(idiomaBase('pt'), 'pt')
  assert.equal(idiomaBase('zzz'), null)
  assert.equal(idiomaBase(''), null)
  assert.equal(idiomaBase(null), null)
  // El check de 0002_comunidad.sql es ^[a-z]{2}$: lo que salga de aquí lo cumple.
  for (const entrada of ['es-419', 'EN_GB', 'pt']) {
    assert.match(idiomaBase(entrada) ?? '', /^[a-z]{2}$/)
  }
})

// ── País ────────────────────────────────────────────────────────────────────

test('normalizarPais: solo ISO-3166 alfa-2, en mayúsculas', () => {
  assert.equal(normalizarPais('es'), 'ES')
  assert.equal(normalizarPais(' us '), 'US')
  assert.equal(normalizarPais('GB'), 'GB')
  for (const v of ['ESP', 'e', '', '  ', 'ZZ', '__proto__', 'constructor', 12, null, undefined, {}]) {
    assert.equal(normalizarPais(v), null, `normalizarPais(${JSON.stringify(v)}) debería ser null`)
  }
})

test('la cookie de país gana a la cabecera del edge (viajes y VPN)', () => {
  assert.equal(resolverPaisDesde('ES', 'US'), 'ES')
  assert.equal(resolverPaisDesde(null, 'US'), 'US')
  assert.equal(resolverPaisDesde('basura', 'us'), 'US')
  assert.equal(resolverPaisDesde(null, null), null)
  assert.equal(resolverPaisDesde('ZZ', 'ZZ'), null)
})

// ── Cookies ─────────────────────────────────────────────────────────────────

test('la cookie de preferencia NO es httpOnly, pero sí lax y de un año', () => {
  const opciones = opcionesCookiePreferencia()
  assert.equal(opciones.httpOnly, false, 'el selector la lee en cliente')
  assert.equal(opciones.sameSite, 'lax')
  assert.equal(opciones.path, '/')
  assert.equal(opciones.maxAge, 60 * 60 * 24 * 365)
})

// ── Traductor de respaldo ───────────────────────────────────────────────────

test('obtenerTraductor resuelve claves anidadas en los dos idiomas', () => {
  const es = obtenerTraductor('es')
  const en = obtenerTraductor('en')
  assert.equal(es('comun.cancelar'), 'Cancelar')
  assert.equal(en('comun.cancelar'), 'Cancel')
  assert.notEqual(es('crisis.boton'), en('crisis.boton'))
})

test('obtenerTraductor resuelve plurales ICU', () => {
  const es = obtenerTraductor('es')
  assert.match(es('publicar.faltan', { n: 1 }), /queda una persona/)
  assert.match(es('publicar.faltan', { n: 2 }), /quedan 2 personas/)

  const en = obtenerTraductor('en')
  assert.match(en('publicar.faltan', { n: 1 }), /one person/)
  assert.match(en('publicar.faltan', { n: 3 }), /3 people/)
})

test('una clave inexistente se devuelve tal cual: nada de fallback silencioso', () => {
  const t = obtenerTraductor('en')
  assert.equal(t('no.existe.esta.clave'), 'no.existe.esta.clave')
  // En concreto: NO devuelve el texto español, que dejaría media app sin
  // traducir para siempre sin que nadie se entere.
  assert.notEqual(t('no.existe.esta.clave'), 'Cancelar')
})

test('la palabra "crédito" no aparece en el copy de reciprocidad, en ningún idioma', () => {
  const es = obtenerTraductor('es')
  const en = obtenerTraductor('en')
  const textos = [
    es('publicar.faltan', { n: 2 }),
    es('publicar.primeraVez'),
    es('publicar.listo'),
    es('publicar.rechazoServidor'),
    en('publicar.faltan', { n: 2 }),
    en('publicar.primeraVez'),
    en('publicar.listo'),
    en('publicar.rechazoServidor'),
  ]
  for (const texto of textos) {
    assert.doesNotMatch(texto.toLowerCase(), /cr[eé]dito|credit/, `«${texto}»`)
  }
})

test('traducirCodigoError traduce por CÓDIGO, nunca por message', () => {
  const t = obtenerTraductor('en')
  for (const codigo of CODIGOS_DE_ERROR) {
    const texto = traducirCodigoError(codigo, t)
    assert.notEqual(texto, `errores.${codigo}`, `falta la traducción de ${codigo}`)
  }
  // Un código desconocido (o inyectado) cae en error_interno, no revienta ni
  // pinta la clave cruda.
  assert.equal(traducirCodigoError('inventado', t), t('errores.error_interno'))
  assert.equal(traducirCodigoError(null, t), t('errores.error_interno'))
  assert.equal(traducirCodigoError('__proto__', t), t('errores.error_interno'))
  // Y el retryAfter se interpola con plural.
  assert.match(traducirCodigoError('demasiadas_peticiones', t, { retryAfter: 1 }), /1 second\b/)
  assert.match(traducirCodigoError('demasiadas_peticiones', t, { retryAfter: 30 }), /30 seconds/)
})

test('subarbolDeMensajes manda al cliente solo lo que pide la ruta', () => {
  const parcial = subarbolDeMensajes('es', ['crisis', 'comun'])
  assert.deepEqual(Object.keys(parcial).sort(), ['comun', 'crisis'])
  assert.equal(Object.hasOwn(parcial, 'admin'), false)
  assert.ok(JSON.stringify(parcial).length < JSON.stringify(subarbolDeMensajes('es', ['crisis', 'comun', 'admin', 'feed', 'karma'])).length)
})
