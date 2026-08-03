// ============================================================================
// k6 · publicar — 50 → 500 VUs, CON el gate de reciprocidad activo
//
//   k6 run scripts/load/composer.js
//
// LA DECISIÓN QUE DEFINE ESTA PRUEBA: los 403 de reciprocidad NO cuentan como
// fallo.
//
// El gate 3:1 vive en un trigger BEFORE INSERT (`trg_posts_reciprocity`) y
// rechaza a quien no ha escuchado a tres personas. Bajo carga, la mayoría de
// los usuarios virtuales chocará con él — es lo correcto, es el producto
// funcionando. Si se contaran como error:
//
//   · la prueba fallaría siempre,
//   · alguien la desactivaría "hasta arreglarla",
//   · y se perdería la única medición que vigila la ruta de publicar, que es la
//     más cara de la aplicación (incluye la clasificación de riesgo de B11).
//
// Lo que SÍ es fallo: un 5xx, un timeout, o que el rechazo de reciprocidad
// tarde más de lo debido. Un gate lento es un gate que el usuario percibe como
// una caída, y la excusa de "es que lo rechazamos" no lo arregla.
//
// ⚠️ ESTA PRUEBA ESCRIBE. Solo contra una base local sembrada. Contra un
// entorno compartido inserta cientos de miles de posts sintéticos que luego
// nadie sabe distinguir de los reales.
// ============================================================================

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

import { UMBRALES, RAMPAS, baseUrl, cabeceras, esFalloReal } from './umbrales.js'

/** Cuántas publicaciones frena el gate. NO es un error: es el producto. */
const rechazosReciprocidad = new Counter('darma_gate_reciprocidad')
const publicaciones = new Counter('darma_publicaciones_ok')
/** Latencia del rechazo. Un "no" lento se siente como una caída. */
const latenciaRechazo = new Trend('darma_gate_rechazo_ms', true)

export const options = {
  stages: RAMPAS.composer,
  thresholds: {
    ...UMBRALES.composer,
    // Rechazar tiene que ser BARATO: el gate se resuelve en el UPDATE del
    // trigger, sin llamar al clasificador. Si esto sube, es que algo está
    // clasificando texto antes de comprobar el permiso — trabajo caro tirado.
    darma_gate_rechazo_ms: ['p(95)<300'],
  },
  throw: false,
}

const TOKEN = __ENV.SESSION_TOKEN || ''

/**
 * Cuerpos sintéticos. Deliberadamente ANODINOS y por debajo de cualquier umbral
 * del clasificador de crisis: una prueba de carga que dispare `evaluarRiesgo()`
 * a nivel `high` estaría llenando `crisis_events` de falsas alarmas y midiendo,
 * de paso, el camino de crisis — que no se prueba con carga sintética, se
 * prueba con casos reales revisados a mano.
 */
const CUERPOS = [
  'Prueba de carga sintetica. Este texto no procede de ninguna persona y no describe ninguna situacion real.',
  'Fila generada por k6 para medir la latencia del composer. Contenido de relleno, sin significado.',
  'Texto neutro de banco de pruebas para el escenario de publicacion. No contiene informacion personal.',
]

export default function () {
  const cuerpo = JSON.stringify({
    kind: 'desahogo',
    body: CUERPOS[Math.floor(Math.random() * CUERPOS.length)],
    topic: 'pruebas',
  })

  const r = http.post(`${baseUrl()}/api/posts`, cuerpo, {
    headers: cabeceras(TOKEN),
    tags: { escenario: 'publicar' },
  })

  if (r.status === 403) {
    rechazosReciprocidad.add(1)
    latenciaRechazo.add(r.timings.duration)
  } else if (r.status === 201 || r.status === 200) {
    publicaciones.add(1)
  }

  check(r, {
    'publicar: sin 5xx': (r2) => r2.status < 500,
    'publicar: el rechazo lleva codigo estable': (r2) => {
      if (r2.status !== 403) return true
      try {
        const j = r2.json()
        // El contrato de errores (CONTRATOS.md §4): un código estable, no un
        // mensaje de plpgsql. Que el cliente pueda hacer switch sobre él es lo
        // que permite pintar "te faltan 2 escuchas" en vez de un error genérico.
        return typeof j.error === 'string' || typeof j.code === 'string'
      } catch (_e) {
        return false
      }
    },
    'publicar: no filtra detalle interno': (r2) => {
      const t = r2.body ? String(r2.body) : ''
      return !/postgres|pg_|constraint|plpgsql|supabase\.co/i.test(t)
    },
    'publicar: no es un fallo real': (r2) => !esFalloReal(r2),
  })

  sleep(Math.random() * 3 + 1)
}

export function handleSummary(datos) {
  const gate = datos.metrics.darma_gate_reciprocidad
  const ok = datos.metrics.darma_publicaciones_ok
  const linea =
    `composer: ${ok ? ok.values.count : 0} publicaciones · ` +
    `${gate ? gate.values.count : 0} frenadas por el gate 3:1 (esperado, no es un fallo)`
  console.warn(linea)
  return { stdout: `\n${linea}\n` }
}
