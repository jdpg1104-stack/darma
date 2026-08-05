import test from 'node:test'
import assert from 'node:assert/strict'

import { detectPii, assertNoPii, redactPii, PiiDetectedError } from './pii.ts'

// Estos tests vivían en lib/anonymity.test.ts; se mudaron con el código cuando
// la detección de PII se partió a lib/pii.ts (pedido «De B03 → F3»).

test('detecta emails, incluidas las evasiones habituales', () => {
  for (const texto of [
    'escríbeme a maria.lopez@gmail.com',
    'mi correo es maria (arroba) gmail punto com',
    'maria AT gmail DOT com',
  ]) {
    const findings = detectPii(texto)
    assert.ok(findings.some((f) => f.kind === 'email'), `no detectó email en: "${texto}"`)
  }
})

test('detecta teléfonos con y sin separadores', () => {
  for (const texto of [
    'mi movil es 612345678',
    'llámame al +34 612 34 56 78',
    'tel: 612-34-56-78',
  ]) {
    assert.ok(detectPii(texto).some((f) => f.kind === 'phone'), `no detectó teléfono en: "${texto}"`)
  }
})

test('no confunde años ni cifras cortas con teléfonos', () => {
  for (const texto of [
    'esto empezó en 2019 y aún sigue',
    'llevo 3 semanas sin dormir',
    'tengo 28 años y peso 65 kilos',
  ]) {
    assert.deepEqual(detectPii(texto).filter((f) => f.kind === 'phone'), [], `falso positivo en: "${texto}"`)
  }
})

test('detecta handles y URLs', () => {
  assert.ok(detectPii('sígueme en @maria_lopez').some((f) => f.kind === 'handle'))
  assert.ok(detectPii('mira https://instagram.com/maria').some((f) => f.kind === 'url'))
  assert.ok(detectPii('está en www.miblog.es').some((f) => f.kind === 'url'))
  assert.ok(detectPii('busca miblog.com').some((f) => f.kind === 'url'))
})

test('un email no se cuenta además como handle (no se subraya dos veces)', () => {
  const findings = detectPii('maria@gmail.com')
  assert.equal(findings.filter((f) => f.kind === 'handle').length, 0)
  assert.equal(findings.filter((f) => f.kind === 'email').length, 1)
})

test('los hallazgos vienen ordenados por posición', () => {
  const findings = detectPii('mi correo maria@gmail.com y mi movil 612345678')
  const indices = findings.map((f) => f.index)
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b))
})

test('un desahogo normal no dispara nada', () => {
  const texto =
    'Llevo tres semanas sin dormir bien. Mi jefe me pide cosas imposibles y en casa ' +
    'tampoco puedo hablarlo. No sé por dónde empezar.'
  assert.deepEqual(detectPii(texto), [])
  assert.doesNotThrow(() => assertNoPii(texto))
})

test('assertNoPii lanza (no devuelve booleano) para que no se pueda ignorar', () => {
  assert.throws(() => assertNoPii('escríbeme a maria@gmail.com'), PiiDetectedError)
  assert.throws(() => assertNoPii('mi movil 612345678'), PiiDetectedError)
})

test('el error explica el porqué sin regañar y conserva los hallazgos', () => {
  try {
    assertNoPii('maria@gmail.com')
    assert.fail('debería haber lanzado')
  } catch (e) {
    assert.ok(e instanceof PiiDetectedError)
    assert.ok(e.findings.length > 0)
    assert.match(e.message, /sitio seguro/)
  }
})

test('redactPii sustituye pero no borra el resto del texto (para logs)', () => {
  const out = redactPii('contacta a maria@gmail.com o al 612345678')
  assert.ok(!out.includes('maria@gmail.com'))
  assert.ok(!out.includes('612345678'))
  assert.match(out, /contacta a/)
})

// ── Aislamiento del módulo ──────────────────────────────────────────────────
// La razón de ser de este archivo es poder importarse desde un componente
// 'use client'. Si alguien le añade node:crypto (o cualquier import de
// servidor), el bundle del navegador vuelve a romperse. Este test lee el
// fuente y lo impide.

test('AISLAMIENTO: lib/pii.ts no importa nada (puro e isomorfo)', async () => {
  const { readFile } = await import('node:fs/promises')
  const fuente = await readFile(new URL('./pii.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(
    fuente,
    /^\s*import\s/m,
    'lib/pii.ts debe seguir sin imports: lo consume el composer en el navegador',
  )
})
