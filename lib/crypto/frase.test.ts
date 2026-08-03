// ============================================================================
// B10 · Pruebas de la frase de recuperación y de la copia de seguridad.
// Caso 6 de HANDOFF/B10.md, más las invariantes de la lista de palabras.
//
// El caso de fallo importante es el último: con UNA palabra cambiada, la
// recuperación falla y el mensaje NO dice cuál. Ese detalle es la diferencia
// entre 2^96 y doce problemas de 256.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PALABRAS,
  PALABRAS_POR_FRASE,
  bytesAFrase,
  crearFraseRecuperacionSincrona,
  fraseABytes,
  normalizarFrase,
} from './frase.ts'
import { ADVERTENCIAS_RESPALDO, PBKDF2_ITERACIONES, abrirRespaldo, crearRespaldo } from './respaldo.ts'
import { generarParIdentidad, publicarIdentidad } from './index.ts'

// ── La lista ────────────────────────────────────────────────────────────────

test('la lista tiene exactamente 256 palabras y ninguna repetida', () => {
  assert.equal(PALABRAS.length, 256)
  assert.equal(new Set(PALABRAS).size, 256)
})

test('las palabras se pueden dictar: sin tildes, sin eñes, 4 letras o más', () => {
  for (const p of PALABRAS) {
    assert.match(p, /^[a-z]{4,}$/, `«${p}» no cumple la regla de la lista`)
  }
})

test('las cuatro primeras letras son únicas: una palabra truncada sigue siendo interpretable', () => {
  const prefijos = new Set(PALABRAS.map((p) => p.slice(0, 4)))
  assert.equal(prefijos.size, 256)
})

// ── Frase ↔ bytes ───────────────────────────────────────────────────────────

test('una frase nueva son 12 palabras de la lista', () => {
  const frase = crearFraseRecuperacionSincrona()
  assert.equal(frase.length, PALABRAS_POR_FRASE)
  for (const p of frase) assert.ok(PALABRAS.includes(p))
})

test('dos frases seguidas no coinciden (el azar viene de getRandomValues)', () => {
  const a = crearFraseRecuperacionSincrona().join(' ')
  const b = crearFraseRecuperacionSincrona().join(' ')
  assert.notEqual(a, b)
})

test('frase → bytes → frase es la identidad', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255, 128, 64])
  assert.deepEqual(fraseABytes(bytesAFrase(bytes)), bytes)
})

test('normalizarFrase perdona mayúsculas, tildes, comas y espacios de más', () => {
  const frase = crearFraseRecuperacionSincrona()
  const escritaARegañadientes = frase
    .map((p, i) => (i % 2 === 0 ? p.toUpperCase() : p))
    .join(',   ')
  assert.deepEqual(normalizarFrase(escritaARegañadientes), frase)
  assert.deepEqual(normalizarFrase('  ábeja   abrigo\n'), ['abeja', 'abrigo'])
})

test('FALLO · una palabra que no está en la lista invalida la frase entera', () => {
  const frase = crearFraseRecuperacionSincrona()
  frase[6] = 'palabrainventada'
  assert.throws(() => fraseABytes(frase), /no es válida/)
})

test('FALLO · el error de la frase NO dice qué palabra falla', () => {
  const frase = crearFraseRecuperacionSincrona()
  const original = frase[6]
  frase[6] = 'palabrainventada'

  try {
    fraseABytes(frase)
    assert.fail('debería haber lanzado')
  } catch (error) {
    const mensaje = (error as Error).message
    assert.doesNotMatch(mensaje, /palabrainventada/)
    assert.doesNotMatch(mensaje, new RegExp(original))
    assert.doesNotMatch(mensaje, /\b[6-7]\b/, 'el mensaje no puede señalar la posición')
  }
})

test('FALLO · una frase de longitud distinta a 12 no vale', () => {
  const frase = crearFraseRecuperacionSincrona()
  assert.throws(() => fraseABytes(frase.slice(0, 11)), /no es válida/)
  assert.throws(() => fraseABytes([...frase, PALABRAS[0]]), /no es válida/)
})

// ── Copia de seguridad completa ─────────────────────────────────────────────

test('12 palabras → PBKDF2 → envolver → desenvolver recupera la identidad', async () => {
  const par = await generarParIdentidad(true)
  const { fingerprint } = await publicarIdentidad(par)
  const frase = crearFraseRecuperacionSincrona()

  const respaldo = await crearRespaldo(par.privateKey, frase)
  assert.ok(respaldo.kdfIterations >= 600_000, 'el suelo de iteraciones es parte del diseño')
  assert.equal(respaldo.kdfIterations, PBKDF2_ITERACIONES)

  const recuperada = await abrirRespaldo(respaldo, frase.join(' '))
  // La huella recuperada es la MISMA: si no lo fuera, la otra persona vería un
  // aviso de cambio de dispositivo al recuperar, que es justo lo que no debe
  // pasar cuando la copia funciona.
  assert.equal(recuperada.fingerprint, fingerprint)
})

test('FALLO · con UNA palabra cambiada la copia no abre, y el error no dice cuál', async () => {
  const par = await generarParIdentidad(true)
  const frase = crearFraseRecuperacionSincrona()
  const respaldo = await crearRespaldo(par.privateKey, frase)

  // Una sola palabra, sustituida por otra que SÍ está en la lista: el fallo no
  // puede venir de que la palabra no exista, tiene que venir del KDF.
  const mala = [...frase]
  mala[3] = PALABRAS[(PALABRAS.indexOf(frase[3]) + 1) % PALABRAS.length]

  await assert.rejects(
    () => abrirRespaldo(respaldo, mala.join(' ')),
    (error: Error) => {
      assert.match(error.message, /No hemos podido abrir la copia/)
      assert.doesNotMatch(error.message, /\d/, 'no puede decir la posición de la palabra')
      assert.doesNotMatch(error.message, new RegExp(mala[3]))
      return true
    },
  )
})

test('FALLO · la copia de otra persona no se abre con tu frase', async () => {
  const mia = await generarParIdentidad(true)
  const ajena = await generarParIdentidad(true)
  const miFrase = crearFraseRecuperacionSincrona()
  const suFrase = crearFraseRecuperacionSincrona()

  const suRespaldo = await crearRespaldo(ajena.privateKey, suFrase)
  await assert.rejects(() => abrirRespaldo(suRespaldo, miFrase.join(' ')))

  // Y el control positivo, para que la prueba no pase por «todo falla».
  const miRespaldo = await crearRespaldo(mia.privateKey, miFrase)
  await abrirRespaldo(miRespaldo, miFrase.join(' '))
})

test('las tres advertencias de la pantalla están escritas y son las de la ficha', () => {
  assert.equal(ADVERTENCIAS_RESPALDO.length, 3)
  assert.match(ADVERTENCIAS_RESPALDO[0], /puede leer todo tu historial/)
  assert.match(ADVERTENCIAS_RESPALDO[1], /Darma no puede recuperarla/)
  assert.match(ADVERTENCIAS_RESPALDO[2], /cambiar de móvil borra tus conversaciones/)
})
