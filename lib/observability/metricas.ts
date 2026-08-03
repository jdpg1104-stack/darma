// ============================================================================
// Las cuatro señales doradas · latencia, tráfico, errores y saturación
//
// POR QUÉ HISTOGRAMAS Y NO MEDIAS. Con 100 000 usuarios la media es una mentira
// cómoda: 95 peticiones de 40 ms y 5 de 4 s dan una media de 238 ms, un número
// que parece sano y que describe a nadie. Las 5 personas que esperaron 4 s son
// justo las que se van. Aquí todo se acumula en cubos fijos y se reporta por
// percentil (p50/p95/p99), que es lo único que responde a "¿cómo de mal le va a
// la peor parte de mi gente?".
//
// POR QUÉ CUBOS FIJOS Y NO t-digest / percentiles exactos. Un percentil exacto
// exige guardar todas las muestras; en una función serverless que se recicla
// cada pocos minutos eso es memoria tirada. Los cubos son O(1) en memoria, se
// suman entre instancias sin error (un histograma de Prometheus es aditivo) y
// el error de interpolación dentro de un cubo es irrelevante frente a la
// decisión que se toma con el número.
//
// ⚠️ LOS CONTADORES SON POR INSTANCIA. En Vercel no existe "el" servidor: cada
// invocación puede caer en un proceso distinto, con su propio Map en su propia
// RAM. Un contador que suma 10 aquí y 3 allí no es "13" para nadie hasta que el
// recolector (Prometheus, Grafana Agent, lo que sea) agrega los scrapes. Está
// escrito en el `# HELP` de cada métrica a propósito: quien construya una
// alerta creyendo que el número es global, la construirá mal en las dos
// direcciones. Es el mismo razonamiento que la §7 de 0002_comunidad.sql da para
// el rate limit en memoria.
//
// ⚠️ CARDINALIDAD. Una etiqueta con `userId` o `postId` son 100 000 series por
// métrica y la app que observa se muere por culpa de la observabilidad. Se
// etiqueta por RUTA NORMALIZADA, método y clase de estado, nunca por
// identificador — y aun así hay una guarda dura de MAX_SERIES: si alguien
// consigue inventar rutas, se deja de crear series y se cuenta el desbordamiento
// en `darma_series_desbordadas_total`. Un fallo de observabilidad no puede
// tumbar la aplicación observada.
// ============================================================================

/**
 * Cubos del histograma de latencia, en milisegundos. Acotados y fijos.
 *
 * Están elegidos alrededor de los presupuestos reales de Darma
 * (`presupuestos.ts`): 50 ms es el objetivo de la consulta del feed, 300 ms el
 * de la ruta completa, 800 ms el del composer. Un cubo justo en el umbral es lo
 * que permite leer "¿cuántas peticiones incumplen el SLO?" directamente del
 * contador acumulado, sin interpolar.
 */
export const CUBOS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 200, 300, 400, 500, 800, 1200, 2000, 5000,
] as const

/** Techo de series por métrica. Ver "CARDINALIDAD" en la cabecera. */
const MAX_SERIES = 200

interface Histograma {
  /** Cuenta por cubo, alineada con CUBOS_MS. El +Inf se deriva de `total`. */
  cubos: number[]
  suma: number
  total: number
}

const histogramas = new Map<string, Histograma>()
/** clave = `${ruta}|${clase}` (clase = '2xx', '4xx', '5xx'…). */
const peticiones = new Map<string, number>()
/** clave = código de error del contrato (`reciprocity_required`, `internal`…). */
const errores = new Map<string, number>()
/** Medidores instantáneos: conexiones, colas, gasto de IA. */
const saturacion = new Map<string, number>()

let seriesDesbordadas = 0

/**
 * Normaliza una ruta para usarla como etiqueta.
 *
 * Sustituye uuids y números por `:id`. Sin esto, `/api/posts/<uuid>` crearía una
 * serie por post y la memoria del proceso crecería con el tráfico — el fallo de
 * observabilidad más común y más caro.
 */
export function normalizarRuta(ruta: string): string {
  return ruta
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .slice(0, 120)
}

/** Clase de estado. Agrupar en 3 series en vez de una por código. */
export function claseEstado(estado: number): string {
  if (estado >= 500) return '5xx'
  if (estado >= 400) return '4xx'
  if (estado >= 300) return '3xx'
  return '2xx'
}

/**
 * ¿Puedo crear una serie nueva en este mapa? Si no, lo cuento y sigo.
 * Devolver `false` NUNCA lanza: la observabilidad se degrada, la app no.
 */
function admiteSerie(mapa: Map<string, unknown>, clave: string): boolean {
  if (mapa.has(clave)) return true
  if (mapa.size >= MAX_SERIES) {
    seriesDesbordadas += 1
    return false
  }
  return true
}

/** Registra la duración de una operación. `ruta` puede ser una ruta o el nombre
 *  de una traza (`conTraza`): en ambos casos es baja cardinalidad. */
export function observarLatencia(ruta: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return
  const clave = normalizarRuta(ruta)
  if (!admiteSerie(histogramas, clave)) return

  let h = histogramas.get(clave)
  if (!h) {
    h = { cubos: new Array<number>(CUBOS_MS.length).fill(0), suma: 0, total: 0 }
    histogramas.set(clave, h)
  }

  h.total += 1
  h.suma += ms
  // Histograma ACUMULATIVO al exportar; aquí se cuenta solo el cubo propio y la
  // acumulación se hace en la serialización. Así `observarLatencia` es O(log n)
  // conceptual y no O(cubos) en el camino caliente.
  for (let i = 0; i < CUBOS_MS.length; i += 1) {
    if (ms <= CUBOS_MS[i]) {
      h.cubos[i] += 1
      return
    }
  }
  // Por encima del último cubo: solo cuenta en +Inf, que sale de `total`.
}

/** Tráfico: una petición servida, por ruta y clase de estado. */
export function contarPeticion(ruta: string, estado: number): void {
  const clave = `${normalizarRuta(ruta)}|${claseEstado(estado)}`
  if (!admiteSerie(peticiones, clave)) return
  peticiones.set(clave, (peticiones.get(clave) ?? 0) + 1)
}

/**
 * Errores por CÓDIGO del contrato, no por mensaje.
 *
 * La distinción importa operativamente: un pico de `reciprocity_required` es
 * una señal de PRODUCTO (la gente intenta publicar sin haber escuchado) y un
 * pico de `internal` es un INCIDENTE. Mezclarlos en un único "ratio de errores"
 * hace que la única alerta que existe suene por la razón equivocada.
 */
export function observarError(codigo: string): void {
  const clave = codigo.replace(/[^a-z0-9_]/gi, '_').slice(0, 60)
  if (!admiteSerie(errores, clave)) return
  errores.set(clave, (errores.get(clave) ?? 0) + 1)
}

/** Saturación: valor instantáneo (conexiones, profundidad de cola, gasto). */
export function ponerSaturacion(nombre: string, valor: number): void {
  if (!Number.isFinite(valor)) return
  const clave = nombre.replace(/[^a-z0-9_]/gi, '_').slice(0, 60)
  if (!admiteSerie(saturacion, clave)) return
  saturacion.set(clave, valor)
}

/**
 * Percentil aproximado por interpolación lineal dentro del cubo.
 *
 * Se usa para evaluar presupuestos desde `/api/health/deep` sin depender de que
 * haya un Prometheus delante. Devuelve `null` si no hay muestras: un percentil
 * inventado sobre cero muestras es peor que la ausencia del dato, porque una
 * alerta lo leería como "todo bien".
 */
export function percentil(ruta: string, q: number): number | null {
  const h = histogramas.get(normalizarRuta(ruta))
  if (!h || h.total === 0) return null

  const objetivo = q * h.total
  let acumulado = 0
  let inferior = 0

  for (let i = 0; i < CUBOS_MS.length; i += 1) {
    const previo = acumulado
    acumulado += h.cubos[i]
    if (acumulado >= objetivo) {
      const enCubo = h.cubos[i]
      if (enCubo === 0) return CUBOS_MS[i]
      const fraccion = (objetivo - previo) / enCubo
      return inferior + (CUBOS_MS[i] - inferior) * fraccion
    }
    inferior = CUBOS_MS[i]
  }
  // Cae en el cubo +Inf: no hay techo conocido, se devuelve el último borde
  // como cota INFERIOR honesta (y el `_sum` del export permite verlo mejor).
  return CUBOS_MS[CUBOS_MS.length - 1]
}

/** Instantánea numérica para `evaluarPresupuestos`. Sin efectos secundarios. */
export function instantanea(): Record<string, number> {
  const s: Record<string, number> = {}

  for (const [nombre, valor] of saturacion) s[nombre] = valor

  const p95Feed = percentil('/api/feed', 0.95)
  if (p95Feed != null) s.feed_p95_ms = p95Feed

  const p95Sql = percentil('sql:feed', 0.95)
  if (p95Sql != null) s.feed_sql_p95_ms = p95Sql

  const p95Composer = percentil('/api/posts', 0.95)
  if (p95Composer != null) s.composer_p95_ms = p95Composer

  const p95Hilo = percentil('/api/comments', 0.95)
  if (p95Hilo != null) s.hilo_p95_ms = p95Hilo

  let total = 0
  let cinco = 0
  for (const [clave, n] of peticiones) {
    total += n
    if (clave.endsWith('|5xx')) cinco += n
  }
  // Sin tráfico no hay ratio. Emitir 0 haría que una instancia recién arrancada
  // "demostrara" que no hay errores.
  if (total > 0) s.ratio_5xx = cinco / total

  return s
}

// ── Serialización Prometheus ────────────────────────────────────────────────

/** Escapa un valor de etiqueta según el formato de exposición. */
function etiqueta(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

const NOTA_INSTANCIA =
  'OJO: contador POR INSTANCIA serverless, no global. El agregado lo hace el recolector.'

/**
 * Formato de exposición de Prometheus (texto plano, version=0.0.4).
 *
 * Se sirve ENTERO desde memoria del proceso: cero consultas a Postgres. Un
 * scrape cada 15 s que golpease la base sería una carga sostenida introducida
 * por el propio sistema de medida.
 */
export function exportarPrometheus(): string {
  const l: string[] = []

  l.push(`# HELP darma_latencia_ms Latencia por ruta en milisegundos. ${NOTA_INSTANCIA}`)
  l.push('# TYPE darma_latencia_ms histogram')
  for (const [ruta, h] of histogramas) {
    let acumulado = 0
    for (let i = 0; i < CUBOS_MS.length; i += 1) {
      acumulado += h.cubos[i]
      l.push(`darma_latencia_ms_bucket{ruta="${etiqueta(ruta)}",le="${CUBOS_MS[i]}"} ${acumulado}`)
    }
    l.push(`darma_latencia_ms_bucket{ruta="${etiqueta(ruta)}",le="+Inf"} ${h.total}`)
    l.push(`darma_latencia_ms_sum{ruta="${etiqueta(ruta)}"} ${h.suma}`)
    l.push(`darma_latencia_ms_count{ruta="${etiqueta(ruta)}"} ${h.total}`)
  }

  l.push(`# HELP darma_peticiones_total Peticiones servidas por ruta y clase de estado. ${NOTA_INSTANCIA}`)
  l.push('# TYPE darma_peticiones_total counter')
  for (const [clave, n] of peticiones) {
    const [ruta, clase] = clave.split('|')
    l.push(`darma_peticiones_total{ruta="${etiqueta(ruta)}",clase="${etiqueta(clase)}"} ${n}`)
  }

  l.push(`# HELP darma_errores_total Errores por código estable del contrato. ${NOTA_INSTANCIA}`)
  l.push('# TYPE darma_errores_total counter')
  for (const [codigo, n] of errores) {
    l.push(`darma_errores_total{codigo="${etiqueta(codigo)}"} ${n}`)
  }

  l.push('# HELP darma_saturacion Medidor instantáneo de saturación (colas, conexiones, gasto de IA).')
  l.push('# TYPE darma_saturacion gauge')
  for (const [nombre, valor] of saturacion) {
    l.push(`darma_saturacion{recurso="${etiqueta(nombre)}"} ${valor}`)
  }

  l.push('# HELP darma_series_desbordadas_total Series descartadas por superar el techo de cardinalidad.')
  l.push('# TYPE darma_series_desbordadas_total counter')
  l.push(`darma_series_desbordadas_total ${seriesDesbordadas}`)

  // El formato exige salto de línea final; sin él, algunos scrapers descartan
  // la última muestra en silencio.
  return `${l.join('\n')}\n`
}

/** Solo para tests: deja el módulo como recién cargado. */
export function __reiniciarMetricas(): void {
  histogramas.clear()
  peticiones.clear()
  errores.clear()
  saturacion.clear()
  seriesDesbordadas = 0
}
