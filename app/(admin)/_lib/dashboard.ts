// ============================================================================
// B19 · TODAS las consultas de métricas del centro de mando
//
// ── LA REGLA QUE GOBIERNA ESTE ARCHIVO: CERO AGREGACIÓN EN VIVO ────────────
// Ni un `count(*)`, ni un `sum()`, ni un `group by` sobre `posts`, `comments`,
// `karma_events` o `crystal_ledger`. Todo sale de `admin_metrics_daily`, que
// es UNA FILA POR DÍA. Con cientos de miles de usuarios, un panel que agregue
// en vivo sobre `comments` es un Seq Scan de decenas de millones de filas cada
// vez que alguien abre una pestaña — y lo tumba para todo el mundo, no solo
// para quien mira el panel. El día que eso pase, el panel será la causa del
// incidente que el panel debía detectar.
//
// Las ÚNICAS dos consultas en vivo permitidas son las que se apoyan en un
// índice parcial minúsculo y por tanto no crecen con el histórico:
//   · `idx_crisis_pending`   → where attended_at is null and risk in ('high','critical')
//   · `idx_moderation_queue` → where state = 'pending'
// Su `WHERE` se replica LITERALMENTE aquí; si se cambia una coma, Postgres deja
// de usar el índice y la consulta pasa a escanear la tabla entera.
//
// ── SOBRE LOS PERCENTILES DE UNA VENTANA ───────────────────────────────────
// La media de los p90 diarios NO es el p90 de la semana. Por eso el rollup
// guarda, además del p50/p90 exacto del día (para la serie), un HISTOGRAMA de
// cubos fijos. Los histogramas sí se suman, y el percentil de la ventana se
// calcula sobre la suma. El valor se redondea al borde superior del cubo:
// conservador, que es la dirección correcta para un tiempo de respuesta.
//
// ── ANONIMATO (CONTRATOS §2) ───────────────────────────────────────────────
// Aquí no se lee ni una columna que identifique a nadie. Todo son agregados, y
// los agregados de PERSONAS pasan por `enmascarar()`: por debajo de 20, «<20».
// Un corte con n=1 no es una métrica, es un dato personal disfrazado de conteo.
//
// ── PATRÓN ─────────────────────────────────────────────────────────────────
// `getXxx(admin, ...)` que devuelve un objeto tipado por tarjeta, copiado en
// forma de `centroMandoDashboard.ts` del proyecto hermano. El cliente entra por
// parámetro y no se importa: así este módulo se prueba con `node --test` sin
// tocar la red ni leer una sola variable de entorno.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
// Ruta relativa y no el alias `@/` (CONTRATOS §1) por una razón concreta:
// `node --test --experimental-strip-types` no resuelve el alias, y la prueba
// nº 5 de la ficha exige poder importar este módulo sin arrancar Next. Mismo
// criterio que ya siguen las pruebas de B02 y B06 bajo `app/`.
import { LISTENS_PER_POST } from '../../../lib/reciprocity.ts'
import { estimarIngresoCentimos, PRECIOS_SON_ESTIMADOS } from './precios.ts'

// ── Contrato público ────────────────────────────────────────────────────────

export interface Ventana {
  /** ISO-8601. Inclusivo. */
  desde: string
  /** ISO-8601. Inclusivo. */
  hasta: string
}

export type Semaforo = 'verde' | 'ambar' | 'rojo'

export interface SaludReciprocidad {
  ratioReciprocidad: number
  escuchasValidadas: number
  postsPublicados: number
  /** 0..1 */
  tasaValidacion: number
  /** 0..1 */
  coberturaPosts24h: number
  semaforo: Semaforo
  serie: Array<{ dia: string; ratio: number }>
}

export interface TiempoPrimeraRespuesta {
  p50Segundos: number
  p90Segundos: number
  p50SegundosRiesgo: number
  postsSinRespuesta24h: number
  semaforo: Semaforo
  serie: Array<{ dia: string; p50: number; p90: number }>
}

export interface CoberturaCrisis {
  eventos: number
  revisados: number
  /** 0..1 — cualquier cosa distinta de 1 es un INCIDENTE, no una métrica. */
  cobertura: number
  pendientes: number
  masAntiguoPendienteSegundos: number | null
  p95AtencionSegundos: number | null
  semaforo: Semaforo
  serie: Array<{ dia: string; cobertura: number }>
}

export interface EmbudoActivacion {
  registrados: number
  onboardingCompleto: number
  primeraLectura: number
  primerComentarioValidado: number
  primeraPublicacion: number
  vueltaD7: number
}

export interface Economia {
  karmaEmitido: number
  karmaDrenado: number
  stockGastable: number
  /** 0..1 */
  pctUsuariosEnTope: number
  compradoresUnicos: number
  cristalesVendidos: number
  /** Céntimos enteros. Nunca coma flotante (CONTRATOS §1). */
  ingresoCentimos: number
  arppuCentimos: number
  /**
   * Desviación consciente del contrato de la ficha, anotada en PEDIDOS.md:
   * mientras `precios.ts` sea un stub, parte del ingreso está ESTIMADA y la UI
   * tiene que poder decirlo. Un ingreso que no distingue lo medido de lo
   * supuesto acaba en una previsión.
   */
  ingresoEstimado: boolean
}

export interface ResumenPanel {
  ventana: Ventana
  reciprocidad: SaludReciprocidad
  ttpr: TiempoPrimeraRespuesta
  crisis: CoberturaCrisis
  activacion: EmbudoActivacion
  economia: Economia
  calculadoEn: string
}

// ── Umbrales ────────────────────────────────────────────────────────────────

/**
 * El umbral del KPI que manda, IMPORTADO de `lib/reciprocity.ts`.
 *
 * No es un número de vanidad: cada publicación consume `LISTENS_PER_POST`
 * escuchas (`posts_consume_credit()` en 0001_core.sql). Si el ratio baja de ahí,
 * la comunidad solo publica gracias a las primeras publicaciones gratuitas de
 * los usuarios nuevos — y el día que la captación se enfríe, el feed se vacía
 * sin que nada más lo haya avisado.
 *
 * Escribir `3` a mano aquí sería duplicar la constante en un tercer sitio y
 * garantizar que un día digan cosas distintas.
 */
export const UMBRAL_RECIPROCIDAD = LISTENS_PER_POST

/** Margen sobre el umbral por debajo del cual la tarjeta ya avisa (ámbar). */
export const MARGEN_AMBAR_RECIPROCIDAD = 0.2

/** Objetivos de TTPR, en segundos. */
export const OBJETIVO_TTPR_P50 = 15 * 60
export const OBJETIVO_TTPR_P90 = 2 * 60 * 60

/** Un caso de crisis sin atender por encima de esto pone la tarjeta en rojo
 *  y la sube al primer lugar de la página. */
export const LIMITE_PENDIENTE_CRISIS_SEGUNDOS = 900

/** Por debajo de esta cifra, un agregado de PERSONAS se muestra como «<20». */
export const MINIMO_AGREGADO = 20

/** Bordes de los cubos del histograma, en segundos. Espejo EXACTO de
 *  `public.admin_cubos_ttpr()` en 0191_1_b19_admin.sql. */
export const CUBOS_SEGUNDOS: readonly number[] = [
  30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400,
] as const

// ── Helpers puros ───────────────────────────────────────────────────────────

/**
 * Semáforo del KPI. 🟢 ≥ umbral+0,2 · 🟡 [umbral, umbral+0,2) · 🔴 < umbral.
 *
 * El umbral entra por parámetro para que se pueda probar que la lógica
 * DEPENDE de `LISTENS_PER_POST` y no del literal 3.
 */
export function semaforoReciprocidad(
  ratio: number,
  umbral: number = UMBRAL_RECIPROCIDAD,
): Semaforo {
  if (!Number.isFinite(ratio) || ratio < umbral) return 'rojo'
  if (ratio < umbral + MARGEN_AMBAR_RECIPROCIDAD) return 'ambar'
  return 'verde'
}

export function semaforoTtpr(p50: number, p90: number): Semaforo {
  if (p50 > OBJETIVO_TTPR_P50 * 2 || p90 > OBJETIVO_TTPR_P90 * 2) return 'rojo'
  if (p50 > OBJETIVO_TTPR_P50 || p90 > OBJETIVO_TTPR_P90) return 'ambar'
  return 'verde'
}

/**
 * Semáforo de crisis. VERDE solo con cobertura exactamente 1 y sin nada
 * pendiente por encima del límite. No hay «casi»: la ficha lo dice y el
 * producto también — un falso negativo aquí es irreversible.
 */
export function semaforoCrisis(
  cobertura: number,
  masAntiguoPendienteSegundos: number | null,
): Semaforo {
  const viejo =
    masAntiguoPendienteSegundos !== null &&
    masAntiguoPendienteSegundos > LIMITE_PENDIENTE_CRISIS_SEGUNDOS
  if (cobertura < 1 || viejo) return 'rojo'
  return 'verde'
}

/**
 * Enmascara un conteo de PERSONAS.
 *
 * `0` se muestra tal cual: no hay nadie a quien reidentificar. De 1 a 19 se
 * muestra «<20», porque un agregado con n pequeño más un poco de contexto
 * externo señala a alguien concreto — y ese alguien escribió aquí sobre su
 * salud mental creyéndose anónimo.
 *
 * NO se aplica a conteos de EVENTOS (posts, comentarios, eventos de crisis):
 * ahí el número no acota un grupo de personas.
 */
export function enmascarar(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < MINIMO_AGREGADO) return `<${MINIMO_AGREGADO}`
  return String(Math.trunc(n))
}

/** División que nunca devuelve NaN ni Infinity. Un panel con «NaN» es un panel
 *  que nadie vuelve a abrir. */
export function ratio(numerador: number, denominador: number): number {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador <= 0) return 0
  return numerador / denominador
}

/**
 * Percentil sobre un histograma sumado.
 *
 * `hist` es `{ indiceDeCubo: cuentas }` tal como lo devuelve `width_bucket`:
 * el cubo 0 es `[0, 30)`, el 1 `[30, 60)` … y el último `[86400, ∞)`. Se
 * devuelve el BORDE SUPERIOR del cubo donde cae el cuantil, que sobreestima
 * ligeramente. Para un tiempo de respuesta, sobreestimar es la dirección
 * segura: hace que la alarma salte antes, no después.
 *
 * `null` cuando no hay ninguna muestra: no es lo mismo «nadie tardó nada» que
 * «no ha pasado nada todavía», y pintar 0 las confunde.
 */
export function percentilDeHistograma(
  hist: Readonly<Record<string, number>>,
  q: number,
): number | null {
  const cuentas: number[] = new Array(CUBOS_SEGUNDOS.length + 1).fill(0)
  let total = 0

  for (const [clave, valor] of Object.entries(hist)) {
    const i = Number(clave)
    const n = Number(valor)
    if (!Number.isInteger(i) || i < 0 || i >= cuentas.length) continue
    if (!Number.isFinite(n) || n <= 0) continue
    cuentas[i] += n
    total += n
  }

  if (total === 0) return null

  const objetivo = q * total
  let acumulado = 0
  for (let i = 0; i < cuentas.length; i += 1) {
    acumulado += cuentas[i]
    if (acumulado >= objetivo) {
      // El último cubo no tiene borde superior; se reporta su borde inferior,
      // que es la única cota honesta que tenemos.
      return CUBOS_SEGUNDOS[Math.min(i, CUBOS_SEGUNDOS.length - 1)]
    }
  }
  return CUBOS_SEGUNDOS[CUBOS_SEGUNDOS.length - 1]
}

// ── Lectura del rollup ──────────────────────────────────────────────────────

/**
 * Forma de `admin_metrics_daily.metricas`. Todas las claves son opcionales a
 * propósito: una fila escrita por una versión anterior del rollup no puede
 * hacer reventar el panel. `num()` rellena con 0.
 */
export interface MetricasDia {
  posts_publicados?: number
  comentarios_totales?: number
  escuchas_validadas?: number
  posts_con_escucha_24h?: number
  ttpr_p50_segundos?: number
  ttpr_p90_segundos?: number
  ttpr_p50_riesgo_segundos?: number
  posts_sin_respuesta_24h?: number
  ttpr_hist?: Record<string, number>
  crisis_eventos?: number
  crisis_revisados?: number
  crisis_sin_atender?: number
  crisis_hist?: Record<string, number>
  act_registrados?: number
  act_onboarding?: number
  act_primera_lectura?: number
  act_primer_comentario_validado?: number
  act_primera_publicacion?: number
  act_vuelta_d7?: number
  karma_emitido?: number
  karma_drenado?: number
  karma_stock_gastable?: number
  usuarios_activos?: number
  usuarios_en_tope?: number
  compradores_unicos?: number
  cristales_vendidos?: number
  ingreso_centimos_recibo?: number
  paquetes_sin_recibo?: Record<string, number>
}

export interface FilaRollup {
  dia: string
  metricas: MetricasDia
  calculadoEn: string
}

function num(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : 0
}

function hist(valor: unknown): Record<string, number> {
  if (typeof valor !== 'object' || valor === null) return {}
  return valor as Record<string, number>
}

function sumaHistogramas(filas: readonly FilaRollup[], campo: 'ttpr_hist' | 'crisis_hist'): Record<string, number> {
  const total: Record<string, number> = {}
  for (const fila of filas) {
    for (const [k, v] of Object.entries(hist(fila.metricas[campo]))) {
      total[k] = (total[k] ?? 0) + num(v)
    }
  }
  return total
}

/** `YYYY-MM-DD` en UTC. Nunca la fecha local: dos personas mirando el mismo
 *  panel desde husos distintos tienen que ver la misma ventana. */
export function aDiaUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error('fecha inválida')
  return d.toISOString().slice(0, 10)
}

// ── Las cinco tarjetas ──────────────────────────────────────────────────────

export function getSaludReciprocidad(filas: readonly FilaRollup[]): SaludReciprocidad {
  let escuchas = 0
  let posts = 0
  let comentarios = 0
  let cubiertos = 0
  const serie: Array<{ dia: string; ratio: number }> = []

  for (const fila of filas) {
    const m = fila.metricas
    const e = num(m.escuchas_validadas)
    const p = num(m.posts_publicados)
    escuchas += e
    posts += p
    comentarios += num(m.comentarios_totales)
    cubiertos += num(m.posts_con_escucha_24h)
    serie.push({ dia: fila.dia, ratio: Number(ratio(e, p).toFixed(3)) })
  }

  // ⚠️ El ratio NO se calcula con `profiles.listens_given`. Ese contador es
  // acumulado de por vida y nunca baja: dividirlo por publicaciones da un
  // número que solo sube y que parecería sano justo el mes en que la comunidad
  // se está muriendo. Se calcula POR VENTANA, sobre lo que pasó en ella.
  const ratioReciprocidad = ratio(escuchas, posts)

  return {
    ratioReciprocidad,
    escuchasValidadas: escuchas,
    postsPublicados: posts,
    tasaValidacion: ratio(escuchas, comentarios),
    coberturaPosts24h: ratio(cubiertos, posts),
    semaforo: semaforoReciprocidad(ratioReciprocidad),
    serie,
  }
}

export function getTiempoPrimeraRespuesta(filas: readonly FilaRollup[]): TiempoPrimeraRespuesta {
  const h = sumaHistogramas(filas, 'ttpr_hist')
  const p50 = percentilDeHistograma(h, 0.5) ?? 0
  const p90 = percentilDeHistograma(h, 0.9) ?? 0

  let sinRespuesta = 0
  let riesgoSuma = 0
  let riesgoDias = 0
  const serie: Array<{ dia: string; p50: number; p90: number }> = []

  for (const fila of filas) {
    const m = fila.metricas
    sinRespuesta += num(m.posts_sin_respuesta_24h)
    const r = num(m.ttpr_p50_riesgo_segundos)
    if (r > 0) {
      riesgoSuma += r
      riesgoDias += 1
    }
    serie.push({ dia: fila.dia, p50: num(m.ttpr_p50_segundos), p90: num(m.ttpr_p90_segundos) })
  }

  return {
    p50Segundos: p50,
    p90Segundos: p90,
    // No hay histograma separado para los posts de riesgo (son pocos y un
    // histograma más por día no compensa): se promedian los p50 diarios, que
    // para un puñado de casos al día es una aproximación honesta. El desglose
    // exacto vive en la página de detalle de crisis.
    p50SegundosRiesgo: riesgoDias > 0 ? Math.round(riesgoSuma / riesgoDias) : 0,
    postsSinRespuesta24h: sinRespuesta,
    semaforo: semaforoTtpr(p50, p90),
    serie,
  }
}

export interface ColaCrisisViva {
  pendientes: number
  masAntiguoPendienteSegundos: number | null
}

export function getCoberturaCrisis(
  filas: readonly FilaRollup[],
  cola: ColaCrisisViva,
): CoberturaCrisis {
  let eventos = 0
  let revisados = 0
  const serie: Array<{ dia: string; cobertura: number }> = []

  for (const fila of filas) {
    const e = num(fila.metricas.crisis_eventos)
    const r = num(fila.metricas.crisis_revisados)
    eventos += e
    revisados += r
    // Un día sin eventos de crisis es cobertura 1, no 0: no hay nada sin
    // revisar. Pintarlo como 0 llenaría la serie de rojos falsos y el rojo
    // dejaría de significar nada.
    serie.push({ dia: fila.dia, cobertura: e > 0 ? Number(ratio(r, e).toFixed(4)) : 1 })
  }

  const cobertura = eventos > 0 ? ratio(revisados, eventos) : 1
  const p95 = percentilDeHistograma(sumaHistogramas(filas, 'crisis_hist'), 0.95)

  return {
    eventos,
    revisados,
    cobertura,
    pendientes: cola.pendientes,
    masAntiguoPendienteSegundos: cola.masAntiguoPendienteSegundos,
    p95AtencionSegundos: p95,
    semaforo: semaforoCrisis(cobertura, cola.masAntiguoPendienteSegundos),
    serie,
  }
}

export function getEmbudoActivacion(filas: readonly FilaRollup[]): EmbudoActivacion {
  const embudo: EmbudoActivacion = {
    registrados: 0,
    onboardingCompleto: 0,
    primeraLectura: 0,
    primerComentarioValidado: 0,
    primeraPublicacion: 0,
    vueltaD7: 0,
  }
  for (const fila of filas) {
    const m = fila.metricas
    embudo.registrados += num(m.act_registrados)
    embudo.onboardingCompleto += num(m.act_onboarding)
    embudo.primeraLectura += num(m.act_primera_lectura)
    embudo.primerComentarioValidado += num(m.act_primer_comentario_validado)
    embudo.primeraPublicacion += num(m.act_primera_publicacion)
    embudo.vueltaD7 += num(m.act_vuelta_d7)
  }
  return embudo
}

export function getEconomia(filas: readonly FilaRollup[]): Economia {
  let emitido = 0
  let drenado = 0
  let stock = 0
  let activos = 0
  let enTope = 0
  let compradores = 0
  let cristales = 0
  let ingresoRecibo = 0
  const paquetes: Record<string, number> = {}

  for (const fila of filas) {
    const m = fila.metricas
    // ⚠️ Emisión y drenaje se agrupan por el SIGNO de los deltas, NO por
    // `kind`: `spend_karma()` de 0001 escribe los gastos con
    // `kind = 'comment_validated'`, así que agrupar por `kind` da emisión
    // inflada. El rollup ya lo hace bien; esto solo suma. Anotado en
    // PEDIDOS.md para F1/B12.
    emitido += num(m.karma_emitido)
    drenado += num(m.karma_drenado)
    // El stock es una FOTO, no un flujo: se queda el del último día de la
    // ventana. Sumarlo entre días contaría el mismo saldo N veces.
    stock = num(m.karma_stock_gastable)
    activos += num(m.usuarios_activos)
    enTope += num(m.usuarios_en_tope)
    // ⚠️ Sumar `compradores_unicos` entre días SOBRECUENTA a quien compró dos
    // días distintos. Es una cota superior consciente: el único cálculo exacto
    // exigiría un `count(distinct)` en vivo sobre `crystal_ledger`, que es
    // justamente lo que este archivo no puede hacer. Se documenta en la UI.
    compradores += num(m.compradores_unicos)
    cristales += num(m.cristales_vendidos)
    ingresoRecibo += num(m.ingreso_centimos_recibo)
    for (const [k, v] of Object.entries(hist(m.paquetes_sin_recibo))) {
      paquetes[k] = (paquetes[k] ?? 0) + num(v)
    }
  }

  const ingresoEstimadoCentimos = estimarIngresoCentimos(paquetes)
  const ingresoCentimos = Math.trunc(ingresoRecibo + ingresoEstimadoCentimos)

  return {
    karmaEmitido: emitido,
    karmaDrenado: drenado,
    stockGastable: stock,
    pctUsuariosEnTope: ratio(enTope, activos),
    compradoresUnicos: compradores,
    cristalesVendidos: cristales,
    ingresoCentimos,
    // Entero y 0 (nunca NaN) cuando no hay compradores.
    arppuCentimos: compradores > 0 ? Math.round(ingresoCentimos / compradores) : 0,
    ingresoEstimado: PRECIOS_SON_ESTIMADOS && ingresoEstimadoCentimos > 0,
  }
}

// ── Acceso a la base ────────────────────────────────────────────────────────

/**
 * Lee la ventana de `admin_metrics_daily`. UNA consulta.
 *
 * @param admin cliente `service_role`. Estas tablas tienen RLS activa y CERO
 *              políticas, así que ningún otro cliente las ve — ni con un
 *              `PATCH` a PostgREST usando la anon key.
 */
export async function leerRollup(
  admin: SupabaseClient,
  ventana: Ventana,
): Promise<FilaRollup[]> {
  const { data, error } = await admin.rpc('admin_metricas_ventana', {
    p_desde: aDiaUtc(ventana.desde),
    p_hasta: aDiaUtc(ventana.hasta),
  })

  if (error) throw new Error(`rollup: ${error.code ?? 'error'}`)
  if (!Array.isArray(data)) return []

  return data.map((fila) => {
    const f = fila as { dia: string; metricas: unknown; calculado_en: string }
    return {
      dia: String(f.dia),
      metricas: (typeof f.metricas === 'object' && f.metricas !== null
        ? f.metricas
        : {}) as MetricasDia,
      calculadoEn: String(f.calculado_en),
    }
  })
}

/**
 * Cola VIVA de crisis. La segunda —y última— consulta del panel.
 *
 * El `WHERE` replica LITERALMENTE el de `idx_crisis_pending`:
 *   `where attended_at is null and risk in ('high','critical')`
 * Cambiar una condición hace que Postgres deje de usar el índice parcial y
 * pase a escanear `crisis_events` entera.
 *
 * No se usa `count(*)`: se piden como mucho `TOPE_COLA + 1` marcas de tiempo
 * ordenadas por antigüedad. Con eso se sabe cuántas hay (o que hay «más de N»)
 * y cuál es la más vieja, que es lo único que decide el color de la tarjeta.
 */
export const TOPE_COLA_CRISIS = 500

export async function leerColaCrisisViva(
  admin: SupabaseClient,
  ahora: Date = new Date(),
): Promise<ColaCrisisViva> {
  const { data, error } = await admin
    .from('crisis_events')
    .select('created_at')
    .is('attended_at', null)
    .in('risk', ['high', 'critical'])
    .order('created_at', { ascending: true })
    .limit(TOPE_COLA_CRISIS + 1)

  if (error) throw new Error(`cola_crisis: ${error.code ?? 'error'}`)

  const filas = (data ?? []) as Array<{ created_at: string }>
  if (filas.length === 0) return { pendientes: 0, masAntiguoPendienteSegundos: null }

  const masAntiguo = new Date(filas[0].created_at).getTime()
  const segundos = Math.max(0, Math.round((ahora.getTime() - masAntiguo) / 1000))

  return { pendientes: filas.length, masAntiguoPendienteSegundos: segundos }
}

/**
 * El resumen entero. DOS consultas a la base, por debajo del presupuesto de 3
 * de CONTRATOS §11.
 *
 * Con la ventana vacía devuelve ceros, semáforos definidos y ningún `NaN`: un
 * panel que revienta el primer día, cuando todavía no hay datos, es un panel
 * que nadie vuelve a abrir.
 */
export async function getResumenPanel(
  admin: SupabaseClient,
  ventana: Ventana,
): Promise<ResumenPanel> {
  const [filas, cola] = await Promise.all([
    leerRollup(admin, ventana),
    leerColaCrisisViva(admin),
  ])

  const calculadoEn =
    filas.length > 0 ? filas[filas.length - 1].calculadoEn : new Date().toISOString()

  return {
    ventana,
    reciprocidad: getSaludReciprocidad(filas),
    ttpr: getTiempoPrimeraRespuesta(filas),
    crisis: getCoberturaCrisis(filas, cola),
    activacion: getEmbudoActivacion(filas),
    economia: getEconomia(filas),
    calculadoEn,
  }
}

// ── Recorte por rol ─────────────────────────────────────────────────────────

/**
 * Quita del resumen lo que un rol no puede ver.
 *
 * Se hace en el SERVIDOR, no ocultando una tarjeta en el cliente: una tarjeta
 * oculta con CSS sigue viajando en el HTML y en el JSON de la API, y ahí la
 * lee cualquiera con las devtools abiertas. Lo que un rol no puede ver, no se
 * serializa.
 */
export function recortarPorRol(
  resumen: ResumenPanel,
  rol: 'soporte' | 'moderador' | 'operaciones' | 'superadmin',
): Omit<ResumenPanel, 'crisis' | 'economia'> &
  Partial<Pick<ResumenPanel, 'crisis' | 'economia'>> {
  const base: Omit<ResumenPanel, 'crisis' | 'economia'> &
    Partial<Pick<ResumenPanel, 'crisis' | 'economia'>> = {
    ventana: resumen.ventana,
    reciprocidad: resumen.reciprocidad,
    ttpr: resumen.ttpr,
    activacion: resumen.activacion,
    calculadoEn: resumen.calculadoEn,
  }

  if (rol !== 'soporte') base.crisis = resumen.crisis
  if (rol === 'operaciones' || rol === 'superadmin') base.economia = resumen.economia

  return base
}

// ── Ventanas ────────────────────────────────────────────────────────────────

/** Ventana de N días que termina hoy (inclusive), en UTC. */
export function ventanaDias(dias: number, ahora: Date = new Date()): Ventana {
  const hasta = new Date(ahora.getTime())
  const desde = new Date(ahora.getTime() - (dias - 1) * 86400000)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

/** La ventana del KPI: 7 días, como manda la ficha. */
export const DIAS_VENTANA_KPI = 7
/** La de las páginas de detalle. */
export const DIAS_VENTANA_DETALLE = 90
