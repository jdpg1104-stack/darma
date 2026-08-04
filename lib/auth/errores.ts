// ============================================================================
// ErrorApi — el error que cruza fronteras de bloque
//
// REGLA ÚNICA: el cliente recibe un CÓDIGO estable y un mensaje escrito por
// nosotros. Jamás un mensaje de Postgres, ni un stack, ni el `error.message` de
// la librería de turno. El detalle interno se registra entero y no sale de aquí.
//
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE:
//   · Un mensaje de Postgres filtra nombres de tablas, de columnas y de
//     restricciones. `duplicate key value violates unique constraint
//     "uq_comments_one_listen_per_post"` le cuenta a un atacante el esquema, la
//     mecánica antifarmeo y el nombre del índice, gratis.
//   · Los mensajes de error son también producto: quien recibe «reciprocidad:
//     necesitas escuchar a 3 personas» en crudo está leyendo una excepción de
//     plpgsql escrita para un desarrollador. La versión de cara a la persona
//     está en lib/reciprocity.ts y tiene otro tono a propósito.
//
// Los códigos son los de CONTRATOS §4, en español, y son el ÚNICO juego que
// existe en el repositorio: hubo un segundo (`lib/apiErrors.ts`, con el enum en
// inglés y la forma `{error, message, traceId}`) que sobrevivió a las cuatro
// olas en el subárbol de crons y se retiró al unificar. Si hace falta un código
// nuevo, se añade aquí y en `messages/*.json` a la vez — el guard de paridad de
// `i18n/claves.test.ts` no deja que se quede a medias.
//
// `requireSesion()` LANZA en vez de devolver un error porque es el helper más
// llamado del repositorio: un `if (!sesion)` olvidado en cualquiera de las
// decenas de rutas que lo consumen sería una ruta privada servida sin sesión.
// Un throw no se puede olvidar.
// ============================================================================

/** Códigos de error. Copia literal de CONTRATOS §4: son CONTRATO público. */
export type CodigoError =
  | 'no_autenticado'        // 401
  | 'sin_permiso'           // 403
  | 'reciprocidad'          // 403
  | 'no_encontrado'         // 404
  | 'entrada_invalida'      // 422
  | 'demasiadas_peticiones' // 429
  | 'contenido_bloqueado'   // 422
  | 'saldo_insuficiente'    // 409
  | 'error_interno'         // 500

interface EspecificacionError {
  readonly status: number
  /** Mensaje de cara a la persona. Español, sin jerga, sin culpar y —sobre
   *  todo— sin una sola pista del funcionamiento interno. */
  readonly mensaje: string
}

const ESPECIFICACIONES: Readonly<Record<CodigoError, EspecificacionError>> = {
  no_autenticado: { status: 401, mensaje: 'Necesitas entrar para hacer esto.' },
  sin_permiso: { status: 403, mensaje: 'No puedes hacer esto.' },
  reciprocidad: { status: 403, mensaje: 'Te falta acompañar a alguien más antes de publicar. Tu texto no se ha perdido.' },
  no_encontrado: { status: 404, mensaje: 'No hemos encontrado lo que buscas.' },
  entrada_invalida: { status: 422, mensaje: 'Hay algo en lo que has enviado que no podemos procesar.' },
  demasiadas_peticiones: { status: 429, mensaje: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' },
  contenido_bloqueado: { status: 422, mensaje: 'Ese contenido no se puede publicar tal cual.' },
  saldo_insuficiente: { status: 409, mensaje: 'No te llega el saldo para esto todavía.' },
  // Nunca lleva detalle. Es el destino de todo lo inesperado.
  error_interno: { status: 500, mensaje: 'Algo ha fallado por nuestra parte. Ya lo estamos mirando.' },
}

export interface OpcionesErrorApi {
  /** Sustituye al mensaje por defecto. DEBE seguir siendo apto para el público:
   *  ni nombres de tabla, ni SQL, ni la expresión regular que falló. */
  mensaje?: string
  /**
   * Clave del catálogo (`messages/*.json`) con la que la interfaz puede pintar
   * este error EN EL IDIOMA DE QUIEN LEE.
   *
   * Existe porque `mensaje` viaja ya resuelto, y el servidor no sabe en qué
   * idioma lee quien pregunta: una respuesta con matiz —«ya has impulsado 3
   * veces hoy»— llegaba en español a una pantalla en inglés. Traducir por
   * `code` a secas tampoco vale: perdería justo ese matiz y dejaría un
   * genérico.
   *
   * `mensaje` NO desaparece: es el respaldo para cuando no hay clave, y lo que
   * se registra en el log. La interfaz usa la clave si viene, y si no, el
   * mensaje.
   */
  mensajeClave?: string
  /** Parámetros del ICU de `mensajeClave` (por ejemplo `{ horas: 6 }`). */
  mensajeParams?: Readonly<Record<string, string | number>>
  /** Segundos hasta que se reabre la ventana. Solo para 429. */
  retryAfter?: number
  /** El error real. Se registra, NO se devuelve. */
  causa?: unknown
}

/**
 * Error de una ruta o de un helper de servidor.
 *
 * Todo lo público del error vive en `code`, `message` y `retryAfter`. `causa`
 * queda dentro del objeto para el log y jamás se serializa hacia el cliente
 * (ver `cuerpoDeError` en respuestas.ts, que solo lee los tres primeros).
 */
export class ErrorApi extends Error {
  readonly code: CodigoError
  readonly status: number
  readonly retryAfter?: number
  readonly mensajeClave?: string
  readonly mensajeParams?: Readonly<Record<string, string | number>>
  readonly causa?: unknown

  constructor(code: CodigoError, opciones: OpcionesErrorApi = {}) {
    const especificacion = ESPECIFICACIONES[code]
    super(opciones.mensaje ?? especificacion.mensaje)
    this.name = 'ErrorApi'
    this.code = code
    this.status = especificacion.status
    if (opciones.retryAfter !== undefined) this.retryAfter = opciones.retryAfter
    if (opciones.mensajeClave !== undefined) this.mensajeClave = opciones.mensajeClave
    if (opciones.mensajeParams !== undefined) this.mensajeParams = opciones.mensajeParams
    if (opciones.causa !== undefined) this.causa = opciones.causa
  }
}

/** ¿Es un ErrorApi? Comprobación estructural: `instanceof` falla cuando el
 *  módulo se carga dos veces (dev con HMR, o test + runtime). */
export function esErrorApi(valor: unknown): valor is ErrorApi {
  return (
    valor instanceof ErrorApi ||
    (typeof valor === 'object' &&
      valor !== null &&
      'code' in valor &&
      'status' in valor &&
      (valor as { name?: unknown }).name === 'ErrorApi')
  )
}

/**
 * Traduce un error de Postgres al código público correspondiente.
 *
 * Es el único punto donde se INSPECCIONA un mensaje de la base de datos, y ese
 * mensaje no sale de aquí: entra un error de plpgsql, sale un enum. Si ninguno
 * casa, `error_interno` — nunca "lo que dijera Postgres".
 */
export function codigoDesdePostgres(causa: unknown): CodigoError {
  const codigoSql =
    typeof causa === 'object' && causa !== null && 'code' in causa
      ? String((causa as { code?: unknown }).code ?? '')
      : ''
  const mensaje = causa instanceof Error ? causa.message : String(causa ?? '')

  // 23505 = unique_violation. Es lo que relanza crear_perfil() cuando el alias
  // ya existe; para quien se está registrando eso es "elige otro", no un 500.
  if (codigoSql === '23505' || mensaje.includes('duplicate key value')) return 'entrada_invalida'
  if (codigoSql === '23514' || mensaje.includes('reciprocidad:')) return 'reciprocidad'
  if (codigoSql === '42501' || mensaje.includes('violates row-level security')) return 'sin_permiso'

  return 'error_interno'
}
