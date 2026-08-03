import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BASE_ESPERA_MS,
  MAX_ESPERA_MS,
  clasificarFalloHttp,
  siguienteCooldown,
  siguienteEspera,
} from './backoff.ts'

// ── Prueba exigida nº 1 ─────────────────────────────────────────────────────

test('siguienteEspera crece exponencialmente entre 0 y 8', () => {
  // Jitter fijado al centro (0,5 → factor 1,0) para poder comparar la curva.
  const sin = (n: number): number => siguienteEspera(n, () => 0.5)

  assert.equal(sin(0), BASE_ESPERA_MS)
  assert.equal(sin(1), BASE_ESPERA_MS * 2)
  assert.equal(sin(2), BASE_ESPERA_MS * 4)
  assert.equal(sin(3), BASE_ESPERA_MS * 8)

  for (let n = 1; n <= 8; n++) {
    assert.ok(sin(n) >= sin(n - 1), `la espera de ${n} no puede ser menor que la de ${n - 1}`)
  }
})

test('siguienteEspera se topa en 6 h y no la supera nunca', () => {
  for (let n = 0; n <= 8; n++) {
    // Con el jitter en su máximo (factor 1,5) el valor sigue acotado por 1,5·tope.
    const maximo = siguienteEspera(n, () => 0.999999)
    assert.ok(maximo <= MAX_ESPERA_MS * 1.5, `n=${n} se pasó del techo`)
  }
  // A partir de n = 9 la base ya está saturada: el techo manda.
  assert.equal(siguienteEspera(9, () => 0.5), MAX_ESPERA_MS)
  assert.equal(siguienteEspera(50, () => 0.5), MAX_ESPERA_MS)
  // Un contador corrupto no debe producir Infinity.
  assert.ok(Number.isFinite(siguienteEspera(5000)))
  assert.ok(Number.isFinite(siguienteEspera(Number.POSITIVE_INFINITY)))
})

test('hay JITTER: el mismo n no devuelve dos veces el mismo valor', () => {
  // El jitter es lo que impide que ocho fuentes caídas a la vez reintenten a la
  // vez para siempre. Sin él, este test pasaría con una constante.
  for (const n of [0, 3, 8]) {
    const muestras = new Set<number>()
    for (let i = 0; i < 50; i++) muestras.add(siguienteEspera(n))
    assert.ok(muestras.size > 40, `n=${n}: solo ${muestras.size} valores distintos en 50 muestras`)
  }
})

test('el jitter nunca produce una espera de cero (eso sería un reintento inmediato)', () => {
  for (let i = 0; i < 200; i++) {
    assert.ok(siguienteEspera(0) >= BASE_ESPERA_MS * 0.5)
  }
})

test('siguienteCooldown devuelve un instante en el futuro', () => {
  const ahora = new Date('2026-08-03T00:00:00.000Z')
  const hasta = siguienteCooldown(2, ahora, () => 0.5)
  assert.ok(hasta.getTime() > ahora.getTime())
  assert.equal(hasta.getTime() - ahora.getTime(), BASE_ESPERA_MS * 4)
})

// ── Política de reintento por código (base de la prueba exigida nº 9) ────────

test('429 y 5xx reintentan; el resto de 4xx deshabilita la fuente', () => {
  assert.equal(clasificarFalloHttp(429), 'reintentar')
  assert.equal(clasificarFalloHttp(500), 'reintentar')
  assert.equal(clasificarFalloHttp(503), 'reintentar')

  assert.equal(clasificarFalloHttp(404), 'deshabilitar')
  assert.equal(clasificarFalloHttp(401), 'deshabilitar')
  assert.equal(clasificarFalloHttp(403), 'deshabilitar')
  assert.equal(clasificarFalloHttp(410), 'deshabilitar')
})

test('sin respuesta (red caída) se REINTENTA: es indistinguible de un 5xx', () => {
  // Camino de fallo. Tratarlo como definitivo apagaría fuentes buenas cada vez
  // que hubiera un corte de red.
  assert.equal(clasificarFalloHttp(null), 'reintentar')
})
