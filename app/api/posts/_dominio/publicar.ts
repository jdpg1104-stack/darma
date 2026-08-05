// ============================================================================
// Lógica PURA de /api/posts — sin red, sin Next, sin Supabase
//
// Está separada de `route.ts` para que se pueda probar con
// `node --test --experimental-strip-types`, que es donde viven los casos que de
// verdad importan de este bloque: los dos errores 23514 y la construcción de la
// tarjeta de recursos. Una prueba que necesita levantar Next para comprobar una
// traducción de error acaba no escribiéndose.
//
// Este archivo vive bajo `app/api/posts/_dominio/`. El guion bajo inicial hace
// que Next lo trate como carpeta PRIVADA y no genere ninguna ruta a partir de
// él; si se llamara `dominio/`, `/api/posts/dominio` sería un endpoint real.
// ============================================================================

// ⚠️ IMPORTS RELATIVOS, Y NO EL ALIAS `@/` QUE PIDE CONTRATOS §1.
// Es la única excepción del bloque y tiene una razón concreta: este archivo se
// carga con `node --test --experimental-strip-types`, y Node no lee los `paths`
// de tsconfig.json — un `@/lib/crisis` ahí es un `ERR_MODULE_NOT_FOUND`. La
// alternativa era no probar esta lógica, y esta lógica es justo la que contiene
// el bug que se cuela (los dos 23514). El resto de archivos de B03 —los que
// solo ejecuta Next— sí usan `@/`.

import { z } from 'zod'
import {
  assessCrisisRisk,
  crisisMessage,
  helpResourcesFor,
  requiresIntervention,
  type RiskLevel,
} from '../../../../lib/crisis.ts'
import type { CodigoError } from '../../../../lib/auth/errores.ts'
import type { TarjetaRecursosDatos } from '../../../../components/composer/contrato.ts'
import {
  CUERPO_MAX,
  CUERPO_MIN,
  TEMAS,
  TIPOS_POST,
} from '../../../../components/composer/temas.ts'

// ── Validación ──────────────────────────────────────────────────────────────
// `.strict()` y no el modo por defecto: un cuerpo con campos de más se RECHAZA,
// no se ignora. La diferencia se nota exactamente el día en que alguien manda
// `{ body, kind, topic, authorId: '<otra persona>' }` — con el modo permisivo el
// campo sobrante entra en el objeto validado y solo la disciplina de quien
// escribió la ruta impide que acabe en el INSERT. Con `.strict()` la petición
// muere en la validación y el fallo es ruidoso, que es lo que se quiere.
//
// El mensaje de zod NO se devuelve nunca: `error.issues[0].message` de un
// `.min()` cuenta el límite exacto, y el de un `.regex()` incluye la expresión
// entera. Cada campo tiene un mensaje nuestro, escrito para la persona.

const esquemaCuerpo = z
  .string()
  .trim()
  .min(CUERPO_MIN)
  .max(CUERPO_MAX)

export const esquemaCrearPost = z
  .object({
    body: esquemaCuerpo,
    kind: z.enum(TIPOS_POST),
    topic: z.enum(TEMAS),
  })
  .strict()

export const esquemaEditarPost = z
  .object({
    body: esquemaCuerpo,
    topic: z.enum(TEMAS),
  })
  .strict()

/** Mensajes de cara a la persona. Dicen qué hacer, no qué falló. */
export const MENSAJES_VALIDACION: Readonly<Record<string, string>> = {
  body: `Cuéntanos un poco más: entre ${CUERPO_MIN} y ${CUERPO_MAX} caracteres.`,
  kind: 'Elige si es un desahogo, una pregunta o algo que agradecer.',
  topic: 'Elige uno de los temas de la lista.',
  json: 'No hemos podido leer lo que has enviado.',
  desconocido: 'Hay algo en lo que has enviado que no podemos procesar.',
}

/** Traduce el primer problema de zod a UN mensaje nuestro. */
export function mensajeDeValidacion(error: z.ZodError): string {
  const campo = error.issues[0]?.path[0]
  return (typeof campo === 'string' && MENSAJES_VALIDACION[campo]) || MENSAJES_VALIDACION.desconocido!
}

// ── LOS DOS 23514 ───────────────────────────────────────────────────────────
//
// Esta es la trampa central del bloque y merece que quede escrito entero.
//
// El trigger de reciprocidad lanza su excepción así (0001_core.sql):
//
//     raise exception 'reciprocidad: necesitas escuchar a 3 personas para publicar'
//       using errcode = 'check_violation';
//
// `check_violation` ES el SQLSTATE 23514. Y 23514 es también, exactamente, lo
// que devuelve el CHECK `char_length(body) between 20 and 5000` de la misma
// tabla. Dos causas que no tienen nada que ver comparten código de error.
//
// Si se traduce «todo 23514» a `reciprocidad`, a quien escribe tres palabras se
// le dice que le faltan escuchas. Buscará el enlace de escuchar, escuchará a
// tres personas, volverá, y le volverá a fallar. Por eso se discrimina por el
// PREFIJO del mensaje, que está fijado en `posts_consume_credit()` y no cambia.
//
// ⚠️ `lib/auth/errores.ts` (dueño B01) tiene un `codigoDesdePostgres()` que hace
// justamente lo que aquí no se puede hacer: `if (codigoSql === '23514') return
// 'reciprocidad'`. Es correcto para las rutas de B01, que no insertan posts, y
// es un bug en cuanto alguien lo reutilice aquí. Por eso B03 traduce con su
// propia función y no con aquella. Anotado en HANDOFF/PEDIDOS.md.
//
// ── ORDEN REAL, MEDIDO CONTRA POSTGRES ─────────────────────────────────────
// Un trigger BEFORE INSERT se ejecuta ANTES de comprobar los CHECK de la tabla.
// Comprobado en `darma-dev`: un INSERT con `body` de 19 caracteres hecho por un
// perfil sin créditos devuelve el 23514 de RECIPROCIDAD, no el de longitud. O
// sea que el 23514 de longitud solo aparece cuando la persona SÍ podía publicar.
// No cambia nada de lo de arriba —hay que discriminar igual—, pero explica por
// qué la validación de longitud tiene que estar en zod, antes del viaje: si se
// dejara en manos del CHECK, el mensaje que llega depende del saldo de escuchas.

/** Prefijo fijado en `posts_consume_credit()`. Es el discriminante. */
export const PREFIJO_RECIPROCIDAD = 'reciprocidad:'

/** Lo mínimo que se necesita de un error de PostgREST/Postgres. */
export interface ErrorPostgres {
  code?: string | null
  message?: string | null
}

function textoDeError(causa: unknown): string {
  if (typeof causa === 'string') return causa
  if (causa instanceof Error) return causa.message
  if (typeof causa === 'object' && causa !== null && 'message' in causa) {
    return String((causa as ErrorPostgres).message ?? '')
  }
  return ''
}

function sqlstateDeError(causa: unknown): string {
  if (typeof causa === 'object' && causa !== null && 'code' in causa) {
    return String((causa as ErrorPostgres).code ?? '')
  }
  return ''
}

/**
 * Traduce un error de Postgres al código público de CONTRATOS §4.
 *
 * Entra un error de plpgsql, sale un enum: el mensaje crudo NO sale de aquí.
 * Nada de nombres de tabla, de restricción ni de trigger — `duplicate key value
 * violates unique constraint "uq_comments_one_listen_per_post"` le cuenta a un
 * atacante el esquema y la mecánica antifarmeo, gratis.
 */
export function codigoDesdeErrorDePost(causa: unknown): CodigoError {
  const mensaje = textoDeError(causa)
  const sqlstate = sqlstateDeError(causa)

  // 1º el prefijo, SIEMPRE antes que el SQLSTATE. Es la única señal que
  // distingue el gate de un CHECK cualquiera.
  if (mensaje.includes(PREFIJO_RECIPROCIDAD)) return 'reciprocidad'

  // 23514 sin ese prefijo = un CHECK de la tabla (hoy, la longitud del cuerpo).
  if (sqlstate === '23514') return 'entrada_invalida'
  // 22P02 = valor inválido para un enum (`kind` o `risk` fuera de rango).
  if (sqlstate === '22P02' || sqlstate === '23505') return 'entrada_invalida'
  // 23503 = FK rota: no hay fila en `profiles` para ese autor (onboarding sin
  // terminar). Para la persona eso es «todavía no puedes», no un 500.
  if (sqlstate === '23503') return 'sin_permiso'
  if (sqlstate === '42501' || mensaje.includes('row-level security') || mensaje.includes('permission denied')) {
    return 'sin_permiso'
  }

  return 'error_interno'
}

// ── Riesgo ──────────────────────────────────────────────────────────────────

export interface RiesgoEvaluado {
  nivel: RiskLevel
  /** ¿Hay que enseñar recursos y abrir la cola humana? (nivel >= high) */
  requiereIntervencion: boolean
  /** Ids de los patrones que casaron (`es_ideation`, `en_method`…). Van al log
   *  y a la cola de moderación; el TEXTO no va a ninguno de los dos. */
  senales: string[]
}

/**
 * Evalúa el riesgo de un texto y prepara la tarjeta si hace falta.
 *
 * `async` aunque hoy `assessCrisisRisk` sea puro y síncrono: B11 va a enchufar
 * encima un clasificador de IA que sí hace red, y el contrato de la ficha ya es
 * `await evaluarRiesgo(body)`. Que la firma nazca asíncrona evita tener que
 * tocar todas las rutas que la llamen el día que eso ocurra.
 *
 * ⚠️ El módulo real (`lib/crisis.ts`, dueño F3) exporta `assessCrisisRisk`, no
 * `evaluarRiesgo`. Esta función es el adaptador de nombre que pide la ficha B03;
 * la discrepancia está anotada en HANDOFF/PEDIDOS.md. NO se reimplementa aquí
 * ni una sola regla de crisis: el suelo de riesgo lo pone lib/crisis.ts y este
 * archivo solo lo transporta.
 */
export async function evaluarRiesgo(texto: string): Promise<RiesgoEvaluado> {
  const evaluacion = assessCrisisRisk(texto)

  return {
    nivel: evaluacion.risk_level,
    requiereIntervencion: evaluacion.requiresIntervention,
    senales: evaluacion.signals.map((s) => s.id),
  }
}

/**
 * Nombres de los recursos que se le han enseñado, tal cual van a
 * `crisis_events.resources_shown`.
 *
 * Se derivan de la MISMA tarjeta que ve la persona y no de una segunda consulta
 * a `helpResourcesFor()`: si un día divergieran, el registro diría que se mostró
 * una línea de ayuda que en realidad no se mostró, y esta tabla existe
 * precisamente para poder responder «¿qué hizo el sistema?» ante una familia o
 * un regulador. Un registro que miente es peor que no tener registro.
 */
export function nombresDeRecursos(tarjeta: TarjetaRecursosDatos | null): string[] {
  return tarjeta ? tarjeta.lineas.map((linea) => linea.nombre) : []
}

/**
 * Construye la tarjeta que se pinta EN LA MISMA RESPUESTA que confirma la
 * publicación (CONTRATOS §9.1).
 *
 * Devuelve `null` por debajo de `high`: en 'low' no se interrumpe a nadie —el
 * enlace de ayuda del layout sigue estando— porque 'low' es el nivel que más
 * falsos positivos produce a propósito y convertirlo en una tarjeta a pantalla
 * completa entrenaría a la gente a ignorarla, que es justo lo que no puede pasar
 * cuando el nivel sea 'critical'.
 *
 * `helpResourcesFor()` NUNCA devuelve lista vacía: ante un país desconocido
 * entrega el directorio internacional. Una pantalla de crisis sin ningún recurso
 * es un callejón sin salida.
 */
export function construirTarjetaRecursos(
  nivel: RiskLevel,
  pais?: string | null,
): TarjetaRecursosDatos | null {
  if (!requiresIntervention(nivel)) return null

  return {
    // Sin alarma y sin diagnóstico. No dice «hemos detectado»: suena a
    // vigilancia, y quien se siente vigilado deja de contar la verdad.
    titulo: 'Tu texto ya está publicado. Esto es por si lo quieres.',
    mensaje: crisisMessage(nivel),
    lineas: helpResourcesFor(pais).map((recurso) => ({
      nombre: recurso.name,
      ...(recurso.phone ? { telefono: recurso.phone } : {}),
      ...(recurso.url ? { url: recurso.url } : {}),
      ...(recurso.hours ? { horario: recurso.hours } : {}),
    })),
    accionInmediata: { etiqueta: 'Hablar con alguien ahora', href: '/ayuda' },
  }
}

// ── Identificación de la IP para el rate limit ──────────────────────────────

/**
 * Hash de la IP. La clave del rate limit se PERSISTE en la tabla `rate_limits`,
 * y ahí no puede haber un dato personal: una IP es un identificador de una
 * persona, y guardarla junto a la acción «publicar» reconstruye quién escribió
 * qué a partir de una tabla que nadie considera sensible.
 *
 * Se usa la pimienta de `IDENTITY_PEPPER` cuando existe. Sin ella el hash sigue
 * siendo irreversible en la práctica pero es enumerable (el espacio de IPv4 son
 * 2^32 valores: se recorre entero en minutos), así que su ausencia se registra
 * como aviso en la ruta en vez de pasar en silencio.
 */
export function claveDeIp(ip: string, pimienta: string | undefined, sha256: (v: string) => string): string {
  return sha256(`${pimienta ?? ''}:ip:${ip}`).slice(0, 32)
}

/**
 * ⛔ RETIRADA. Ver `origenDePeticion()` en `lib/auth/peticion.ts`.
 *
 * Esta función tomaba la PRIMERA IP de `x-forwarded-for`, y su comentario
 * razonaba bien la mitad del problema: tomar la última limitaría al proxy de
 * Vercel, o sea a todo el mundo a la vez. Lo que se le escapaba es que la
 * primera la escribe el CLIENTE — mandar una cadena distinta en cada petición
 * estrenaba cubo cada vez y el límite de 20/hora no limitaba nada.
 *
 * Las dos mitades se resuelven a la vez leyendo `x-vercel-forwarded-for`, que
 * el borde sella y trae la IP real sin cadena que elegir. `peticion.ts` además
 * agrega IPv6 a /64: sin eso, a cualquier abonado doméstico se le entrega un
 * /64 —2^64 direcciones rotables— y el contador por IP completa era decorativo.
 *
 * Se deja este bloque en vez de borrar la función sin más porque el
 * razonamiento equivocado era PLAUSIBLE, estaba escrito, y tenía una prueba que
 * lo fijaba como correcto. Quien vuelva a pensarlo merece encontrar por qué no.
 */
