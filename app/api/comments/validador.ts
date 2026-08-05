// ============================================================================
// El validador de calidad — B11 enchufado SOBRE el suelo heurístico
//
// `ValidadorComentario` (ver `tipos.ts`) es la costura. Desde B11 la
// implementación por defecto es una COMPOSICIÓN, no una sustitución:
//
//   1. Heurística de `lib/moderation.ts` SIEMPRE y primero. Gratis,
//      determinista y sin I/O. Si rechaza, se acabó: no se gasta una llamada
//      de pago en algo que ya sabemos que es relleno, y el motivo devuelto es
//      reproducible.
//   2. Modelo —`evaluarContenido()` de `lib/ai/pipeline.ts`, que ya trae
//      presupuesto, límite por usuario y auditoría— SOLO sobre lo que la
//      heurística dio por bueno, y solo si hay clave (`MODERATION_API_KEY`) y
//      un `autorId` de sesión en el contexto. Si responde a tiempo y sin
//      degradación, SU veredicto manda, también para invalidar.
//   3. Todo lo demás —sin clave, sin autor, timeout, error del proveedor,
//      presupuesto agotado— cae al veredicto heurístico del paso 1. La
//      publicación no depende jamás de que un proveedor esté de pie.
//
// Sin clave, el comportamiento es EXACTAMENTE el de siempre: heurística pura,
// cero saltos de red. Ese sigue siendo hoy el estado real del sistema.
//
// ── POR QUÉ LA HEURÍSTICA SE QUEDA AUNQUE HAYA MODELO ──────────────────────
// No como alternativa, como SUELO. Un clasificador remoto tiene latencia,
// cuota y días raros; la validación de un comentario decide si alguien cobra
// su escucha, y eso no puede depender de que un proveedor esté de pie.
//
// ── ORIENTACIÓN DEL ERROR ──────────────────────────────────────────────────
// Al revés que la crisis: aquí un falso positivo SÍ duele. Negarle la
// validación a alguien que escribió algo sincero pero torpe es exactamente la
// experiencia que hace que esa persona no vuelva. Por eso el motivo que se
// devuelve está escrito para que se pueda arreglar el mensaje, no para dar un
// veredicto.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
// Imports RELATIVOS y con extensión a propósito: así `node --test
// --experimental-strip-types` puede cargar este archivo (y su test colocado)
// sin necesitar el alias `@/` de Next.
import { validateComment, moderationMessage } from '../../../lib/moderation.ts'
import { hayClaveIA, type ClienteIA } from '../../../lib/ai/cliente.ts'
import { evaluarContenido } from '../../../lib/ai/pipeline.ts'
import { MAX_REINTENTOS, TIMEOUT_MS } from '../../../lib/ai/modelo.ts'
import type {
  ContextoValidacion,
  ValidadorComentario,
  VeredictoValidacion,
} from './tipos.ts'

/**
 * Implementación de SUELO. Determinista y sin I/O, así que validar con ella no
 * añade ni un salto de red al camino de comentar.
 */
export class ValidadorHeuristico implements ValidadorComentario {
  async validar(texto: string, contexto: ContextoValidacion = {}): Promise<VeredictoValidacion> {
    const resultado = validateComment({
      body: texto,
      postBody: contexto.postBody,
      previousByAuthor: contexto.previosDelAutor,
    })

    return {
      valido: resultado.valid,
      score: resultado.score,
      // El `reason` interno ('filler_only', 'echoes_post') no sale nunca: se
      // traduce a una frase que propone cómo mejorar. Publicar el id de la
      // señal es publicar el manual para esquivarla.
      motivo: resultado.valid ? null : moderationMessage(resultado.reason),
    }
  }
}

// ── El contexto ampliado que la ruta puede pasar ────────────────────────────

/**
 * Contexto del `ValidadorIA`. Extiende `ContextoValidacion` SOLO con campos
 * opcionales, así que las rutas actuales (que pasan `postBody` y nada más)
 * siguen compilando sin tocarse — pero mientras no pasen `autorId`, el modelo
 * no corre y manda la heurística. El enganche completo es un pedido a B04
 * anotado en HANDOFF/PEDIDOS.md.
 */
export interface ContextoValidacionIA extends ContextoValidacion {
  /** uuid del autor, SIEMPRE de la sesión (jamás del body). Sin él no hay
   *  pipeline: el límite por usuario, la auditoría y `crisis_events` se
   *  indexan por autor y un autor vacío los corrompería. */
  autorId?: string
  /** uuid del comentario YA insertado (la validación corre tras el INSERT). */
  refId?: string
  /** Cliente ADMIN de la ruta, para presupuesto, auditoría y crisis. Este
   *  archivo NO construye el suyo: la cuenta de admins de B04 es cerrada y un
   *  test la vigila. Sin él, el pipeline degrada con fail-open acotado. */
  admin?: SupabaseClient
  /** País ya resuelto en el borde, para no tocar `identity_vault`. */
  pais?: string | null
}

// ── El validador con modelo ─────────────────────────────────────────────────

/**
 * Plazo TOTAL de la validación con modelo, en milisegundos. El cliente ya
 * corta cada intento a `TIMEOUT_MS` con `MAX_REINTENTOS` reintentos; esto es
 * el cinturón de fuera por si lo colgado es otra cosa (el contador del
 * presupuesto, una promesa que nunca resuelve). Pasado el plazo manda la
 * heurística y el composer no se queda esperando.
 */
export const PLAZO_VALIDADOR_MS = TIMEOUT_MS * (MAX_REINTENTOS + 1) + 1000

/**
 * Motivos de cara a la persona cuando quien invalida es el MODELO. Mismo
 * principio que `moderationMessage()`: nunca el veredicto crudo ni el motivo
 * generado — una frase fija que propone cómo mejorar. El motivo del modelo se
 * queda en la auditoría de `moderation_flags`, no en la respuesta.
 */
const MOTIVO_RELLENO_MODELO =
  'Tu mensaje podría valer para cualquier desahogo. Cuéntale algo que responda a lo que esta persona en concreto ha contado.'
const MOTIVO_TOXICO_MODELO =
  'Lo que has escrito puede hacer daño a quien lo lea. Este espacio es para acompañar: prueba a decirlo desde tu propia experiencia y sin juzgar.'

/** Carrera contra el reloj. `null` = no hubo veredicto a tiempo. NUNCA lanza. */
async function conPlazo<T>(promesa: Promise<T>, plazoMs: number): Promise<T | null> {
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const plazo = new Promise<null>((resolver) => {
    temporizador = setTimeout(() => resolver(null), plazoMs)
  })
  try {
    // El `catch` es cinturón: `evaluarContenido()` promete no lanzar, pero si
    // algún día lanza, el fallo debe caer a la heurística, no reventar el POST.
    return await Promise.race([promesa.catch(() => null), plazo])
  } finally {
    // Sin esto cada validación dejaría un timer vivo hasta `plazoMs`; en
    // `node --test` eso mantiene el proceso abierto.
    if (temporizador !== undefined) clearTimeout(temporizador)
  }
}

export interface DepsValidadorIA {
  /** Cliente del clasificador. Los tests lo inyectan; producción usa la clave. */
  cliente?: ClienteIA
  /** Suelo heurístico, sustituible solo en tests. */
  suelo?: ValidadorComentario
  /** Plazo total antes de caer al suelo. Por defecto `PLAZO_VALIDADOR_MS`. */
  plazoMs?: number
  /** Reloj inyectable (latencia de la auditoría del pipeline). */
  ahora?: () => number
}

/**
 * La composición heurística + modelo. Implementa `ValidadorComentario`, así
 * que ninguna ruta cambia de firma.
 *
 * El contrato de fallo es asimétrico a propósito:
 *   · la VOZ falla abierta — cualquier fallo del modelo devuelve el veredicto
 *     heurístico y la publicación sigue su curso;
 *   · la ECONOMÍA falla cerrada — el modelo solo puede añadir juicio cuando
 *     respondió de verdad (`degradado: false`); un `indeterminado` jamás
 *     valida ni invalida por sí mismo.
 */
export class ValidadorIA implements ValidadorComentario {
  private readonly deps: DepsValidadorIA

  constructor(deps: DepsValidadorIA = {}) {
    this.deps = deps
  }

  async validar(texto: string, contexto: ContextoValidacionIA = {}): Promise<VeredictoValidacion> {
    const suelo = this.deps.suelo ?? new ValidadorHeuristico()
    const veredictoSuelo = await suelo.validar(texto, contexto)

    // 1. La heurística filtra el grueso del relleno sin gastar. Su rechazo es
    //    definitivo: reproducible, auditable y con motivo accionable.
    if (!veredictoSuelo.valido) return veredictoSuelo

    // 2. Modelo solo si puede correr de verdad. Sin clave (y sin cliente
    //    inyectado) este método ES la heurística de siempre: cero red.
    if (this.deps.cliente === undefined && !hayClaveIA()) return veredictoSuelo

    // Sin autor de sesión no hay pipeline (ver `ContextoValidacionIA`). Las
    // rutas de B04 aún no lo pasan: pedido anotado en HANDOFF/PEDIDOS.md.
    if (!contexto.autorId) return veredictoSuelo

    const salida = await conPlazo(
      evaluarContenido(
        { texto, tipo: 'comment', autorId: contexto.autorId, refId: contexto.refId },
        {
          cliente: this.deps.cliente,
          admin: contexto.admin,
          paisConocido: contexto.pais,
          ahora: this.deps.ahora,
        },
      ),
      this.deps.plazoMs ?? PLAZO_VALIDADOR_MS,
    )

    // 3. Timeout o degradación (sin presupuesto, refusal, JSON roto…): manda
    //    el suelo. La voz falla abierta y nadie se queda sin publicar porque
    //    un proveedor tenga un mal día.
    if (salida === null || salida.degradado) return veredictoSuelo

    // 4. Hubo veredicto real: el del modelo manda, también para invalidar.
    //    `puntuacion` es su confianza; si faltara, queda el score del suelo.
    if (salida.validado) {
      return { valido: true, score: salida.puntuacion ?? veredictoSuelo.score, motivo: null }
    }
    return {
      valido: false,
      score: salida.puntuacion ?? veredictoSuelo.score,
      motivo: salida.calidad === 'toxico' ? MOTIVO_TOXICO_MODELO : MOTIVO_RELLENO_MODELO,
    }
  }
}

/** El validador que usan las rutas: la composición heurística + modelo (B11). */
export const validadorPorDefecto: ValidadorComentario = new ValidadorIA()
