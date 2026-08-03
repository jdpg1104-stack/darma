// ============================================================================
// Logger de observabilidad · una línea JSON, con requestId, sin PII
//
// Este módulo NO sustituye a lib/logger.ts (dueño F3, logging de dominio). Es
// la pieza de observabilidad: correlaciona por `requestId` y por `ruta`, aplica
// muestreo y escribe en formato de una línea por evento.
//
// POR QUÉ EL requestId ES OBLIGATORIO EN LA FIRMA. `proxy.ts` ya genera y
// propaga `x-request-id` en cada petición. A decenas de peticiones por segundo,
// los logs de Vercel sin correlación no son "difíciles de leer": son inútiles,
// porque las líneas de tres peticiones distintas se intercalan y la historia de
// cada una es irreconstruible. Haciendo que `crearLogger` EXIJA el id, no hay
// forma cómoda de escribir una línea huérfana.
//
// LA REGLA QUE NO SE NEGOCIA: aquí no entra el cuerpo de un post ni de un
// comentario, ni el alias, ni el email, ni la IP. En una app donde la gente
// escribe lo que no le ha contado a nadie, un log despistado no es un problema
// de cumplimiento: es la filtración de una confesión. Se registra `postId` y
// `bodyLongitud`, que es lo que de verdad sirve para depurar.
//
// La redacción es en DOS capas y a propósito:
//   1. Por NOMBRE de clave (`body`, `alias`, `email`, `ip`…): el contenido no
//      siempre tiene forma reconocible — un desahogo no "parece" PII.
//   2. Por CONTENIDO (`redactPii` de lib/anonymity.ts): por si el valor viaja
//      dentro de una clave inocente (`mensaje`, `detalle`).
//
// MUESTREO: 100 % de los errores, 100 % de lo que tarda más de 1 s, 1 % del
// resto. Sin muestreo, el coste del logging crece con el tráfico justo cuando
// menos margen hay; con muestreo del 1 % se conserva la forma de la
// distribución (que es lo que dan las métricas) y se conserva ENTERO lo raro,
// que es lo que se depura.
// ============================================================================

import { redactPii } from '../anonymity.ts'
import { createHash } from 'node:crypto'

export type NivelLog = 'debug' | 'info' | 'warn' | 'error'

export interface Campos {
  [k: string]: string | number | boolean | null
}

export interface Logger {
  debug(msg: string, campos?: Campos): void
  info(msg: string, campos?: Campos): void
  warn(msg: string, campos?: Campos): void
  error(msg: string, campos?: Campos): void
}

/**
 * Claves cuyo VALOR jamás se emite en claro. Se sustituye por un hash corto,
 * que permite responder "¿es el mismo texto que en la otra línea?" sin permitir
 * jamás responder "¿qué decía?".
 *
 * La coincidencia es por igualdad o por sufijo `_clave` sobre snake_case, NO
 * por inclusión: con inclusión, `post_id` contendría `post` y acabaríamos
 * redactando justo los identificadores que hacen falta para depurar.
 */
const CLAVES_SENSIBLES: readonly string[] = [
  'body', 'cuerpo', 'texto', 'text', 'content', 'contenido', 'mensaje',
  'excerpt', 'snippet', 'bio', 'comentario', 'nota',
  'alias', 'nombre', 'email', 'correo', 'phone', 'telefono', 'contact',
  'contact_hash', 'ip', 'ip_address', 'user_agent', 'useragent',
  'password', 'token', 'secret', 'apikey', 'api_key', 'authorization',
  'cookie', 'jwt', 'session', 'service_role',
] as const

const MAX_STRING = 300
const MAX_CAMPOS = 40

function aSnake(clave: string): string {
  return clave.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function esClaveSensible(clave: string): boolean {
  const k = aSnake(clave)
  return CLAVES_SENSIBLES.some((s) => k === s || k.endsWith(`_${s}`))
}

/**
 * Huella de un valor sensible. 12 hex de SHA-256: suficiente para correlacionar
 * dos líneas, imposible de revertir a un desahogo.
 */
export function huella(valor: string): string {
  return `h:${createHash('sha256').update(valor, 'utf8').digest('hex').slice(0, 12)}`
}

/** uuid canónico. Se reconoce para NO redactarlo: ver `sanearValor`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sanearValor(valor: Campos[string]): string | number | boolean | null {
  if (valor === null || typeof valor === 'number' || typeof valor === 'boolean') return valor

  const texto = String(valor)
  // Un uuid es una ristra de dígitos y letras que el detector de PII confunde
  // con un teléfono y convierte en "[tel]". Perder los identificadores es
  // perder lo único que hace depurable un log anónimo, así que se exceptúan
  // explícitamente: un uuid no identifica a ninguna persona real (el vínculo
  // solo existe en identity_vault).
  if (UUID.test(texto)) return texto

  const limpio = redactPii(texto)
  return limpio.length > MAX_STRING ? `${limpio.slice(0, MAX_STRING)}…` : limpio
}

/** Sanea un conjunto de campos. PURA — el test la usa sin capturar stdout. */
export function sanearCampos(campos: Campos): Campos {
  const salida: Campos = {}
  let n = 0
  for (const [clave, valor] of Object.entries(campos)) {
    if (n >= MAX_CAMPOS) break
    n += 1
    if (esClaveSensible(clave)) {
      // No se descarta del todo: se deja la huella y la longitud, que es lo que
      // permite depurar ("llegó vacío", "llegó el mismo texto dos veces") sin
      // que el texto exista en ningún sitio.
      salida[`${clave}_huella`] = valor === null ? null : huella(String(valor))
      if (typeof valor === 'string') salida[`${clave}_longitud`] = valor.length
      continue
    }
    salida[clave] = sanearValor(valor)
  }
  return salida
}

export interface LineaLog extends Campos {
  ts: string
  nivel: NivelLog
  msg: string
  request_id: string
  ruta: string
}

/** Construye la línea ya saneada. PURA. */
export function construirLinea(
  nivel: NivelLog,
  msg: string,
  requestId: string,
  ruta: string,
  campos: Campos = {},
): LineaLog {
  return {
    ts: new Date().toISOString(),
    nivel,
    // El mensaje también se redacta: es por donde más veces se cuela un valor
    // interpolado (`Error al guardar ${body}`).
    msg: redactPii(msg).slice(0, MAX_STRING),
    request_id: requestId || 'sin-request-id',
    ruta,
    ...sanearCampos(campos),
  }
}

// ── Muestreo ────────────────────────────────────────────────────────────────

/** Fracción de líneas normales que se emiten. 1 % por defecto. */
let fraccionMuestreo = Number(process.env.LOG_SAMPLE_RATE ?? '0.01')

/** Umbral de "petición lenta": por encima, se emite SIEMPRE. */
export const UMBRAL_LENTO_MS = 1000

/**
 * ¿Se emite esta línea?  100 % de errores y avisos, 100 % de lo lento, 1 % del
 * resto. PURA salvo por el `azar`, que se inyecta para poder testearla.
 */
export function decidirMuestreo(
  nivel: NivelLog,
  campos: Campos = {},
  azar: number = Math.random(),
): boolean {
  if (nivel === 'error' || nivel === 'warn') return true
  const ms = campos.ms
  if (typeof ms === 'number' && ms > UMBRAL_LENTO_MS) return true
  return azar < fraccionMuestreo
}

/** Ajusta el muestreo (tests, o una variable de entorno en un incidente). */
export function configurarMuestreo(fraccion: number): void {
  fraccionMuestreo = Math.min(1, Math.max(0, fraccion))
}

// ── Escritura ───────────────────────────────────────────────────────────────

export type Escritor = (linea: string, nivel: NivelLog) => void

/**
 * Escritor por defecto: stdout para debug/info, stderr para warn/error.
 *
 * Se escribe con `process.stdout.write` y no con `console.log` por dos motivos:
 * el ESLint del proyecto prohíbe `console.log` (precisamente para que nadie
 * vuelque el cuerpo de un desahogo por descuido), y `write` no hace inspección
 * de objetos — lo que se emite es exactamente el JSON que hemos construido.
 */
const escritorPorDefecto: Escritor = (linea, nivel) => {
  if (nivel === 'error' || nivel === 'warn') process.stderr.write(`${linea}\n`)
  else process.stdout.write(`${linea}\n`)
}

let escritor: Escritor = escritorPorDefecto

/** Sustituye el destino de las líneas (tests). */
export function configurarEscritor(nuevo: Escritor | null): void {
  escritor = nuevo ?? escritorPorDefecto
}

/**
 * Logger correlacionado por petición.
 *
 * @param requestId cabecera `x-request-id` que pone proxy.ts.
 * @param ruta      ruta normalizada (`/api/feed`), nunca con identificadores.
 */
export function crearLogger(requestId: string, ruta: string): Logger {
  const emitir = (nivel: NivelLog, msg: string, campos?: Campos): void => {
    if (!decidirMuestreo(nivel, campos)) return
    escritor(JSON.stringify(construirLinea(nivel, msg, requestId, ruta, campos)), nivel)
  }

  return {
    debug: (msg, campos) => emitir('debug', msg, campos),
    info: (msg, campos) => emitir('info', msg, campos),
    warn: (msg, campos) => emitir('warn', msg, campos),
    error: (msg, campos) => emitir('error', msg, campos),
  }
}

/**
 * Lee el request-id de las cabeceras entrantes. Si no está (llamada interna,
 * cron, test), se genera uno: una línea sin correlación es peor que una línea
 * con un id que no cruza fronteras.
 */
export function requestIdDe(cabeceras: Headers | null | undefined): string {
  const id = cabeceras?.get('x-request-id')
  if (id && /^[a-z0-9-]{8,64}$/i.test(id)) return id
  return createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 32)
}
