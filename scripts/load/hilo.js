// ============================================================================
// k6 · hilo — 100 → 1 000 VUs leyendo un post y sus comentarios, y comentando
//
//   k6 run scripts/load/hilo.js
//   POST_IDS=uuid1,uuid2,uuid3 k6 run scripts/load/hilo.js
//
// El hilo es la pantalla donde de verdad ocurre Darma: alguien lee lo que otra
// persona escribió y decide responder. Se mide por separado del feed porque su
// perfil de acceso es opuesto:
//
//   · el feed lee la PUNTA de un índice ordenado por score,
//   · el hilo hace un salto por PK y luego recorre `idx_comments_post`
//     (post_id, created_at) where state='active' — un rango estrecho dentro de
//     un índice enorme.
//
// El caso caro no es el hilo medio (3 comentarios): es el hilo de 400 de un
// post que se hizo viral. La siembra genera esa cola larga a propósito
// (`colaLarga` en scripts/seed/perfilesFalsos.ts), así que POST_IDS debe
// apuntar a hilos GRANDES o esta prueba medirá el caso fácil y dirá que todo va
// bien. Para obtenerlos:
//
//   select id, reply_count from public.posts
//    where state = 'active' order by reply_count desc limit 5;
// ============================================================================

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

import { UMBRALES, RAMPAS, baseUrl, cabeceras, esFalloReal } from './umbrales.js'

const lecturaHilo = new Trend('darma_hilo_lectura_ms', true)
const escrituraComentario = new Trend('darma_hilo_comentario_ms', true)

export const options = {
  stages: RAMPAS.hilo,
  thresholds: {
    ...UMBRALES.hilo,
    darma_hilo_lectura_ms: ['p(95)<400'],
  },
  throw: false,
}

const TOKEN = __ENV.SESSION_TOKEN || ''

/**
 * Posts a martillear. Sin `POST_IDS`, la prueba no se inventa uuids: aborta.
 *
 * Un uuid inventado devuelve 404 en todas las peticiones, y 404 es barato: la
 * prueba pasaría con unos números excelentes que no miden absolutamente nada.
 * Es la forma más común de que una prueba de carga mienta.
 */
const IDS = (__ENV.POST_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

export function setup() {
  if (IDS.length === 0) {
    throw new Error(
      'Falta POST_IDS. Obtén hilos grandes de la base sembrada:\n' +
        "  psql \"$DATABASE_URL\" -c \"select id from public.posts where state='active' order by reply_count desc limit 5;\"",
    )
  }
  return { ids: IDS }
}

export default function (datos) {
  const id = datos.ids[Math.floor(Math.random() * datos.ids.length)]
  const h = cabeceras(TOKEN)

  // ── Leer el hilo ──────────────────────────────────────────────────────────
  const r = http.get(`${baseUrl()}/api/comments?postId=${id}&limite=20`, {
    headers: h,
    tags: { escenario: 'leer_hilo' },
  })
  lecturaHilo.add(r.timings.duration)

  check(r, {
    'hilo: 200': (x) => x.status === 200,
    'hilo: no es un fallo real': (x) => !esFalloReal(x),
    'hilo: cursor opaco, nunca un offset': (x) => {
      try {
        const j = x.json()
        const c = j && j.data ? j.data.siguienteCursor : null
        // Un cursor que sea un número es un OFFSET disfrazado, y el coste de la
        // paginación volverá a crecer con la profundidad.
        return c === null || c === undefined || (typeof c === 'string' && !/^\d+$/.test(c))
      } catch (_e) {
        return false
      }
    },
  })

  // ── Comentar (1 de cada 5 lecturas) ───────────────────────────────────────
  // La proporción importa: en una red de apoyo se lee mucho más de lo que se
  // escribe, y una prueba con 50 % de escrituras mediría una aplicación que no
  // existe (y saturaría el rate limit por una razón artificial).
  if (Math.random() < 0.2) {
    const rc = http.post(
      `${baseUrl()}/api/comments`,
      JSON.stringify({
        postId: id,
        body:
          'Comentario sintetico de prueba de carga. Texto neutro, sin contenido real, ' +
          'generado por k6 para medir la latencia de escritura del hilo.',
      }),
      { headers: h, tags: { escenario: 'comentar' } },
    )
    escrituraComentario.add(rc.timings.duration)

    check(rc, {
      'comentar: sin 5xx': (x) => x.status < 500,
      'comentar: no filtra detalle interno': (x) => {
        const t = x.body ? String(x.body) : ''
        return !/postgres|pg_|constraint|plpgsql|supabase\.co/i.test(t)
      },
    })
  }

  sleep(Math.random() * 4 + 1)
}

export function handleSummary(datos) {
  const lectura = datos.metrics.darma_hilo_lectura_ms
  const escritura = datos.metrics.darma_hilo_comentario_ms
  const linea =
    `hilo: lectura p95=${lectura ? lectura.values['p(95)'].toFixed(1) : '—'} ms · ` +
    `comentario p95=${escritura ? escritura.values['p(95)'].toFixed(1) : '—'} ms`
  console.warn(linea)
  return { stdout: `\n${linea}\n` }
}
