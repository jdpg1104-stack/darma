import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DOCUMENTOS_LEGALES,
  ORDEN_DOCUMENTOS,
  rutaDocumento,
} from '../lib/privacy/textos.ts'
import sitemap from './sitemap.ts'

// ============================================================================
// El sitemap es una promesa de privacidad en negativo: lo importante no es lo
// que lista, sino lo que JAMÁS puede listar. Estas pruebas fijan la lista
// blanca exacta y comprueban que ninguna superficie con contenido de personas
// se filtre, hoy ni cuando alguien "mejore" el archivo.
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

function rutasDelSitemap(): string[] {
  return conSitio(BASE, () => sitemap()).map((entrada) => new URL(entrada.url).pathname)
}

test('el sitemap lista exactamente la superficie pública, ni una ruta más', () => {
  const esperadas = [
    '/',
    '/entrar',
    '/ayuda',
    '/legal',
    // Los documentos legales salen de la MISMA fuente que el índice de /legal:
    // si se añade un documento a textos.ts, esta expectativa lo sigue sola.
    ...ORDEN_DOCUMENTOS.map((tipo) => rutaDocumento(tipo)),
  ]
  assert.deepEqual(rutasDelSitemap().sort(), [...esperadas].sort())
})

test('ninguna superficie privada ni utilitaria se filtra al sitemap', () => {
  // La lista en positivo ya lo garantiza; esta prueba existe para que el día
  // que alguien reescriba el sitemap "recorriendo rutas", el fallo diga POR QUÉ.
  const vetadas = [
    '/api',
    '/auth',
    '/feed',
    '/animo',
    '/publicar',
    '/post',
    '/perfil',
    '/refugios',
    '/ranking',
    '/onboarding',
    '/panel',
    '/moderacion',
    '/encuestas',
    '/offline',
  ]
  for (const ruta of rutasDelSitemap()) {
    for (const prefijo of vetadas) {
      assert.equal(
        ruta === prefijo || ruta.startsWith(`${prefijo}/`),
        false,
        `${ruta} no debería estar en el sitemap (choca con ${prefijo})`,
      )
    }
  }
})

test('cada página legal lleva su fecha real de última actualización', () => {
  const entradas = conSitio(BASE, () => sitemap())
  for (const tipo of ORDEN_DOCUMENTOS) {
    const url = `${BASE}${rutaDocumento(tipo)}`
    const entrada = entradas.find((e) => e.url === url)
    assert.ok(entrada, `falta ${url} en el sitemap`)
    assert.equal(entrada.lastModified, DOCUMENTOS_LEGALES[tipo].actualizadoEn)
  }
})

test('usa NEXT_PUBLIC_SITE_URL, tolera la barra final y cae a localhost sin ella', () => {
  for (const entrada of conSitio(BASE, () => sitemap())) {
    assert.ok(entrada.url.startsWith(`${BASE}/`), entrada.url)
  }
  // Una barra final en la variable no puede producir `dominio//ruta`.
  for (const entrada of conSitio(`${BASE}/`, () => sitemap())) {
    assert.equal(entrada.url.includes(`${BASE}//`), false, entrada.url)
  }
  // Sin variable (desarrollo), el fallback es el mismo que usa el resto del
  // repo (lib/video/embed.ts): localhost, nunca un dominio inventado.
  for (const entrada of conSitio(undefined, () => sitemap())) {
    assert.ok(entrada.url.startsWith('http://localhost:3000/'), entrada.url)
  }
  // Y una variable vacía cuenta como ausente, no como base ''.
  for (const entrada of conSitio('  ', () => sitemap())) {
    assert.ok(entrada.url.startsWith('http://localhost:3000/'), entrada.url)
  }
})
