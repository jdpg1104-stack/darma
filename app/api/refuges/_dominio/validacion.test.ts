// ============================================================================
// B10 · Pruebas de la superficie de entrada de /api/refuges/*
//
// Casos 9, 11 y 12 de HANDOFF/B10.md, más los cerrojos de `.strict()`.
//
// La prueba nº 11 (`POST /api/refuges/crisis` con un campo `texto` → 422) es
// OBLIGATORIA: es la que impide que alguien añada «solo un preview» dentro de
// seis meses y que el servidor acabe guardando texto en claro de un refugio.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bytesDeBase64,
  cursorBandeja,
  cursorHilo,
  esquemaBloquear,
  esquemaCrearRefugio,
  esquemaCrisis,
  esquemaEnviarMensaje,
  esquemaLeido,
  esquemaLimite,
  esquemaNotaKindred,
  esquemaPublicarClave,
  esquemaSobre,
  leerCursorBandeja,
  leerCursorHilo,
} from './validacion.ts'
import { CAMPOS_PROHIBIDOS, CLAVES_ALMA_AFIN, aAlmaAfin } from './proyecciones.ts'

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTRO_UUID = '9f2504e0-4f89-11d3-9a0c-0305e82c3302'
const HUELLA = 'a'.repeat(64)

// ── 11 · el cerrojo del texto en claro ──────────────────────────────────────

test('OBLIGATORIA · POST /api/refuges/crisis con un campo `texto` es entrada inválida', () => {
  const valido = esquemaCrisis.safeParse({ refugeId: UUID, risk: 'critical' })
  assert.equal(valido.success, true, 'el cuerpo legítimo debe pasar')

  for (const contrabando of ['texto', 'preview', 'mensaje', 'body', 'fragmento', 'contenido']) {
    const resultado = esquemaCrisis.safeParse({
      refugeId: UUID,
      risk: 'critical',
      [contrabando]: 'esta noche voy a acabar con todo',
    })
    assert.equal(resultado.success, false, `«${contrabando}» NO puede colarse en el cuerpo de crisis`)
  }
})

test('los recursos de crisis son identificadores, no texto libre', () => {
  assert.equal(esquemaCrisis.safeParse({ refugeId: UUID, risk: 'high', recursos: ['ES:024', 'lifeline_988'] }).success, true)
  // Un «recurso» con espacios y puntuación sería texto libre disfrazado.
  assert.equal(
    esquemaCrisis.safeParse({ refugeId: UUID, risk: 'high', recursos: ['le dije que no podía más'] }).success,
    false,
  )
})

test('todos los esquemas del bloque rechazan campos no declarados', () => {
  const casos: Array<[string, { safeParse: (v: unknown) => { success: boolean } }, Record<string, unknown>]> = [
    ['crearRefugio', esquemaCrearRefugio, { kind: 'duo', miembros: [UUID] }],
    ['enviarMensaje', esquemaEnviarMensaje, { ciphertextB64: 'QUJDRA==', nonceB64: 'QUJDREVGR0hJSktM', encVersion: 1, kind: 'text', byteSize: 4 }],
    ['leido', esquemaLeido, { hastaId: 10 }],
    ['bloquear', esquemaBloquear, { userId: UUID }],
    ['notaKindred', esquemaNotaKindred, { note: 'me escuchó en enero' }],
    ['sobre', esquemaSobre, { recipientId: UUID, wrappedKeyB64: 'QUJDRA==', wrapNonceB64: 'QUJDRA==', senderFingerprint: HUELLA }],
  ]

  for (const [nombre, esquema, base] of casos) {
    assert.equal(esquema.safeParse(base).success, true, `${nombre}: el caso legítimo debe pasar`)
    assert.equal(
      esquema.safeParse({ ...base, textoEnClaro: 'lo que escribí' }).success,
      false,
      `${nombre}: un campo de más tiene que ser 422`,
    )
  }
})

test('FALLO · una JWK con la componente privada `d` no se puede publicar', () => {
  const publica = { kty: 'EC', crv: 'P-256', x: 'AQID', y: 'BAUG' }
  assert.equal(esquemaPublicarClave.safeParse({ publicJwk: publica, fingerprint: HUELLA }).success, true)

  const conPrivada = { ...publica, d: 'ESTO-ES-LA-CLAVE-PRIVADA' }
  assert.equal(
    esquemaPublicarClave.safeParse({ publicJwk: conPrivada, fingerprint: HUELLA }).success,
    false,
    'subir la clave privada al servidor acabaría con el cifrado extremo a extremo',
  )
})

test('FALLO · una curva distinta de P-256 no se acepta', () => {
  assert.equal(
    esquemaPublicarClave.safeParse({
      publicJwk: { kty: 'EC', crv: 'P-521', x: 'AQID', y: 'BAUG' },
      fingerprint: HUELLA,
    }).success,
    false,
  )
})

// ── 9 · cursores ────────────────────────────────────────────────────────────

test('el cursor del hilo es opaco pero de ida y vuelta', () => {
  const cursor = cursorHilo(123456)
  assert.doesNotMatch(cursor, /^\d+$/, 'el cursor no puede ser el id a pelo')
  assert.equal(leerCursorHilo(cursor), 123456)
  assert.equal(leerCursorHilo(null), null)
})

test('FALLO · un cursor corrupto es entrada inválida, no un 500 ni una página rara', () => {
  for (const malo of ['no-es-base64!!', Buffer.from('-1').toString('base64'), Buffer.from('0').toString('base64'), Buffer.from('abc').toString('base64'), Buffer.from('9'.repeat(30)).toString('base64')]) {
    assert.throws(() => leerCursorHilo(malo), /cursor inválido/, `«${malo}» debería rechazarse`)
  }
})

test('el cursor de la bandeja lleva las DOS componentes de la tupla que ordena', () => {
  const cursor = cursorBandeja('2026-08-03T10:00:00.000Z', UUID)
  const leido = leerCursorBandeja(cursor)
  assert.equal(leido?.id, UUID)
  assert.equal(leido?.ts, '2026-08-03T10:00:00.000Z')
})

test('FALLO · un cursor de bandeja sin uuid válido se rechaza', () => {
  const malo = Buffer.from('1700000000000|no-soy-un-uuid', 'utf8').toString('base64')
  assert.throws(() => leerCursorBandeja(malo), /cursor inválido/)
})

test('el límite de página está acotado a 50 (CONTRATOS §5)', () => {
  assert.equal(esquemaLimite.parse(undefined), 20)
  assert.equal(esquemaLimite.parse('50'), 50)
  assert.equal(esquemaLimite.safeParse('51').success, false)
  assert.equal(esquemaLimite.safeParse('0').success, false)
  assert.equal(esquemaLimite.safeParse('-5').success, false)
})

// ── Tamaños ─────────────────────────────────────────────────────────────────

test('bytesDeBase64 cuenta bien el relleno', () => {
  assert.equal(bytesDeBase64('QQ=='), 1)
  assert.equal(bytesDeBase64('QUI='), 2)
  assert.equal(bytesDeBase64('QUJD'), 3)
  assert.equal(bytesDeBase64('QUJDRA=='), 4)
})

test('un refugio es de 2 a 8 personas: como mucho 7 invitados', () => {
  const siete = Array.from({ length: 7 }, (_, i) => `3f2504e0-4f89-11d3-9a0c-0305e82c33${String(10 + i)}`)
  assert.equal(esquemaCrearRefugio.safeParse({ kind: 'circulo', miembros: siete }).success, true)
  assert.equal(
    esquemaCrearRefugio.safeParse({ kind: 'circulo', miembros: [...siete, OTRO_UUID] }).success,
    false,
    'a partir de ~8 deja de ser un refugio y pasa a ser un foro',
  )
  assert.equal(esquemaCrearRefugio.safeParse({ kind: 'duo', miembros: [] }).success, false)
})

test('no se puede enviar un mensaje de tipo `audio`: en este bloque no existe', () => {
  const base = { ciphertextB64: 'QUJDRA==', nonceB64: 'QUJDREVGR0hJSktM', encVersion: 1, byteSize: 4 }
  assert.equal(esquemaEnviarMensaje.safeParse({ ...base, kind: 'text' }).success, true)
  assert.equal(esquemaEnviarMensaje.safeParse({ ...base, kind: 'system' }).success, true)
  assert.equal(esquemaEnviarMensaje.safeParse({ ...base, kind: 'audio' }).success, false)
})

// ── 12 · la forma de AlmaAfin ───────────────────────────────────────────────

test('OBLIGATORIA · una respuesta de kindred no lleva NI UN campo privado', () => {
  const fila = {
    kindred_id: UUID,
    note: 'me escuchó en enero',
    profiles: {
      id: UUID,
      alias: 'nube_serena',
      avatar_seed: 'seed-1',
      level: 'guia' as const,
      karma_reputation: 2100,
      availability: 'necesito_hablar' as const,
      // Aunque la consulta trajera de más —o alguien cambiara el select—, la
      // proyección explícita no los deja salir.
      karma_spendable: 999,
      crystals: 42,
      shadow_banned: true,
      email: 'persona@ejemplo.com',
    },
  }

  const alma = aAlmaAfin(fila as unknown as Parameters<typeof aAlmaAfin>[0])
  assert.ok(alma)
  assert.deepEqual(Object.keys(alma).sort(), [...CLAVES_ALMA_AFIN].sort())

  const serializado = JSON.stringify(alma)
  for (const prohibido of CAMPOS_PROHIBIDOS) {
    assert.doesNotMatch(serializado, new RegExp(prohibido, 'i'), `«${prohibido}» no puede aparecer en la respuesta`)
  }
})

test('esMentor se deriva del nivel, no viene del cliente', () => {
  const base = {
    kindred_id: UUID,
    note: null,
    profiles: { id: UUID, alias: 'a', avatar_seed: 's', karma_reputation: 0, availability: 'disponible' as const },
  }
  const guia = aAlmaAfin({ ...base, profiles: { ...base.profiles, level: 'guia' } })
  const mentor = aAlmaAfin({ ...base, profiles: { ...base.profiles, level: 'mentor' } })
  assert.equal(guia?.esMentor, false)
  assert.equal(mentor?.esMentor, true)
})

test('un contacto cuyo perfil ya no existe se descarta en vez de salir a medias', () => {
  assert.equal(aAlmaAfin({ kindred_id: UUID, note: null, profiles: null }), null)
})
