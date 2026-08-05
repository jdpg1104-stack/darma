import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MetadataRoute } from 'next'

import robots from './robots.ts'
import sitemap from './sitemap.ts'

// ============================================================================
// robots.txt dice a los buscadores lo mismo que proxy.ts impone a las
// peticiones: lo que no es la portada, la ayuda o los legales, no existe para
// ellos. La lista de vetos se duplica aquí A PROPÓSITO — es la expectativa,
// no un reflejo del código — para que quitar una línea de app/robots.ts haga
// fallar la prueba con nombre y apellido.
// ============================================================================

/** Ejecuta `fn` con NEXT_PUBLIC_SITE_URL fijada (o borrada) y la restaura. */
function conSitio<T>(valor: string | undefined, fn: () => T): T {
  const previo = process.env.NEXT_PUBLIC_SITE_URL
  if (valor === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = valor
  try {
    return fn()
  } finally {
    if (previo === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previo
  }
}

const BASE = 'https://darma.example'

type Regla = MetadataRoute.Robots['rules'] extends infer R
  ? R extends readonly (infer U)[]
    ? U
    : R
  : never

/** Normaliza `rules` (objeto o lista) a lista, y un campo a lista de cadenas. */
function reglas(resultado: MetadataRoute.Robots): Regla[] {
  return Array.isArray(resultado.rules) ? resultado.rules : [resultado.rules]
}
function comoLista(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return []
  return Array.isArray(valor) ? valor : [valor]
}

test('una sola regla para todos los agentes, con la portada permitida', () => {
  const lista = reglas(conSitio(BASE, () => robots()))
  assert.equal(lista.length, 1)
  assert.equal(lista[0].userAgent, '*')
  assert.deepEqual(comoLista(lista[0].allow), ['/'])
})

test('todas las superficies privadas están vetadas, y ninguna pública', () => {
  const vetos = comoLista(reglas(conSitio(BASE, () => robots()))[0].disallow)
  const esperados = [
    '/api/',
    '/auth/',
    '/feed',
    '/animo',
    '/publicar',
    '/post/',
    '/perfil',
    '/refugios',
    '/ranking',
    '/onboarding',
    '/panel',
    '/moderacion',
    '/encuestas',
    '/offline',
  ]
  assert.deepEqual([...vetos].sort(), [...esperados].sort())
  // Y las puertas públicas no pueden aparecer jamás entre los vetos.
  for (const publica of ['/', '/entrar', '/ayuda', '/legal']) {
    assert.equal(vetos.includes(publica), false, `${publica} vetada por error`)
  }
})

test('declara el sitemap en el dominio configurado, con fallback de desarrollo', () => {
  assert.equal(conSitio(BASE, () => robots()).sitemap, `${BASE}/sitemap.xml`)
  assert.equal(
    conSitio(undefined, () => robots()).sitemap,
    'http://localhost:3000/sitemap.xml',
  )
})

test('coherencia: nada de lo que anuncia el sitemap está vetado por robots', () => {
  // Si esta prueba falla, uno de los dos archivos miente: o el sitemap invita
  // a una ruta privada, o robots vetó una puerta pública.
  const vetos = comoLista(reglas(conSitio(BASE, () => robots()))[0].disallow)
  const rutas = conSitio(BASE, () => sitemap()).map(
    (entrada) => new URL(entrada.url).pathname,
  )
  for (const ruta of rutas) {
    for (const veto of vetos) {
      assert.equal(
        ruta.startsWith(veto),
        false,
        `${ruta} está en el sitemap pero robots la veta con ${veto}`,
      )
    }
  }
})
