// ============================================================================
// B08 · El filtro que justifica todo el bloque.
//
// ── LA REGLA DE PRODUCTO, ANTES QUE EL CÓDIGO ───────────────────────────────
// Un vídeo puede HABLAR de la autolesión y del suicidio sin romantizarlos:
// testimonios de recuperación, psicoeducación, entrevistas con clínicos, «así
// pedí ayuda». Ese es EXACTAMENTE el contenido que Darma quiere en su feed. La
// línea no es «menciona»: es «la presenta como deseable, la instruye o la
// estetiza». Filtrar por la palabra «suicidio» borraría justo el material que
// salva, y dejaría el feed lleno de vídeos de respiración que no le hablan a
// quien está peor.
//
// ── TRES SALIDAS, NUNCA DOS ─────────────────────────────────────────────────
//   'seguro'    → state = 'approved'.
//   'peligroso' → state = 'rejected' + ingest_log 'rejected_safety'. No se
//                 vuelve a mirar (uq_ingest_log_seen).
//   'incierto'  → se queda en 'pending': la cola de curación humana de
//                 idx_content_pending.
//
// Con dos salidas todo lo dudoso acaba en una de ellas. Y como «rechazar todo
// lo dudoso» vacía el feed, alguien acaba aflojando el umbral hasta que se
// publica lo que no debía. Con tres, lo dudoso va a una cola que es pequeña por
// diseño y que nadie tiene incentivo en vaciar aflojando nada.
//
// ── DOS CAPAS, EN ESTE ORDEN ────────────────────────────────────────────────
//   1. Determinista y barata (`cribarLexico`): romantización, método,
//      instrucción, retos, pro-ana/pro-mia y promesas terapéuticas, en es y en.
//      Un acierto aquí es 'peligroso' directo, sin gastar en el modelo.
//   2. Modelo, solo para lo que pasó la capa 1, con tope por ejecución y por día.
//
// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
// Sin MODERATION_API_KEY, sin cupo, con error de red o con baja confianza del
// modelo → 'incierto'. JAMÁS 'seguro'. Y esta función NUNCA lanza: una
// excepción aquí, propagada al orquestador, abortaría la ejecución entera y
// dejaría la fuente a medias.
// ============================================================================

import type { CandidatoContenido, VeredictoSeguridad } from './tipos.ts'

/** Tope de llamadas al modelo por EJECUCIÓN. El tope por día vive en Postgres. */
export const MAX_LLAMADAS_MODELO = 20

/** Tope de llamadas al modelo por DÍA (lo hace cumplir ingest_consume_model_budget). */
export const MAX_LLAMADAS_MODELO_DIA = 500

/** Confianza mínima para que un «es seguro» del modelo cuente como 'seguro'. */
export const CONFIANZA_MINIMA = 0.75

// ── Normalización ───────────────────────────────────────────────────────────
// Sin tildes, sin mayúsculas, sin puntuación: «Cúrate» y «curate» son el mismo
// intento, y un léxico que no lo contemple se esquiva escribiendo con acentos.
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    // \p{M} = marcas combinantes. Se usa la propiedad Unicode y no un rango
    // literal `[̀-ͯ]` porque el rango literal son caracteres
    // invisibles en el archivo, y un editor o un merge se los come sin avisar:
    // el filtro dejaría de quitar tildes y «cúrate» pasaría por donde «curate»
    // no pasa.
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Patron {
  /** Identificador estable del motivo. Es lo que se guarda en ingest_log.reason. */
  id: string
  re: RegExp
}

/**
 * ROMANTIZACIÓN, MÉTODO E INSTRUCCIÓN.
 *
 * Fíjate en lo que NO está: «suicidio», «autolesión», «depresión» sueltas. Lo
 * que se busca es la estetización («descanso definitivo», «por fin en paz»), la
 * instrucción («cómo quitarse la vida», «método indoloro») y el reto viral.
 */
const PATRONES_ROMANTIZACION: readonly Patron[] = [
  // — Estetización del final —
  { id: 'romantizacion_descanso', re: /\bdescanso (eterno|definitivo|final)\b/ },
  { id: 'romantizacion_descanso', re: /\beternal (rest|sleep|peace)\b/ },
  { id: 'romantizacion_porfin', re: /\bpor fin (en paz|libre|libres|descanso|tranquil\w*)\b/ },
  { id: 'romantizacion_porfin', re: /\bfinally (free|at peace|at rest)\b/ },
  { id: 'romantizacion_mundo_mejor', re: /\bel mundo estaria mejor sin mi\b/ },
  { id: 'romantizacion_mundo_mejor', re: /\bthe world would be better without me\b/ },
  { id: 'romantizacion_no_nacer', re: /\bmejor no haber nacido\b/ },

  // — Método e instrucción —
  {
    id: 'metodo_instruccion',
    re: /\b(como|metodo|metodos|forma|formas|manera|maneras|guia|tutorial|pasos?|paso a paso)\b[^.]{0,30}\b(suicidarse|quitarse la vida|quitarte la vida|matarse|acabar con todo|acabar con mi vida|cortarse|autolesionarse|hacerse dano)\b/,
  },
  {
    id: 'metodo_instruccion',
    re: /\bhow to\b[^.]{0,30}\b(kill yourself|end (it all|your life)|self harm|hurt yourself|hang yourself)\b/,
  },
  { id: 'metodo_indoloro', re: /\bmetodos? (indoloros?|infalibles?|rapidos? y seguros?)\b/ },
  { id: 'metodo_indoloro', re: /\bpainless (way|ways|method|methods)\b/ },
  { id: 'metodo_dosis', re: /\b(dosis|pastillas|mezcla)\b[^.]{0,20}\b(letal|letales|mortal|mortales)\b/ },
  { id: 'metodo_dosis', re: /\blethal (dose|doses)\b/ },

  // — Retos, desafíos y cuentas atrás —
  { id: 'reto_viral', re: /\b(reto|desafio|challenge|juego)\b[^.]{0,25}\b(suicid\w*|autolesion\w*|ballena azul|blue whale|momo)\b/ },
  { id: 'reto_viral', re: /\b(ballena azul|blue whale|momo) (challenge|reto|juego)\b/ },
  { id: 'cuenta_atras', re: /\bcuenta atras\b[^.]{0,25}\b(final|adios|despedida|muerte|el dia)\b/ },
  { id: 'cuenta_atras', re: /\bcountdown to\b[^.]{0,20}\b(the end|goodbye|my death)\b/ },

  // — Pro-ana / pro-mia —
  { id: 'pro_ana_mia', re: /\bpro ?(ana|mia)\b/ },
  { id: 'pro_ana_mia', re: /\bthinspo\w*\b/ },
  { id: 'pro_ana_mia', re: /\b(trucos|tips)\b[^.]{0,20}\b(no comer|dejar de comer|no tener hambre|ayunar)\b/ },
  { id: 'pro_ana_mia', re: /\b(ayuno|ayunos) (extremo|extremos|de \d+ dias)\b/ },
  { id: 'pro_ana_mia', re: /\b(how to )?(stop eating|starve yourself)\b/ },
] as const

/**
 * PROMESAS TERAPÉUTICAS.
 *
 * Es la categoría que más contenido bienintencionado atrapa, y por eso está: un
 * vídeo que dice «deja los antidepresivos» le habla a alguien que puede dejarlos
 * de golpe esta misma noche. El daño no depende de la intención de quien lo
 * grabó.
 */
const PATRONES_PROMESA_TERAPEUTICA: readonly Patron[] = [
  { id: 'promesa_terapeutica', re: /\bcura\b[^.]{0,15}\b(depresion|ansiedad|bipolaridad|tdah|toc|trastorno\w*|trauma)\b/ },
  { id: 'promesa_terapeutica', re: /\bcurar\b[^.]{0,15}\b(depresion|ansiedad|bipolaridad|tdah|toc|trastorno\w*)\b/ },
  { id: 'promesa_terapeutica', re: /\bcure (your |the )?(depression|anxiety|bipolar|adhd|ocd|trauma)\b/ },
  { id: 'promesa_terapeutica', re: /\b(elimina|adios a|olvidate de)\b[^.]{0,20}\b(ansiedad|depresion|panico)\b[^.]{0,20}\b(para siempre|definitivamente|en \d+)\b/ },
  // «sin medicación» SOLO cuando acompaña a una promesa de cura. Suelto atraparía
  // psicoeducación legítima («qué puedes hacer hoy, sin medicación, mientras
  // esperas cita»), y un falso positivo aquí no es un aviso: es un rechazo
  // definitivo, porque uq_ingest_log_seen impide volver a mirarlo.
  { id: 'promesa_sin_medicacion', re: /\b(cura\w*|sana\w*|supera\w*|elimina\w*|adios a|olvidate de)\b[^.]{0,30}\bsin (medicacion|farmacos|pastillas|antidepresivos)\b/ },
  { id: 'promesa_sin_medicacion', re: /\b(cure|heal|beat|fix)\b[^.]{0,30}\bwithout (medication|meds|drugs)\b/ },
  { id: 'promesa_dejar_medicacion', re: /\b(deja|dejar|dejate|abandona|abandonar|tira|tirar)\b[^.]{0,20}\b(los )?(antidepresivos|ansioliticos|medicacion|pastillas|farmacos|psicofarmacos)\b/ },
  { id: 'promesa_dejar_medicacion', re: /\b(quit|stop|ditch|throw away)\b[^.]{0,20}\b(your )?(antidepressants|meds|medication|pills)\b/ },
  { id: 'promesa_sustituye_medicacion', re: /\b(sustituye|reemplaza|remplaza)\b[^.]{0,15}\b(a )?(la )?(medicacion|terapia|antidepresivos)\b/ },
  { id: 'promesa_sustituye_medicacion', re: /\breplaces? (your )?(medication|therapy|antidepressants)\b/ },
  { id: 'promesa_no_necesitas', re: /\bno necesitas\b[^.]{0,15}\b(terapia|medicacion|psicologo|psiquiatra|ayuda profesional)\b/ },
  { id: 'promesa_no_necesitas', re: /\byou don t need (therapy|medication|a therapist)\b/ },
  { id: 'promesa_diagnostico', re: /\bdiagnostico\b[^.]{0,15}\b(gratis|gratuito|en \d+|instantaneo|online sin)\b/ },
  { id: 'promesa_diagnostico', re: /\bfree (mental health )?diagnosis\b/ },
  { id: 'promesa_milagro', re: /\b(metodo|tecnica|remedio|truco) (milagroso|infalible|definitivo|garantizado)\b/ },
  { id: 'promesa_milagro', re: /\b(miracle|guaranteed) (cure|method|fix)\b/ },
  { id: 'promesa_plazo', re: /\b(cura\w*|sana\w*|supera\w*|elimina\w*|heal|beat)\b[^.]{0,25}\ben (solo )?\d+ (dias|semanas|minutos|horas|days|weeks|minutes)\b/ },
] as const

const TODOS_LOS_PATRONES: readonly Patron[] = [...PATRONES_ROMANTIZACION, ...PATRONES_PROMESA_TERAPEUTICA]

/**
 * CAPA 1 — determinista, barata y PURA. Sobre título + resumen + tags.
 *
 * Solo puede decir «esto es peligroso» o «no lo sé». NUNCA puede aprobar: un
 * léxico que no encuentra nada no ha demostrado que el contenido sea bueno,
 * solo que no dijo ninguna de las cosas que sabemos reconocer.
 */
export function cribarLexico(c: Pick<CandidatoContenido, 'title' | 'summary' | 'tags'>): {
  peligroso: boolean
  motivo: string | null
} {
  const texto = normalizarTexto([c.title, c.summary ?? '', ...(c.tags ?? [])].join(' . '))

  for (const patron of TODOS_LOS_PATRONES) {
    if (patron.re.test(texto)) return { peligroso: true, motivo: patron.id }
  }
  return { peligroso: false, motivo: null }
}

// ── Capa 2 · el modelo ──────────────────────────────────────────────────────

/** Lo que el proveedor de moderación contesta. `null` = no contestó. */
export interface VeredictoModelo {
  seguro: boolean
  /** 0..1. Por debajo de CONFIANZA_MINIMA, un «seguro» no basta. */
  confianza: number
  motivo?: string | null
}

/** Firma del proveedor. Inyectable: los tests NO hacen red. */
export type ProveedorModeracion = (entrada: {
  title: string
  summary: string | null
  tags: string[]
  language: string
}) => Promise<VeredictoModelo | null>

export interface OpcionesCribado {
  proveedor?: ProveedorModeracion
  /** Por defecto, `process.env.MODERATION_API_KEY`. Ausente ⇒ 'incierto'. */
  apiKey?: string | null
  /**
   * Consume una unidad del tope de llamadas. Devuelve false si no queda cupo
   * (por ejecución o por día) ⇒ 'incierto'. Sin él, no hay tope.
   */
  consumirCupo?: () => Promise<boolean>
}

/**
 * Proveedor por defecto: POST JSON a `MODERATION_API_URL` con
 * `Authorization: Bearer <MODERATION_API_KEY>`.
 *
 * Devuelve `null` ante CUALQUIER problema (sin URL, error de red, HTTP no-2xx,
 * JSON inesperado) y no registra el error: el mensaje de un fallo HTTP puede
 * arrastrar la URL con la clave en la query. Quien llama traduce `null` a
 * 'incierto'.
 */
export const proveedorHttp: ProveedorModeracion = async (entrada) => {
  const url = process.env.MODERATION_API_URL
  const apiKey = process.env.MODERATION_API_KEY
  if (!url || !apiKey) return null

  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), 8_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: control.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        proposito: 'curacion_contenido_bienestar',
        idioma: entrada.language,
        titulo: entrada.title,
        resumen: entrada.summary,
        etiquetas: entrada.tags,
      }),
    })
    if (!res.ok) return null

    const cuerpo: unknown = await res.json()
    return interpretarRespuestaModelo(cuerpo)
  } catch {
    return null
  } finally {
    clearTimeout(alarma)
  }
}

/**
 * Traduce el cuerpo del proveedor a un veredicto. PURA y exportada para poder
 * probar que una respuesta rara NO se lee como «seguro».
 */
export function interpretarRespuestaModelo(cuerpo: unknown): VeredictoModelo | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const obj = cuerpo as Record<string, unknown>

  const seguro = obj.seguro ?? obj.safe
  const confianza = obj.confianza ?? obj.confidence
  // Un booleano ausente o de otro tipo no se coacciona: `Boolean(undefined)` es
  // false y parecería inofensivo, pero `Boolean('no')` es true — y eso sí
  // aprobaría un contenido que el proveedor estaba rechazando.
  if (typeof seguro !== 'boolean') return null
  if (typeof confianza !== 'number' || !Number.isFinite(confianza)) return null

  const motivo = typeof obj.motivo === 'string' ? obj.motivo : typeof obj.reason === 'string' ? obj.reason : null
  return { seguro, confianza: Math.max(0, Math.min(1, confianza)), motivo }
}

/**
 * EL FILTRO COMPLETO: capa 1 y, si sobrevive, capa 2.
 *
 * Es `async` porque la capa 2 llama a un proveedor externo. La parte pura y
 * síncrona es `cribarLexico`, que es la que se prueba caso a caso.
 *
 * NUNCA LANZA: cualquier excepción del proveedor se traduce a 'incierto'. Si
 * esta función lanzara, el orquestador abortaría la fuente a medias y el
 * contenido dudoso podría acabar en un camino no previsto.
 */
export async function cribarSeguridad(
  c: CandidatoContenido,
  opciones: OpcionesCribado = {},
): Promise<VeredictoSeguridad> {
  // ── Capa 1 ──
  const lexico = cribarLexico(c)
  if (lexico.peligroso) return { decision: 'peligroso', motivo: lexico.motivo }

  // ── Capa 2 ──
  const apiKey = opciones.apiKey === undefined ? (process.env.MODERATION_API_KEY ?? null) : opciones.apiKey
  if (!apiKey) {
    // Fail-closed. Sin clave no se aprueba nada: el catálogo se queda en la cola
    // humana, que es incómodo pero reversible. Aprobar a ciegas no lo es.
    return { decision: 'incierto', motivo: 'sin_clave_moderacion' }
  }

  if (opciones.consumirCupo) {
    let hayCupo = false
    try {
      hayCupo = await opciones.consumirCupo()
    } catch {
      hayCupo = false
    }
    if (!hayCupo) return { decision: 'incierto', motivo: 'sin_cupo_modelo' }
  }

  const proveedor = opciones.proveedor ?? proveedorHttp
  let veredicto: VeredictoModelo | null = null
  try {
    veredicto = await proveedor({
      title: c.title,
      summary: c.summary,
      tags: c.tags,
      language: c.language,
    })
  } catch {
    veredicto = null
  }

  if (!veredicto) return { decision: 'incierto', motivo: 'modelo_sin_respuesta' }

  if (!veredicto.seguro) {
    // Un «no es seguro» con poca confianza tampoco se convierte en rechazo
    // definitivo: rechazar cierra la puerta para siempre (uq_ingest_log_seen),
    // así que solo se cierra cuando el modelo está convencido. Lo demás, a la
    // cola humana.
    return veredicto.confianza >= CONFIANZA_MINIMA
      ? { decision: 'peligroso', motivo: veredicto.motivo ?? 'modelo_inseguro' }
      : { decision: 'incierto', motivo: 'modelo_inseguro_baja_confianza' }
  }

  if (veredicto.confianza < CONFIANZA_MINIMA) {
    return { decision: 'incierto', motivo: 'modelo_baja_confianza' }
  }

  return { decision: 'seguro', motivo: null }
}
