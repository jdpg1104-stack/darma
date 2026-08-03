import { test } from 'node:test'
import assert from 'node:assert/strict'

import { esquemaDesuscribir, esquemaPrefs, esquemaSuscribir } from './esquemas.ts'
import { endpointValido, hostPermitido } from './endpoint.ts'

const CLAVES = {
  p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkTtF2VMs1uOtOOEbnMjNVMc9dTx0YAcaZ0Aa1BqXsF6kOo',
  auth: 'tBHItJI5svbpez7KI4CCXg',
}

const ENDPOINT_BUENO = 'https://fcm.googleapis.com/fcm/send/ejemplo-de-endpoint'

// ── 13 · SUBSCRIBE ──────────────────────────────────────────────────────────

test('13 · un endpoint interno se rechaza (SSRF)', () => {
  const r = esquemaSuscribir.safeParse({
    endpoint: 'http://interno.local/x',
    keys: CLAVES,
  })
  assert.equal(r.success, false, 'http:// y host desconocido: dos motivos para rechazar')
})

test('13b · un userId en el cuerpo hace fallar la petición entera', () => {
  // `.strict()` y no `.strip()` a propósito: con `.strip()` la clave se
  // descartaría en silencio y volvería a estar viva el día que alguien
  // escribiera `insert({ ...body })`. El userId sale SIEMPRE de la sesión.
  const r = esquemaSuscribir.safeParse({
    endpoint: ENDPOINT_BUENO,
    keys: CLAVES,
    userId: 'b13bbbbb-0000-4000-8000-000000000002',
  })
  assert.equal(r.success, false, 'un userId colado no puede ignorarse en silencio')
})

test('13c · una suscripción legítima pasa', () => {
  const r = esquemaSuscribir.safeParse({ endpoint: ENDPOINT_BUENO, keys: CLAVES })
  assert.equal(r.success, true)
})

test('13d · endpoints que un servidor no debe llamar jamás', () => {
  const prohibidos = [
    'http://169.254.169.254/latest/meta-data/', // metadatos de la nube
    'https://169.254.169.254/', // https no basta
    'http://localhost:3000/x',
    'https://interno.local/x',
    'https://evil.example/fcm/send/x',
    'https://evil-mozilla.com/wpush/v2/x', // sufijo sin el punto delante
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pass@fcm.googleapis.com/fcm/send/x', // credenciales embebidas
    'ftp://fcm.googleapis.com/x',
    'no es una url',
    '',
  ]

  for (const endpoint of prohibidos) {
    assert.equal(endpointValido(endpoint), false, `debería rechazar: ${endpoint}`)
  }
})

test('13e · los servicios de push reales sí pasan', () => {
  const validos = [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc123',
    'https://web.push.apple.com/QABC123',
    'https://par02p.notify.windows.com/w/?token=abc',
  ]

  for (const endpoint of validos) {
    assert.equal(endpointValido(endpoint), true, `debería aceptar: ${endpoint}`)
  }
})

test('13f · hostPermitido no se deja engañar por sufijos', () => {
  assert.equal(hostPermitido('fcm.googleapis.com'), true)
  assert.equal(hostPermitido('FCM.GOOGLEAPIS.COM'), true, 'el host no distingue mayúsculas')
  assert.equal(hostPermitido('notfcm.googleapis.com'), true, 'sufijo .googleapis.com legítimo')
  assert.equal(hostPermitido('googleapis.com.evil.example'), false)
  assert.equal(hostPermitido('evil-mozilla.com'), false)
})

test('endpoints absurdamente largos se rechazan', () => {
  assert.equal(endpointValido(`https://fcm.googleapis.com/fcm/send/${'x'.repeat(2000)}`), false)
})

// ── UNSUBSCRIBE ─────────────────────────────────────────────────────────────

test('unsubscribe valida el endpoint con la misma allowlist', () => {
  assert.equal(esquemaDesuscribir.safeParse({ endpoint: ENDPOINT_BUENO }).success, true)
  assert.equal(esquemaDesuscribir.safeParse({ endpoint: 'http://interno.local/x' }).success, false)
  assert.equal(
    esquemaDesuscribir.safeParse({ endpoint: ENDPOINT_BUENO, userId: 'x' }).success,
    false,
  )
})

// ── PREFS ───────────────────────────────────────────────────────────────────

test('prefs acepta los tipos conocidos y rechaza los inventados', () => {
  assert.equal(
    esquemaPrefs.safeParse({ te_escucharon: false, revelar_alias: false }).success,
    true,
  )
  assert.equal(esquemaPrefs.safeParse({ racha_diaria: true }).success, false)
  assert.equal(esquemaPrefs.safeParse({ te_escucharon: 'sí' }).success, false)
})

test('prefs acota el horario y el desfase a rangos posibles', () => {
  assert.equal(esquemaPrefs.safeParse({ quietFrom: 1380, quietTo: 480 }).success, true)
  assert.equal(esquemaPrefs.safeParse({ quietFrom: null }).success, true, 'null = por defecto')
  assert.equal(esquemaPrefs.safeParse({ quietFrom: 1440 }).success, false)
  assert.equal(esquemaPrefs.safeParse({ quietFrom: -1 }).success, false)
  assert.equal(esquemaPrefs.safeParse({ tzOffset: 120 }).success, true)
  assert.equal(esquemaPrefs.safeParse({ tzOffset: 900 }).success, false)
  // La zona con nombre identificaría la ciudad; solo se admite el desfase.
  assert.equal(esquemaPrefs.safeParse({ timezone: 'Europe/Madrid' }).success, false)
})
