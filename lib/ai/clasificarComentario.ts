// ============================================================================
// B11 · Clasificador de calidad + riesgo — UNA sola llamada
//
// Calidad y riesgo se piden JUNTOS, en la misma petición y el mismo esquema.
// Dos llamadas duplicarían coste y latencia sin ganar nada: el modelo ya ha
// leído el texto, preguntarle dos veces por lo mismo es pagar dos veces.
//
// ── EL PATRÓN QUE NO SE NEGOCIA ────────────────────────────────────────────
// Dos funciones, no una:
//   · `interpretarVeredicto(bruto)` — PURA. Testeable sin red y sin clave. Es
//     donde vive todo el juicio, así que es donde viven todas las pruebas.
//   · `clasificar(texto, deps)` — hace la llamada y NUNCA LANZA. Cualquier
//     fallo —sin clave, timeout, JSON inválido, refusal, respuesta vacía,
//     429— devuelve un veredicto `indeterminado`. Jamás `valido`.
//
// La asimetría es el bloque entero: un `indeterminado` cuesta que alguien no
// cobre karma hasta que un humano lo repase. Un `valido` inventado por un
// error de red mete un comentario tóxico en el hilo de alguien que estaba mal.
// ============================================================================

import { escalate, type RiskLevel } from '../crisis.ts'
import {
  EsquemaVeredicto,
  FORMATO_SALIDA,
  indeterminado,
  type NivelRiesgo,
  type ResultadoClasificacion,
} from './esquemas.ts'
import {
  ESFUERZO,
  MAX_TOKENS,
  modeloActivo,
  USO_CERO,
  type UsoTokens,
} from './modelo.ts'
import { bloquesSystem, turnoUsuario } from './rubrica.ts'
import { obtenerCliente, type ClienteIA, type RespuestaIA } from './cliente.ts'

/** Causas de degradación. Alimentan el `signal` de `moderation_flags`. */
export type CausaDegradacion =
  | 'sin_clave'
  | 'sin_presupuesto'
  | 'rechazo_modelo'
  | 'respuesta_vacia'
  | 'respuesta_truncada'
  | 'json_invalido'
  | 'fuera_de_esquema'
  | 'error_proveedor'
  | null

export interface DepsClasificador {
  /** Cliente inyectado. Los tests SIEMPRE lo pasan; nadie toca la red. */
  cliente?: ClienteIA
  /** Suelo de riesgo que dieron las reglas. El resultado nunca baja de aquí. */
  riesgoSuelo?: NivelRiesgo
  /** Tipo de contenido, solo para el turno de usuario. */
  tipo?: string
  /** Reloj inyectable para medir latencia sin depender de `Date.now()`. */
  ahora?: () => number
}

export interface ClasificacionDetallada {
  resultado: ResultadoClasificacion
  uso: UsoTokens
  latenciaMs: number
  causa: CausaDegradacion
  /** true cuando la caché del prompt funcionó. Lo audita `pipeline.ts`. */
  cacheAcertada: boolean
}

// ── Interpretación (PURA) ───────────────────────────────────────────────────

/**
 * Convierte lo que sea que haya llegado en un veredicto.
 *
 * Acepta un objeto ya parseado o una cadena JSON (la API puede devolver el
 * objeto en `parsed_output` con `messages.parse()`, o el JSON como texto con
 * `create()`). Todo lo demás es `indeterminado`.
 *
 * NUNCA lanza. Ni con `null`, ni con `undefined`, ni con un enum inventado.
 */
export function interpretarVeredicto(
  bruto: unknown,
  riesgoSuelo: NivelRiesgo = 'none',
): ResultadoClasificacion {
  let candidato: unknown = bruto

  if (typeof candidato === 'string') {
    try {
      candidato = JSON.parse(candidato)
    } catch {
      return indeterminado('Respuesta del clasificador no interpretable.', riesgoSuelo)
    }
  }

  const analisis = EsquemaVeredicto.safeParse(candidato)
  if (!analisis.success) {
    // Un campo fuera del enum, una clave de más o una puntuación fuera de
    // rango significan que el proveedor cambió algo. Eso degrada; no se
    // "arregla" quedándose con los campos que sí venían bien.
    return indeterminado('Veredicto fuera del esquema esperado.', riesgoSuelo)
  }

  const v = analisis.data

  // ── LA ESCALADA ES UNIDIRECCIONAL ────────────────────────────────────────
  // El modelo puede SUBIR el riesgo por encima de las reglas, nunca bajarlo por
  // debajo. Si las reglas vieron 'high' y el modelo dice 'none', el resultado
  // es 'high'. Las reglas no tienen cuota, ni latencia, ni un mal día.
  const riesgo: NivelRiesgo = escalate(riesgoSuelo as RiskLevel, v.riesgo as RiskLevel)

  return {
    calidad: v.calidad,
    puntuacion: Math.round(v.puntuacion * 1000) / 1000,
    riesgo,
    motivo: v.motivo,
    degradado: false,
  }
}

/**
 * Riesgo cuando NO hay veredicto (degradación).
 *
 * No devuelve el suelo tal cual: lo sube. Un fallo del clasificador no es
 * información tranquilizadora, es ausencia de información — y en este bloque
 * la ausencia de información escala hacia arriba, nunca hacia abajo.
 *
 * · Si las reglas no vieron nada → 'low'. Basta para que se le enseñe un
 *   enlace de ayuda al pie; no bloquea nada ni mete a nadie en una cola.
 * · Si las reglas vieron ALGO → 'high'. Ese texto ya tenía señal y ahora
 *   además nos hemos quedado sin segunda opinión: lo mira un humano.
 */
export function escalarPorIncertidumbre(riesgoSuelo: NivelRiesgo): NivelRiesgo {
  if (riesgoSuelo === 'none') return 'low'
  return escalate(riesgoSuelo as RiskLevel, 'high') as NivelRiesgo
}

/** Extrae el JSON de una respuesta, sea de `parse()` o de `create()`. */
function extraerCarga(respuesta: RespuestaIA): unknown {
  if (respuesta.parsed_output !== undefined && respuesta.parsed_output !== null) {
    return respuesta.parsed_output
  }
  const bloques = respuesta.content ?? []
  for (const bloque of bloques) {
    if (bloque.parsed !== undefined && bloque.parsed !== null) return bloque.parsed
    if (bloque.type === 'text' && typeof bloque.text === 'string' && bloque.text.trim() !== '') {
      return bloque.text
    }
  }
  return undefined
}

function leerUso(respuesta: RespuestaIA): UsoTokens {
  const u = respuesta.usage ?? {}
  return {
    entrada: u.input_tokens ?? 0,
    salida: u.output_tokens ?? 0,
    cacheLectura: u.cache_read_input_tokens ?? 0,
    cacheEscritura: u.cache_creation_input_tokens ?? 0,
  }
}

/**
 * Clasifica el nombre del error del proveedor sin acoplarse a sus clases.
 *
 * Se mira `name` y `status` en vez de `instanceof Anthropic.RateLimitError`
 * porque el SDK no está instalado y porque un `instanceof` contra un módulo
 * cargado dinámicamente falla cuando hay dos copias del paquete en el árbol.
 */
function esRateLimit(causa: unknown): boolean {
  if (typeof causa !== 'object' || causa === null) return false
  const e = causa as { name?: unknown; status?: unknown }
  return e.name === 'RateLimitError' || e.status === 429
}

// ── Llamada (NUNCA lanza) ───────────────────────────────────────────────────

/**
 * Versión con detalle: uso de tokens, latencia y causa de la degradación.
 * La usa `pipeline.ts` para auditar y para elegir el `signal` del flag.
 */
export async function clasificarDetallado(
  texto: string,
  deps: DepsClasificador = {},
): Promise<ClasificacionDetallada> {
  const riesgoSuelo = deps.riesgoSuelo ?? 'none'
  const reloj = deps.ahora ?? Date.now
  const inicio = reloj()

  const degradar = (
    causa: CausaDegradacion,
    motivo: string,
    uso: UsoTokens = USO_CERO,
    cacheAcertada = false,
  ): ClasificacionDetallada => ({
    resultado: indeterminado(motivo, escalarPorIncertidumbre(riesgoSuelo)),
    uso,
    latenciaMs: Math.max(0, reloj() - inicio),
    causa,
    cacheAcertada,
  })

  const cliente = deps.cliente ?? (await obtenerCliente())
  if (!cliente) {
    // Estado NORMAL hoy: no hay MODERATION_API_KEY. No es un error, es el modo
    // degradado. El contenido se publicará igual; simplemente no se validará.
    return degradar('sin_clave', 'Clasificador no disponible; revisión pendiente.')
  }

  let respuesta: RespuestaIA
  try {
    respuesta = await cliente.messages.create({
      model: modeloActivo(),
      max_tokens: MAX_TOKENS,
      // NO se pasa `thinking`. En claude-opus-5 va activado por defecto y
      // desactivarlo introduce fugas de <thinking> y llamadas emitidas como
      // texto plano. El ahorro correcto es `effort`.
      output_config: { effort: ESFUERZO, format: FORMATO_SALIDA },
      system: bloquesSystem(),
      messages: [{ role: 'user', content: turnoUsuario(texto, deps.tipo ?? 'comment') }],
    })
  } catch (causa) {
    return degradar(
      'error_proveedor',
      esRateLimit(causa)
        ? 'Clasificador saturado; revisión pendiente.'
        : 'Clasificador inalcanzable; revisión pendiente.',
    )
  }

  const uso = leerUso(respuesta)
  const cacheAcertada = uso.cacheLectura > 0

  // ⚠️ ANTES de tocar `content`. Un refusal llega con HTTP 200 y content: [].
  if (respuesta.stop_reason === 'refusal') {
    return degradar('rechazo_modelo', 'El clasificador declinó evaluar el texto.', uso, cacheAcertada)
  }
  if (respuesta.stop_reason === 'max_tokens') {
    // Un JSON cortado a la mitad no es medio veredicto: no es ninguno.
    return degradar('respuesta_truncada', 'Veredicto incompleto; revisión pendiente.', uso, cacheAcertada)
  }

  const carga = extraerCarga(respuesta)
  if (carga === undefined) {
    return degradar('respuesta_vacia', 'El clasificador no devolvió veredicto.', uso, cacheAcertada)
  }

  const resultado = interpretarVeredicto(carga, riesgoSuelo)
  if (resultado.degradado) {
    return {
      resultado: { ...resultado, riesgo: escalarPorIncertidumbre(riesgoSuelo) },
      uso,
      latenciaMs: Math.max(0, reloj() - inicio),
      causa: typeof carga === 'string' ? 'json_invalido' : 'fuera_de_esquema',
      cacheAcertada,
    }
  }

  return {
    resultado,
    uso,
    latenciaMs: Math.max(0, reloj() - inicio),
    causa: null,
    cacheAcertada,
  }
}

/** Firma del contrato de la ficha. NUNCA lanza. */
export async function clasificar(
  texto: string,
  deps: DepsClasificador = {},
): Promise<ResultadoClasificacion> {
  const detalle = await clasificarDetallado(texto, deps)
  return detalle.resultado
}
