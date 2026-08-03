// ============================================================================
// Umbrales compartidos de k6 · lo que ROMPE el CI
//
// Viven en un solo archivo y se importan. Un umbral duplicado en tres escenarios
// se relaja en uno y nadie se entera: el CI sigue verde, la regresión entra, y
// el número que alguien cita en una reunión seis meses después mide otra cosa.
//
// k6 sale con código ≠ 0 cuando incumple un `threshold`. Eso es exactamente lo
// que hace fallar el workflow (pendiente: que B15 añada el paso, ver
// HANDOFF/PEDIDOS.md). Sin ese código de salida, una prueba de carga es un
// informe bonito que nadie lee.
//
// Los números son los mismos de lib/observability/presupuestos.ts y de
// CONTRATOS.md §11. Si cambian allí, cambian aquí — y al revés.
// ============================================================================

/** Ratio máximo de peticiones fallidas: 0,1 %. */
export const RATIO_FALLOS = 0.001

export const UMBRALES = {
  feed: {
    // p95 de la ruta completa, no de la consulta. La consulta tiene su propio
    // presupuesto (50 ms) y se mide con EXPLAIN ANALYZE, no con k6: k6 mide lo
    // que siente el usuario, que incluye red, TLS, render y serialización.
    http_req_duration: ['p(95)<300'],
    http_req_failed: [`rate<${RATIO_FALLOS}`],
    // Que la MEDIANA también esté acotada evita el escenario en el que el p95
    // pasa a base de que casi todas las peticiones sean errores rapidísimos.
    'http_req_duration{expected_response:true}': ['p(50)<150'],
    checks: ['rate>0.99'],
  },

  composer: {
    // 800 ms incluyen la clasificación de riesgo de B11: publicar pasa por
    // evaluarRiesgo() antes de persistir (CONTRATOS.md §9), y ese coste es
    // parte del producto, no una excusa.
    http_req_duration: ['p(95)<800'],
    // OJO: aquí NO se pone un umbral sobre http_req_failed. Ver `esFalloReal`.
    'http_req_failed{escenario:publicar}': [`rate<${RATIO_FALLOS}`],
    checks: ['rate>0.99'],
  },

  hilo: {
    http_req_duration: ['p(95)<400'],
    http_req_failed: [`rate<${RATIO_FALLOS}`],
    checks: ['rate>0.99'],
  },
}

/**
 * ¿Cuenta esta respuesta como fallo de la prueba de carga?
 *
 * UN 403 DE RECIPROCIDAD NO ES UN FALLO. Es el producto funcionando: el gate
 * 3:1 rechazando a quien no ha escuchado a nadie. Si se contara como error, la
 * prueba del composer fallaría siempre y acabaría desactivada — y con ella, la
 * única medición que vigila la ruta de publicar.
 *
 * Un 429 tampoco: es `check_rate_limit` haciendo su trabajo. Lo que sí es fallo
 * es un 5xx, un timeout o un 404 (una ruta que no existe).
 */
export function esFalloReal(respuesta) {
  if (respuesta.status === 0) return true // timeout / conexión caída
  if (respuesta.status === 403 || respuesta.status === 429) return false
  return respuesta.status >= 400
}

/**
 * Rampas. `stages` y no `constant-vus` a propósito: una carga que aparece de
 * golpe mide el arranque en frío y el escalado de Vercel, no el estado
 * estacionario. Una rampa mide las dos cosas por separado, y la meseta es la
 * que se compara entre ejecuciones.
 */
export const RAMPAS = {
  feed: [
    { duration: '1m', target: 200 },
    { duration: '2m', target: 800 },
    { duration: '3m', target: 2000 },
    { duration: '3m', target: 2000 }, // meseta: esto es lo que se compara
    { duration: '1m', target: 0 },
  ],
  composer: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 500 },
    { duration: '1m', target: 0 },
  ],
  hilo: [
    { duration: '1m', target: 100 },
    { duration: '2m', target: 500 },
    { duration: '3m', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
}

/** URL base. Nunca apunta a producción por defecto. */
export function baseUrl() {
  return __ENV.BASE_URL || 'http://localhost:3000'
}

/**
 * Cabeceras comunes.
 *
 * ⚠️ `x-darma-load-test` SOLO se envía si `LOAD_TEST_TOKEN` está presente en el
 * entorno de quien ejecuta k6, y el backend SOLO debe reconocerla si la misma
 * variable existe en SU entorno. Esa variable NO EXISTE EN PRODUCCIÓN, y no
 * puede existir: una cabecera que salta el rate limit en producción es una vía
 * abierta para saltarse todos los límites de la aplicación —publicar sin
 * frenos, votar sin frenos, sondear sin frenos— con solo conocer un nombre de
 * cabecera. Falla CERRADO: sin variable, ningún atajo.
 *
 * Sin este atajo en local, la prueba mide cuánto tarda nuestro propio 429, que
 * no es una medida de nada.
 */
export function cabeceras(token) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Cookie = `sb-access-token=${token}`
  if (__ENV.LOAD_TEST_TOKEN) h['x-darma-load-test'] = __ENV.LOAD_TEST_TOKEN
  return h
}

/**
 * Espejo EXACTO de encodeCursor() de lib/feedRanking.ts:
 * base64url de `${hotScore}|${id}`.
 *
 * k6 no puede importar TypeScript, así que la fórmula está duplicada. Es la
 * única duplicación aceptada de este bloque, y va con este aviso: si alguien
 * cambia el formato del cursor allí, esta función deja de producir cursores
 * válidos y el escenario de scroll profundo medirá la primera página una y otra
 * vez — es decir, mentirá diciendo que todo va rapidísimo.
 */
export function codificarCursor(hotScore, id) {
  const crudo = `${hotScore}|${id}`
  // base64url: sin relleno y con - _ en vez de + /.
  return b64(crudo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function b64(texto) {
  let salida = ''
  for (let i = 0; i < texto.length; i += 3) {
    const a = texto.charCodeAt(i)
    const b = texto.charCodeAt(i + 1)
    const c = texto.charCodeAt(i + 2)
    salida += ALFABETO[a >> 2]
    salida += ALFABETO[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)]
    salida += isNaN(b) ? '=' : ALFABETO[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)]
    salida += isNaN(c) ? '=' : ALFABETO[c & 63]
  }
  return salida
}
