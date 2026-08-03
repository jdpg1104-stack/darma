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

// ── Las tres advertencias, en los dos idiomas ───────────────────────────────
//
// `ADVERTENCIAS_RESPALDO` son CLAVES desde que la pantalla se tradujo. El test
// dejó de poder mirar la cadena en español —era la única que había— y ahora
// mira las dos: que la clave exista en `es` y en `en`, y que cada versión siga
// diciendo la cosa dura que tiene que decir.
//
// Las expresiones son deliberadamente concretas. Una comprobación de «que no
// esté vacío» dejaría pasar «tu historial podría verse afectado», que es
// exactamente la clase de suavizado que este test existe para impedir: quien
// lea eso y pierda la frase perderá su historial sin haber entendido nunca que
// lo estaba jugando.

const ADVERTENCIAS_ESPERADAS: ReadonlyArray<{
  clave: string
  es: RegExp
  en: RegExp
}> = [
  {
    clave: 'refugios.respaldo.advertencias.historial',
    es: /puede leer todo tu historial/i,
    en: /can read your entire history/i,
  },
  {
    clave: 'refugios.respaldo.advertencias.irrecuperable',
    es: /Darma no puede recuperarla/i,
    en: /Darma cannot recover it/i,
  },
  {
    clave: 'refugios.respaldo.advertencias.sinCopia',
    es: /cambiar de móvil borra tus conversaciones/i,
    en: /switching phones erases your conversations/i,
  },
]

test('las tres advertencias de la pantalla son claves de catálogo, en el orden de la ficha', () => {
  assert.equal(ADVERTENCIAS_RESPALDO.length, 3)
  assert.deepEqual(
    [...ADVERTENCIAS_RESPALDO],
    ADVERTENCIAS_ESPERADAS.map((a) => a.clave),
  )
})

test('las tres advertencias existen y NO se han suavizado en ninguno de los dos idiomas', async () => {
  const { obtenerTraductor } = await import('../../i18n/index.ts')

  for (const { clave, es, en } of ADVERTENCIAS_ESPERADAS) {
    for (const [locale, esperado] of [
      ['es', es],
      ['en', en],
    ] as const) {
      const texto = obtenerTraductor(locale)(clave)
      // `obtenerTraductor` devuelve la clave tal cual cuando no existe: si eso
      // llegara a la pantalla, alguien vería «refugios.respaldo…» justo antes
      // de decidir sobre su historial.
      assert.notEqual(texto, clave, `falta ${clave} en ${locale}`)
      assert.match(
        texto,
        esperado,
        `«${texto}» ya no dice lo que ${clave} tiene que decir en ${locale}`,
      )
    }
  }
})

test('ninguna advertencia se escuda en un condicional: las tres cosas PASAN', async () => {
  const { obtenerTraductor } = await import('../../i18n/index.ts')

  // «might», «may», «could», «podría», «puede que» convierten un hecho en un
  // riesgo remoto. La única forma verbal de «poder» admitida es la del permiso
  // —«quien tenga la frase PUEDE leer», «Darma NO PUEDE recuperarla»—, que es
  // afirmación, no hipótesis. Por eso la lista prohíbe las construcciones
  // hipotéticas concretas y no el verbo entero.
  const HIPOTETICOS: Readonly<Record<'es' | 'en', RegExp>> = {
    es: /\b(podr[íi]as?|puede que|quiz[áa]s?|tal vez|es posible que)\b/i,
    en: /\b(might|may|could|possibly|potentially)\b/i,
  }

  for (const locale of ['es', 'en'] as const) {
    const t = obtenerTraductor(locale)
    for (const clave of ADVERTENCIAS_RESPALDO) {
      const texto = t(clave)
      assert.doesNotMatch(
        texto,
        HIPOTETICOS[locale],
        `«${texto}» (${clave}, ${locale}) suaviza la advertencia con un condicional`,
      )
    }
  }
})
