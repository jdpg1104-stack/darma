// ============================================================================
// B11 · Cliente de Anthropic — CONSTRUCCIÓN PEREZOSA
//
// ⚠️ NO se construye el cliente a nivel de módulo. Motivo concreto:
// `new Anthropic({ apiKey: undefined })` LANZA. Como este módulo lo arrastra
// cualquier ruta que use el pipeline, un cliente a nivel de módulo rompería el
// build en un CI que (correctamente) no tiene el secreto. Con una función, no
// pasa nada hasta que alguien llama, y quien llama ya sabe manejar el `null`.
//
// ── SIN CLAVE NO ES UN ERROR ───────────────────────────────────────────────
// `obtenerCliente()` devuelve `null` y punto. Ese es un estado NORMAL y SEGURO
// del sistema: el pipeline degrada (publica sin validar, escala el riesgo) y
// la app sigue funcionando. Hoy, de hecho, es el estado real: no hay
// MODERATION_API_KEY configurada.
//
// ── EL PUERTO ──────────────────────────────────────────────────────────────
// `ClienteIA` es una interfaz estructural nuestra, no el tipo del SDK. La
// razón que sigue en pie ahora que `@anthropic-ai/sdk` YA está en package.json
// y el import es estático: los tests inyectan un cliente falso por
// `deps.cliente`. Con un puerto, el doble es un objeto literal de diez líneas
// en vez de un mock del SDK entero. Ninguna prueba de este bloque toca la red
// ni exige clave.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { MAX_REINTENTOS, TIMEOUT_MS } from './modelo.ts'

/** Bloque de contenido de la respuesta. Solo lo que este bloque mira. */
export interface BloqueContenido {
  type: string
  text?: string
  /** `messages.parse()` lo rellena; con `create()` viene indefinido. */
  parsed?: unknown
}

/**
 * Uso de tokens tal y como lo devuelve la API (snake_case).
 *
 * `number | null` y no solo `number`: el SDK real declara los contadores de
 * caché como anulables, y el puerto tiene que aceptar el objeto del SDK sin
 * mentir. Quien lee estos campos ya usa `?? 0`.
 */
export interface UsoRespuesta {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export interface RespuestaIA {
  /**
   * `'end_turn' | 'max_tokens' | 'refusal' | 'tool_use' | 'pause_turn' | ...`
   *
   * ⚠️ SE MIRA ANTES QUE `content`. `claude-opus-5` lleva salvaguardas de
   * ciberseguridad y sus clasificadores pueden declinar con
   * `stop_reason: 'refusal'` y HTTP 200, devolviendo `content: []`. Un texto
   * de desahogo con lenguaje violento puede dispararlo. Leer `content[0]` sin
   * comprobar revienta justo en la petición de la persona más vulnerable.
   */
  stop_reason?: string | null
  /** Solo viene cuando `stop_reason === 'refusal'`. `null` en todo lo demás. */
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null
  content?: BloqueContenido[]
  usage?: UsoRespuesta
  model?: string
  /** Presente cuando se usa `messages.parse()`. */
  parsed_output?: unknown
}

export interface ClienteIA {
  messages: {
    create(parametros: Record<string, unknown>): Promise<RespuestaIA>
    /** Opcional: no todos los dobles de test lo implementan. */
    countTokens?(parametros: Record<string, unknown>): Promise<{ input_tokens: number }>
  }
}

/** ¿Hay clave configurada? Sin efectos, para que el pipeline decida temprano. */
export function hayClaveIA(): boolean {
  const clave = process.env.MODERATION_API_KEY?.trim()
  return typeof clave === 'string' && clave.length > 0
}

let memoizado: ClienteIA | null = null
let intentado = false

/**
 * Cliente memoizado, o `null` si no hay clave.
 *
 * SÍNCRONA desde que `@anthropic-ai/sdk` entró en package.json (cierra la
 * mitad (a) del pedido «De B11 → B00 / F4» de HANDOFF/PEDIDOS.md). Era `async`
 * solo por el `import()` dinámico de cuando el paquete no existía; ningún
 * llamante cambió porque todos ya hacían `await`, que sobre un valor no
 * promesa es un no-op.
 *
 * @throws si se invoca en el navegador. Misma guarda que
 *   `lib/supabase/admin.ts`: es la última red, no la primera. Si esto se
 *   ejecuta en un navegador, la clave YA está en el bundle y lo único útil que
 *   podemos hacer es romper de forma estruendosa.
 */
export function obtenerCliente(): ClienteIA | null {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[darma][SEGURIDAD] lib/ai/cliente.ts se ha cargado en el NAVEGADOR. ' +
        'MODERATION_API_KEY es un secreto de servidor: alguien lo ha importado desde ' +
        'un componente cliente. Revisa la cadena de imports y muévelo a un Route ' +
        'Handler o Server Action. NO silencies este error.',
    )
  }

  if (intentado) return memoizado
  intentado = true

  const clave = process.env.MODERATION_API_KEY?.trim()
  if (!clave) return null

  try {
    const cliente = new Anthropic({
      apiKey: clave,
      // En el SDK de TypeScript el timeout va en MILISEGUNDOS.
      timeout: TIMEOUT_MS,
      maxRetries: MAX_REINTENTOS,
    })
    // El puerto solo NOMBRA lo que este bloque lee, así que el objeto real lo
    // satisface en runtime; estructuralmente no son asignables porque el SDK
    // tipa `create()` con sus uniones propias y el puerto con
    // `Record<string, unknown>`. El doble cast es el precio, contenido aquí,
    // de que los tests no dependan de los tipos del SDK.
    memoizado = cliente as unknown as ClienteIA
  } catch (causa) {
    // Un fallo de construcción es exactamente el mismo estado que "sin clave".
    // No se lanza: quedarse sin clasificador no puede impedir que alguien
    // publique.
    console.warn('[darma][b11] clasificador no disponible; se degrada', {
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
    memoizado = null
  }

  return memoizado
}

/** Limpia la memoización. SOLO para tests. */
export function __resetCliente(): void {
  memoizado = null
  intentado = false
}
