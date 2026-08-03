// ============================================================================
// Tests de la comprobación de cabeceras y CSP.
//
// Los servidores falsos son de `node:http`, sin dependencias y sin levantar la
// app: lo que se prueba es el ANALIZADOR, y cada caso de fallo es una regresión
// concreta que ya ha ocurrido en algún proyecto (CSP en Report-Only, `https:` a
// secas en img-src, X-Powered-By de vuelta tras un cambio de configuración).
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

import { comprobarCabeceras, analizarCsp, parsearCsp, formatearInforme } from './comprobarCabeceras.ts'

// ── Servidor falso ──────────────────────────────────────────────────────────

/** La CSP buena, espejo de la de `next.config.ts`. */
const CSP_BUENA = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://proyecto.supabase.co https://i.ytimg.com",
  "frame-src 'self' https://www.youtube-nocookie.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://proyecto.supabase.co wss://proyecto.supabase.co",
  "form-action 'self'",
].join('; ')

const CABECERAS_BUENAS: Record<string, string> = {
  'content-security-policy': CSP_BUENA,
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

/** Levanta un servidor con las cabeceras dadas. Devuelve la url base y el cierre. */
async function servidorFalso(
  cabeceras: Record<string, string>,
  opciones: { estadoAyuda?: number } = {},
): Promise<{ url: string; cerrar: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    for (const [k, v] of Object.entries(cabeceras)) res.setHeader(k, v)
    if (req.url === '/ayuda') {
      res.statusCode = opciones.estadoAyuda ?? 200
      res.end('ayuda')
      return
    }
    res.statusCode = 200
    res.end('ok')
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    cerrar: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

// ── Camino feliz (punto 3 de la ficha) ──────────────────────────────────────

test('3 · un despliegue con todas las cabeceras da ok:true', async () => {
  const s = await servidorFalso(CABECERAS_BUENAS)
  try {
    const r = await comprobarCabeceras(s.url)
    assert.deepEqual(r.faltantes, [])
    assert.deepEqual(r.problemas, [])
    assert.equal(r.ok, true, formatearInforme(r, s.url))
  } finally {
    await s.cerrar()
  }
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('7 · sin CSP → ok:false con faltantes:[Content-Security-Policy]', async () => {
  const sinCsp = { ...CABECERAS_BUENAS }
  delete sinCsp['content-security-policy']

  const s = await servidorFalso(sinCsp)
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.deepEqual(r.faltantes, ['Content-Security-Policy'])
  } finally {
    await s.cerrar()
  }
})

test('8 · CSP en Content-Security-Policy-Report-Only → ok:false (report-only no protege)', async () => {
  const reportOnly = { ...CABECERAS_BUENAS }
  delete reportOnly['content-security-policy']
  reportOnly['content-security-policy-report-only'] = CSP_BUENA

  const s = await servidorFalso(reportOnly)
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(r.faltantes.includes('Content-Security-Policy'))
    assert.ok(
      r.problemas.some((p) => /Report-Only/i.test(p)),
      `se esperaba un problema que nombre Report-Only: ${JSON.stringify(r.problemas)}`,
    )
  } finally {
    await s.cerrar()
  }
})

test('9 · img-src con comodín `https:` se reporta como problema', async () => {
  const conComodin = {
    ...CABECERAS_BUENAS,
    'content-security-policy': CSP_BUENA.replace(
      "img-src 'self' data: blob: https://proyecto.supabase.co https://i.ytimg.com",
      "img-src 'self' https:",
    ),
  }

  const s = await servidorFalso(conComodin)
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(
      r.problemas.some((p) => p.includes('img-src') && p.includes('comodín')),
      JSON.stringify(r.problemas),
    )
  } finally {
    await s.cerrar()
  }
})

test('X-Powered-By presente se reporta', async () => {
  const s = await servidorFalso({ ...CABECERAS_BUENAS, 'x-powered-by': 'Next.js' })
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(r.problemas.some((p) => p.includes('x-powered-by')))
  } finally {
    await s.cerrar()
  }
})

test('/ayuda con muro de login (302) se reporta: es ruta pública por razones no técnicas', async () => {
  const s = await servidorFalso(CABECERAS_BUENAS, { estadoAyuda: 302 })
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(
      r.problemas.some((p) => p.includes('/ayuda')),
      JSON.stringify(r.problemas),
    )
  } finally {
    await s.cerrar()
  }
})

test('Permissions-Policy sin camera=() se reporta (anonimato: nunca cara ni voz)', async () => {
  const s = await servidorFalso({
    ...CABECERAS_BUENAS,
    'permissions-policy': 'microphone=(), geolocation=()',
  })
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(r.problemas.some((p) => p.includes('camera')))
  } finally {
    await s.cerrar()
  }
})

test('HSTS con max-age corto se reporta', async () => {
  const s = await servidorFalso({ ...CABECERAS_BUENAS, 'strict-transport-security': 'max-age=600' })
  try {
    const r = await comprobarCabeceras(s.url)
    assert.equal(r.ok, false)
    assert.ok(r.problemas.some((p) => p.includes('Strict-Transport-Security')))
  } finally {
    await s.cerrar()
  }
})

// ── El analizador de CSP, en aislamiento ────────────────────────────────────

test('analizarCsp exige default-src y frame-ancestors', () => {
  assert.deepEqual(analizarCsp(CSP_BUENA), [])

  const suelto = analizarCsp("default-src *; frame-ancestors 'self'")
  assert.equal(suelto.length, 2)
  assert.ok(suelto.some((p) => p.includes('default-src')))
  assert.ok(suelto.some((p) => p.includes('frame-ancestors')))
})

test('analizarCsp rechaza un frame-src que no sea youtube-nocookie', () => {
  // TikTok e Instagram exigen cargar su script propietario en nuestra página:
  // telemetría de quién lee qué en una red de apoyo emocional. Descartado.
  const problemas = analizarCsp(
    CSP_BUENA.replace(
      "frame-src 'self' https://www.youtube-nocookie.com",
      "frame-src 'self' https://www.tiktok.com",
    ),
  )
  assert.ok(problemas.some((p) => p.includes('frame-src') && p.includes('tiktok')))
})

test('analizarCsp detecta `*` en connect-src', () => {
  const problemas = analizarCsp(CSP_BUENA.replace("connect-src 'self'", "connect-src *"))
  assert.ok(problemas.some((p) => p.includes('connect-src')))
})

test('parsearCsp trocea directivas y valores', () => {
  const mapa = parsearCsp("default-src 'self'; img-src 'self' data:")
  assert.deepEqual(mapa.get('default-src'), ["'self'"])
  assert.deepEqual(mapa.get('img-src'), ["'self'", 'data:'])
})

test('un host inalcanzable no revienta: devuelve ok:false con el motivo', async () => {
  // Puerto cerrado a propósito.
  const r = await comprobarCabeceras('http://127.0.0.1:1')
  assert.equal(r.ok, false)
  assert.ok(r.problemas.length > 0)
})
