// ============================================================================
// k6 · feed «Para ti» — 200 → 2 000 VUs, scroll con CURSOR REAL
//
//   k6 run scripts/load/feed.js
//   BASE_URL=http://localhost:3000 LOAD_TEST_TOKEN=xxx k6 run scripts/load/feed.js
//
// LO QUE ESTA PRUEBA DEMUESTRA (y lo que no):
//
// Demuestra que la ruta completa del feed sostiene 2 000 usuarios virtuales con
// un p95 por debajo de 300 ms, y —lo más importante— que la página 50 cuesta lo
// mismo que la página 1. Esa igualdad es la prueba empírica de que el keyset
// funciona; el `EXPLAIN ANALYZE` de scripts/load/EXPLAIN.md es la prueba
// estructural. Hacen falta las dos: el EXPLAIN dice que el plan es correcto,
// k6 dice que sigue siéndolo con 2 000 personas encima.
//
// NO demuestra nada sobre el coste de la CONSULTA: eso se mide con EXPLAIN
// (presupuesto de 50 ms). Aquí se mide lo que siente una persona.
//
// EL SCROLL USA EL CURSOR OPACO REAL, no un offset simulado. Dos razones:
//   1. Es lo que hace la aplicación. Medir un `?pagina=50` que la app no usa es
//      medir con precisión algo que a nadie le importa.
//   2. Un offset simulado ocultaría justo el fallo que buscamos. Si alguien
//      introduce un OFFSET escondido en la implementación del feed, el cursor
//      real lo delata (la página 50 se dispara) y un offset simulado no.
// ============================================================================

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

import { UMBRALES, RAMPAS, baseUrl, cabeceras, codificarCursor, esFalloReal } from './umbrales.js'

/** Latencia de la primera página frente a la profunda. La comparación ES el
 *  resultado de esta prueba. */
const paginaPrimera = new Trend('darma_pagina_1_ms', true)
const paginaProfunda = new Trend('darma_pagina_50_ms', true)

export const options = {
  stages: RAMPAS.feed,
  thresholds: {
    ...UMBRALES.feed,
    // El corazón del argumento del fundador, convertido en umbral: si la
    // página 50 empieza a costar más que la 1, hay un OFFSET escondido y el
    // CI tiene que romperse por ello.
    darma_pagina_50_ms: ['p(95)<300'],
  },
  // Sin esto, k6 aborta el escenario entero al primer error de red y la
  // ejecución no llega a la meseta, que es la parte que se compara.
  throw: false,
}

const TOKEN = __ENV.SESSION_TOKEN || ''

/**
 * Cursor sintético para saltar directamente a "página 50".
 *
 * Se construye con la misma fórmula que `encodeCursor` de lib/feedRanking.ts:
 * base64url de `${hotScore}|${uuid}`. El `hot_score` elegido corresponde
 * aproximadamente al percentil 99,9 hacia abajo de la distribución sembrada —es
 * decir, muy adentro del índice— que es donde un OFFSET escondido dolería.
 *
 * ⚠️ Este valor depende de la SIEMBRA (scripts/seed/sembrar.ts, semilla por
 * defecto). Si se cambia la semilla o la distribución, hay que recalcularlo con:
 *   select hot_score, id from public.posts where state='active'
 *    order by hot_score desc, id desc offset 1000 limit 1;
 * (sí, con OFFSET: es lícito para PREPARAR la prueba, nunca para servirla).
 */
const CURSOR_PROFUNDO = codificarCursor(
  Number(__ENV.CURSOR_SCORE || '-2.5'),
  __ENV.CURSOR_ID || 'ffffffff-ffff-4fff-bfff-ffffffffffff',
)

export default function () {
  const h = cabeceras(TOKEN)

  // ── Página 1 ──────────────────────────────────────────────────────────────
  const r1 = http.get(`${baseUrl()}/api/feed?limite=20`, {
    headers: h,
    tags: { escenario: 'pagina_1' },
  })
  paginaPrimera.add(r1.timings.duration)

  const ok1 = check(r1, {
    'pagina 1: 200': (r) => r.status === 200,
    'pagina 1: no es un fallo real': (r) => !esFalloReal(r),
    'pagina 1: trae items': (r) => {
      try {
        const cuerpo = r.json()
        return cuerpo && cuerpo.ok === true && Array.isArray(cuerpo.data.items)
      } catch (_e) {
        return false
      }
    },
  })

  // ── Scroll con el cursor QUE DEVUELVE EL SERVIDOR ─────────────────────────
  // Es el cursor real, opaco, generado por encodeCursor en el servidor. Pedir
  // la página 2 con él es exactamente lo que hace la aplicación.
  let siguiente = null
  if (ok1) {
    try {
      siguiente = r1.json().data.siguienteCursor
    } catch (_e) {
      siguiente = null
    }
  }

  if (siguiente) {
    const r2 = http.get(
      `${baseUrl()}/api/feed?limite=20&cursor=${encodeURIComponent(siguiente)}`,
      { headers: h, tags: { escenario: 'pagina_2' } },
    )
    check(r2, { 'pagina 2: 200': (r) => r.status === 200 })
  }

  // ── Salto a profundidad ───────────────────────────────────────────────────
  const rProfunda = http.get(
    `${baseUrl()}/api/feed?limite=20&cursor=${encodeURIComponent(CURSOR_PROFUNDO)}`,
    { headers: h, tags: { escenario: 'pagina_50' } },
  )
  paginaProfunda.add(rProfunda.timings.duration)
  check(rProfunda, {
    'pagina 50: 200': (r) => r.status === 200,
    'pagina 50: no es un fallo real': (r) => !esFalloReal(r),
  })

  // Pausa de lectura. Sin ella se mide un bucle cerrado, que no es un scroll:
  // es un bombardeo, y produce un perfil de concurrencia que ningún usuario
  // real genera.
  sleep(Math.random() * 2 + 0.5)
}

/**
 * Resumen final. Se imprime la comparación que da sentido a toda la prueba.
 * `console.warn` y no `console.log` porque el ESLint del proyecto prohíbe el
 * segundo (ver eslint.config.mjs).
 */
export function handleSummary(datos) {
  const p1 = datos.metrics.darma_pagina_1_ms
  const p50 = datos.metrics.darma_pagina_50_ms
  const linea =
    p1 && p50
      ? `keyset: pagina 1 p95=${p1.values['p(95)'].toFixed(1)} ms · ` +
        `pagina 50 p95=${p50.values['p(95)'].toFixed(1)} ms · ` +
        `ratio=${(p50.values['p(95)'] / p1.values['p(95)']).toFixed(2)} (objetivo ≈ 1,0)`
      : 'sin muestras suficientes'

  console.warn(linea)
  return { stdout: `\n${linea}\n` }
}
