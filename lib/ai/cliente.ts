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
// `ClienteIA` es una interfaz estructural nuestra, no el tipo del SDK. Dos
// razones:
//   1. `@anthropic-ai/sdk` todavía no está en package.json (no es un archivo
//      de este bloque; pedido anotado en HANDOFF/PEDIDOS.md), así que un
//      `import` estático no compilaría.
//   2. Los tests inyectan un cliente falso por `deps.cliente`. Con un puerto,
//      el doble es un objeto literal de diez líneas en vez de un mock del SDK
//      entero. Ninguna prueba de este bloque toca la red ni exige clave.
// ============================================================================

/** Bloque de contenido de la respuesta. Solo lo que este bloque mira. */
export interface BloqueContenido {
  type: string
  text?: string
  /** `messages.parse()` lo rellena; con `create()` viene indefinido. */
  parsed?: unknown
}

/** Uso de tokens tal y como lo devuelve la API (snake_case). */
export interface UsoRespuesta {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
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
 * Cliente memoizado, o `null` si no hay clave (o si el SDK no está instalado).
 *
 * Es `async` porque el SDK se carga con `import()` dinámico. La firma de la
 * ficha era síncrona, pero un import estático de un paquete ausente no
 * compila; en cuanto `@anthropic-ai/sdk` esté en package.json esto se puede
 * volver síncrono sin que cambie ningún llamante (todos ya hacen `await`).
 *
 * @throws si se invoca en el navegador. Misma guarda que
 *   `lib/supabase/admin.ts`: es la última red, no la primera. Si esto se
 *   ejecuta en un navegador, la clave YA está en el bundle y lo único útil que
 *   podemos hacer es romper de forma estruendosa.
 */
export async function obtenerCliente(): Promise<ClienteIA | null> {
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
    const { TIMEOUT_MS, MAX_REINTENTOS } = await import('./modelo.ts')
    // Especificador en variable a propósito: el paquete aún no está instalado
    // y un import literal haría fallar `tsc` en todo el repo. Cuando entre en
    // package.json, esta línea puede pasar a ser un import normal.
    const especificador = '@anthropic-ai/sdk'
    const modulo = await import(/* webpackIgnore: true */ especificador)
    const Anthropic = (modulo.default ?? modulo.Anthropic) as new (opciones: {
      apiKey: string
      timeout: number
      maxRetries: number
    }) => ClienteIA

    memoizado = new Anthropic({
      apiKey: clave,
      // En el SDK de TypeScript el timeout va en MILISEGUNDOS.
      timeout: TIMEOUT_MS,
      maxRetries: MAX_REINTENTOS,
    })
  } catch (causa) {
    // Sin SDK instalado, o con un fallo de construcción: exactamente el mismo
    // estado que "sin clave". No se lanza: quedarse sin clasificador no puede
    // impedir que alguien publique.
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
